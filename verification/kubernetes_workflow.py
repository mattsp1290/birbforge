from datetime import datetime, timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

from verification.deployment_workflow import dispatch_deployment, reconcile_deployment

with workflow.unsafe.imports_passed_through():
    from verification.kubernetes import (
        STATE_ADAPTER,
        ClosureTrigger,
        KubernetesCommand,
        KubernetesQueueConfig,
        bind_kubernetes,
        closure_reason,
        digest,
        failure,
        validate_closure,
    )


CLOSE_BACKOFF = (1, 2, 4, 8, 10)
PRODUCER_RETENTION_ERRORS = {
    "quarantined": "producer_quarantined",
    "sealed_unadmitted": "producer_sealed_unadmitted",
}


@workflow.defn
class KubernetesQueue:
    @workflow.init
    def __init__(self, initial: dict):
        self.config = KubernetesQueueConfig.model_validate(initial["config"])
        if (
            self.config.deployment
            and "state" in initial
            and not workflow.info().continued_run_id
        ):
            raise ApplicationError(
                "deployment_initial_state_forbidden", non_retryable=True
            )
        self.state = STATE_ADAPTER.validate_python(
            initial.get(
                "state",
                {
                    "revision": 0,
                    "rows": {},
                    "order": [],
                    "commands": {},
                    "outstanding_request_id": None,
                },
            )
        )
        self.active = None
        self.cycles = 0

    def touch(self, row):
        row["revision"] += 1
        self.state["revision"] += 1

    def command(self, message: dict, op: str) -> dict:
        intent = {
            **KubernetesCommand.model_validate(message["command"]).normalized(),
            "principal": message["principal"],
        }
        if (
            intent["op"] != op
            or intent["principal"] != self.config.authority.owner_principal
        ):
            return failure("forbidden", 403)
        body = intent["body"]
        key = op + ":" + body["idempotency_key" if op == "admit" else "command_id"]
        previous = self.state["commands"].get(key)
        if previous:
            if previous["intent"] == intent:
                return previous["receipt"]
            return failure(
                "idempotency_conflict" if op == "admit" else "command_id_conflict"
            )
        row = self.admit_row(intent) if op == "admit" else self.revise_row(intent)
        if "ok" in row:
            return row
        self.touch(row)
        receipt = {
            "ok": True,
            "request_id": body["request_id"],
            "revision": row["revision"],
        }
        self.state["commands"][key] = {"intent": intent, "receipt": receipt}
        return receipt

    def validate_command(self, message: dict, op: str, error: str):
        if (
            set(message) != {"command", "principal"}
            or KubernetesCommand.model_validate(message["command"]).normalized()["op"]
            != op
        ):
            raise ValueError(error)

    @workflow.update
    def admit(self, message: dict) -> dict:
        return self.command(message, "admit")

    @admit.validator
    def validate_admit(self, message: dict):
        self.validate_command(message, "admit", "invalid_admission")

    def admit_row(self, intent: dict) -> dict:
        identity = intent["body"]["request_id"]
        if identity in self.state["rows"]:
            return failure("request_id_conflict")
        if len(self.state["rows"]) >= self.config.max_requests:
            return failure("installation_capacity", 409)
        try:
            payload = bind_kubernetes(intent, self.config, workflow.now())
        except ValueError as error:
            return failure(str(error), 403)
        row = {
            "intent": intent,
            "payload": payload,
            "request_sha256": digest(payload),
            "revision": 0,
            "phase": "queued",
            "cancellation": "none",
            "activity_outcome": None,
            "closure": None,
            "closure_trigger": None,
            "observation_error": None,
            "close_attempts": 0,
        }
        if profile := self.config.deployment:
            row["request_sha256"] = profile.request_sha256
            row["deployment"] = {
                "operation_id": profile.operation_id,
                "lookup_status": "unavailable",
                "result": None,
                "seal_observation": None,
            }
        self.state["rows"][identity] = row
        self.state["order"].append(identity)
        return row

    def scoped_row(self, intent: dict) -> dict:
        body = intent["body"]
        row = self.state["rows"].get(body["request_id"])
        if row is None or row["intent"]["conversation_id"] != intent["conversation_id"]:
            return failure("request_not_found", 404)
        if body["expected_revision"] != row["revision"]:
            return failure("stale_revision")
        return row

    def request_closure(self, row: dict, trigger: ClosureTrigger):
        row["closure_trigger"] = trigger
        if self.active is None:
            row["phase"] = "closing"

    @workflow.update
    def cancel(self, message: dict) -> dict:
        return self.command(message, "cancel")

    @cancel.validator
    def validate_cancel(self, message: dict):
        self.validate_command(message, "cancel", "invalid_cancellation")

    def revise_row(self, intent: dict) -> dict:
        row = self.scoped_row(intent)
        if "ok" in row:
            return row
        if intent["op"] == "complete":
            if row["phase"] != "running" or row["closure_trigger"] is not None:
                return failure("request_not_running")
            if datetime.fromisoformat(row["payload"]["deadline"]) <= workflow.now():
                return failure("request_deadline_elapsed")
            self.request_closure(row, "complete")
            return row
        if row["cancellation"] != "none":
            return failure("cancellation_already_decided")
        if row["phase"] == "queued":
            if self.config.deployment:
                row.update(closure_trigger="cancel", cancellation="requested")
            else:
                row.update(
                    phase="cancelled_before_dispatch", cancellation="acknowledged"
                )
        elif row["phase"] in {"closed", "expired"}:
            row["cancellation"] = "too_late"
        elif row["closure_trigger"] is not None:
            return failure("closure_already_decided")
        else:
            row["cancellation"] = "requested"
            self.request_closure(row, "cancel")
            if self.active is not None:
                self.active.cancel()
        return row

    @workflow.update
    def complete(self, message: dict) -> dict:
        return self.command(message, "complete")

    @complete.validator
    def validate_complete(self, message: dict):
        self.validate_command(message, "complete", "invalid_completion")

    @workflow.query
    def installation(self) -> dict:
        return {
            "config": self.config.model_dump(mode="json"),
            "workflow_task_queue": workflow.info().task_queue,
        }

    @workflow.query
    def snapshot(self) -> dict:
        return self.state

    @workflow.query
    def deployment_evidence_v1(self, invocation: dict) -> dict | None:
        profile = self.config.deployment
        if profile is None or invocation != profile.invocation:
            return None
        row = self.state["rows"].get(profile.request_id)
        if row is None:
            return None
        record = row["deployment"]
        return {
            "schema_version": "birbforge.deployment.evidence-status.v1",
            "invocation": profile.invocation,
            "operation_id": record["operation_id"],
            "result_sha256": record["result"]["result_sha256"]
            if record["result"]
            else None,
            "seal_observation_sha256": digest(record["seal_observation"])
            if record["seal_observation"]
            else None,
            "eligible": False,
            "reason": "release_not_authorized",
        }

    def reconcile(self, row: dict, observed: dict):
        old_phase = row["phase"]
        try:
            receipt = validate_closure(
                row["payload"], observed, self.config.authority.installation_sha256
            )
        except (ValueError, TypeError, KeyError, AttributeError):
            error = "invalid_producer_evidence"
        else:
            error = PRODUCER_RETENTION_ERRORS.get(observed.get("state"))
            if error is not None:
                row["phase"] = "retained"
            if receipt is not None:
                row.update(closure=receipt, phase="closed", observation_error=None)
                if row["cancellation"] == "requested":
                    row["cancellation"] = (
                        "acknowledged"
                        if receipt["reason"] == "cancelled"
                        else "too_late"
                    )
                self.state["outstanding_request_id"] = None
                self.touch(row)
                return
        if row["observation_error"] != error or row["phase"] != old_phase:
            row["observation_error"] = error
            self.touch(row)

    async def close(self, row):
        try:
            observed = await workflow.execute_activity(
                "birbverify_kubernetes_close",
                {
                    "request": row["payload"],
                    "reason": closure_reason(row["closure_trigger"]),
                },
                task_queue=self.config.activity_task_queue,
                start_to_close_timeout=timedelta(
                    seconds=max(125, self.config.activity_timeout_seconds)
                ),
                schedule_to_close_timeout=timedelta(
                    seconds=max(125, self.config.activity_timeout_seconds) + 5
                ),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
        except ActivityError:
            if row["observation_error"] != "closure_unavailable":
                row["observation_error"] = "closure_unavailable"
                self.touch(row)
        else:
            self.reconcile(row, observed)

    async def wait_for_change(self, timeout: timedelta | None = None):
        revision = self.state["revision"]
        try:
            await workflow.wait_condition(
                lambda: self.state["revision"] != revision, timeout=timeout
            )
        except TimeoutError:
            pass

    @workflow.run
    async def run(self, initial: dict) -> None:
        if workflow.info().workflow_id != self.config.authority.workflow_id:
            raise ApplicationError("noncanonical_target_workflow", non_retryable=True)
        while True:
            if (
                self.cycles >= self.config.continue_threshold
                or workflow.info().is_continue_as_new_suggested()
            ):
                await workflow.wait_condition(workflow.all_handlers_finished)
                workflow.continue_as_new(
                    {"config": self.config.model_dump(mode="json"), "state": self.state}
                )
            self.cycles += 1
            owner = self.state["outstanding_request_id"]
            if owner is not None:
                row = self.state["rows"][owner]
                if self.config.deployment:
                    await reconcile_deployment(self, row)
                    continue
                if row["phase"] == "running":
                    remaining = (
                        datetime.fromisoformat(row["payload"]["deadline"])
                        - workflow.now()
                    )
                    if remaining > timedelta(0):
                        await self.wait_for_change(remaining)
                        continue
                    self.request_closure(row, "deadline")
                    self.touch(row)
                if row["phase"] == "closing":
                    await self.close(row)
                    if row["phase"] == "closing":
                        delay = CLOSE_BACKOFF[row["close_attempts"]]
                        row["close_attempts"] = min(
                            len(CLOSE_BACKOFF) - 1, row["close_attempts"] + 1
                        )
                        await workflow.sleep(delay)
                else:
                    await self.wait_for_change()
                continue

            head = next(
                (
                    self.state["rows"][identity]
                    for identity in self.state["order"]
                    if self.state["rows"][identity]["phase"] == "queued"
                ),
                None,
            )
            if head is None:
                await self.wait_for_change()
                continue
            deadline = datetime.fromisoformat(head["payload"]["deadline"])
            remaining = deadline - workflow.now()
            if not self.config.deployment and remaining <= timedelta(
                seconds=self.config.activity_timeout_seconds
            ):
                head["phase"] = "expired"
                self.touch(head)
                continue
            identity = head["payload"]["request_id"]
            self.state["outstanding_request_id"] = identity
            head["phase"] = "dispatching"
            self.touch(head)
            if self.config.deployment:
                await dispatch_deployment(self, head)
                continue
            self.active = workflow.start_activity(
                "birbverify_kubernetes_execute",
                head["payload"],
                activity_id=identity,
                task_queue=self.config.activity_task_queue,
                start_to_close_timeout=timedelta(
                    seconds=self.config.activity_timeout_seconds
                ),
                schedule_to_close_timeout=remaining,
                heartbeat_timeout=timedelta(seconds=5),
                retry_policy=RetryPolicy(maximum_attempts=1),
                cancellation_type=workflow.ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
            )
            try:
                observed = await self.active
            except ActivityError:
                head["activity_outcome"] = "unknown"
                head["observation_error"] = "execution_unknown"
            else:
                self.record_execution(head, observed)
            finally:
                self.active = None
            trigger = head["closure_trigger"]
            if trigger is None and head["activity_outcome"] == "unknown":
                trigger = "execution_unknown"
            if trigger is None:
                head["phase"] = "running"
            else:
                self.request_closure(head, trigger)
            self.touch(head)

    def record_execution(self, row: dict, observed: dict):
        matching = isinstance(observed, dict) and (
            observed.get("request_id") == row["payload"]["request_id"]
            and observed.get("request_sha256") == row["request_sha256"]
        )
        active = (
            matching
            and observed.get("state") == "active"
            and isinstance(observed.get("pod_uid"), str)
            and bool(observed["pod_uid"])
        )
        row["activity_outcome"] = "completed" if active else "unknown"
        if not active:
            state = observed.get("state") if matching else None
            row["observation_error"] = (
                PRODUCER_RETENTION_ERRORS.get(state, "producer_not_active")
                if matching and isinstance(state, str)
                else "invalid_producer_evidence"
            )
