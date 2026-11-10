from datetime import datetime, timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from verification.kubernetes import (
        KubernetesCommand,
        KubernetesQueueConfig,
        KubernetesState,
        bind_kubernetes,
        digest,
        failure,
        validate_closure,
    )


@workflow.defn
class KubernetesQueue:
    @workflow.init
    def __init__(self, initial: dict):
        self.config = KubernetesQueueConfig.model_validate(initial["config"])
        self.state: KubernetesState = initial.get(
            "state",
            {
                "revision": 0,
                "rows": {},
                "order": [],
                "commands": {},
                "outstanding_request_id": None,
            },
        )
        self.active = None
        self.cycles = 0

    def touch(self, row):
        row["revision"] += 1
        self.state["revision"] += 1

    @workflow.update
    def admit(self, message: dict) -> dict:
        intent = {
            **KubernetesCommand.model_validate(message["command"]).normalized(),
            "principal": message["principal"],
        }
        if (
            intent["op"] != "admit"
            or intent["principal"] != self.config.authority.owner_principal
        ):
            return failure("forbidden", 403)
        body = intent["body"]
        key = "admit:" + body["idempotency_key"]
        previous = self.state["commands"].get(key)
        if previous:
            return (
                previous["receipt"]
                if previous["intent"] == intent
                else failure("idempotency_conflict")
            )
        if body["request_id"] in self.state["rows"]:
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
            "closure_reason": None,
            "closure_trigger": None,
            "observation_error": None,
        }
        self.state["rows"][body["request_id"]] = row
        self.state["order"].append(body["request_id"])
        self.touch(row)
        receipt = {
            "ok": True,
            "request_id": body["request_id"],
            "revision": row["revision"],
        }
        self.state["commands"][key] = {"intent": intent, "receipt": receipt}
        return receipt

    @admit.validator
    def validate_admit(self, message: dict):
        if (
            set(message) != {"command", "principal"}
            or KubernetesCommand.model_validate(message["command"]).normalized()["op"]
            != "admit"
        ):
            raise ValueError("invalid_admission")

    @workflow.update
    def cancel(self, message: dict) -> dict:
        intent = {
            **KubernetesCommand.model_validate(message["command"]).normalized(),
            "principal": message["principal"],
        }
        if (
            intent["op"] != "cancel"
            or intent["principal"] != self.config.authority.owner_principal
        ):
            return failure("forbidden", 403)
        body = intent["body"]
        key = "cancel:" + body["command_id"]
        previous = self.state["commands"].get(key)
        if previous:
            return (
                previous["receipt"]
                if previous["intent"] == intent
                else failure("command_id_conflict")
            )
        row = self.state["rows"].get(body["request_id"])
        if row is None or row["intent"]["conversation_id"] != intent["conversation_id"]:
            return failure("request_not_found", 404)
        if body["expected_revision"] != row["revision"]:
            return failure("stale_revision")
        if row["cancellation"] != "none":
            return failure("cancellation_already_decided")
        if row["phase"] == "queued":
            row.update(phase="cancelled_before_dispatch", cancellation="acknowledged")
        elif row["phase"] in {"closed", "expired"}:
            row["cancellation"] = "too_late"
        elif row["closure_reason"] is not None:
            return failure("closure_already_decided")
        else:
            row["cancellation"] = "requested"
            row.update(closure_reason="cancelled", closure_trigger="cancel")
            if row["phase"] == "running":
                row["phase"] = "closing"
            if self.active is not None:
                self.active.cancel()
        self.touch(row)
        receipt = {
            "ok": True,
            "request_id": body["request_id"],
            "revision": row["revision"],
        }
        self.state["commands"][key] = {"intent": intent, "receipt": receipt}
        return receipt

    @cancel.validator
    def validate_cancel(self, message: dict):
        if (
            set(message) != {"command", "principal"}
            or KubernetesCommand.model_validate(message["command"]).normalized()["op"]
            != "cancel"
        ):
            raise ValueError("invalid_cancellation")

    @workflow.update
    def complete(self, message: dict) -> dict:
        intent = {
            **KubernetesCommand.model_validate(message["command"]).normalized(),
            "principal": message["principal"],
        }
        if (
            intent["op"] != "complete"
            or intent["principal"] != self.config.authority.owner_principal
        ):
            return failure("forbidden", 403)
        body = intent["body"]
        key = "complete:" + body["command_id"]
        previous = self.state["commands"].get(key)
        if previous:
            return (
                previous["receipt"]
                if previous["intent"] == intent
                else failure("command_id_conflict")
            )
        row = self.state["rows"].get(body["request_id"])
        if row is None or row["intent"]["conversation_id"] != intent["conversation_id"]:
            return failure("request_not_found", 404)
        if body["expected_revision"] != row["revision"]:
            return failure("stale_revision")
        if row["phase"] != "running" or row["closure_reason"] is not None:
            return failure("request_not_running")
        if datetime.fromisoformat(row["payload"]["deadline"]) <= workflow.now():
            return failure("request_deadline_elapsed")
        row.update(
            phase="closing", closure_reason="completed", closure_trigger="complete"
        )
        self.touch(row)
        receipt = {
            "ok": True,
            "request_id": body["request_id"],
            "revision": row["revision"],
        }
        self.state["commands"][key] = {"intent": intent, "receipt": receipt}
        return receipt

    @complete.validator
    def validate_complete(self, message: dict):
        if (
            set(message) != {"command", "principal"}
            or KubernetesCommand.model_validate(message["command"]).normalized()["op"]
            != "complete"
        ):
            raise ValueError("invalid_completion")

    @workflow.query
    def installation(self) -> dict:
        return {
            "config": self.config.model_dump(mode="json"),
            "workflow_task_queue": workflow.info().task_queue,
        }

    @workflow.query
    def snapshot(self) -> dict:
        return self.state

    def reconcile(self, row: dict, observed: dict):
        try:
            receipt = validate_closure(
                row["payload"], observed, self.config.authority.installation_sha256
            )
        except (ValueError, TypeError, KeyError, AttributeError):
            error = "invalid_producer_evidence"
        else:
            error = (
                "producer_quarantined"
                if observed.get("state") == "quarantined"
                else None
            )
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
        if row["observation_error"] != error:
            row["observation_error"] = error
            self.touch(row)

    async def close(self, row):
        try:
            observed = await workflow.execute_activity(
                "birbverify_kubernetes_close",
                {"request": row["payload"], "reason": row["closure_reason"]},
                task_queue=self.config.activity_task_queue,
                start_to_close_timeout=timedelta(
                    seconds=self.config.activity_timeout_seconds
                ),
                schedule_to_close_timeout=timedelta(
                    seconds=self.config.activity_timeout_seconds + 5
                ),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
        except ActivityError:
            if row["observation_error"] != "closure_unavailable":
                row["observation_error"] = "closure_unavailable"
                self.touch(row)
        else:
            self.reconcile(row, observed)

    @workflow.run
    async def run(self, initial: dict) -> None:
        if workflow.info().workflow_id != self.config.authority.workflow_id:
            raise ApplicationError("noncanonical_target_workflow", non_retryable=True)
        while True:
            self.cycles += 1
            owner = self.state["outstanding_request_id"]
            if owner is not None:
                row = self.state["rows"][owner]
                if (
                    row["phase"] == "running"
                    and datetime.fromisoformat(row["payload"]["deadline"])
                    <= workflow.now()
                ):
                    row.update(
                        phase="closing",
                        closure_reason="worker_lost",
                        closure_trigger="deadline",
                    )
                    self.touch(row)
                if row["phase"] == "closing":
                    await self.close(row)
            else:
                head = next(
                    (
                        self.state["rows"][identity]
                        for identity in self.state["order"]
                        if self.state["rows"][identity]["phase"] == "queued"
                    ),
                    None,
                )
                if head is not None:
                    deadline = datetime.fromisoformat(head["payload"]["deadline"])
                    if deadline <= workflow.now():
                        head["phase"] = "expired"
                        self.touch(head)
                    else:
                        identity = head["payload"]["request_id"]
                        self.state["outstanding_request_id"] = identity
                        head["phase"] = "dispatching"
                        self.touch(head)
                        self.active = workflow.start_activity(
                            "birbverify_kubernetes_execute",
                            head["payload"],
                            activity_id=identity,
                            task_queue=self.config.activity_task_queue,
                            start_to_close_timeout=timedelta(
                                seconds=self.config.activity_timeout_seconds
                            ),
                            schedule_to_close_timeout=deadline - workflow.now(),
                            heartbeat_timeout=timedelta(seconds=5),
                            retry_policy=RetryPolicy(maximum_attempts=1),
                            cancellation_type=workflow.ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
                        )
                        try:
                            await self.active
                            head["activity_outcome"] = "completed"
                        except ActivityError:
                            head["activity_outcome"] = "unknown"
                        finally:
                            self.active = None
                        if (
                            head["activity_outcome"] == "unknown"
                            and head["closure_reason"] is None
                        ):
                            head.update(
                                closure_reason="worker_lost",
                                closure_trigger="execution_unknown",
                            )
                        head["phase"] = (
                            "closing"
                            if head["closure_reason"] is not None
                            else "running"
                        )
                        self.touch(head)
                        continue
            if (
                self.cycles >= self.config.continue_threshold
                or workflow.info().is_continue_as_new_suggested()
            ):
                await workflow.wait_condition(workflow.all_handlers_finished)
                workflow.continue_as_new(
                    {"config": self.config.model_dump(mode="json"), "state": self.state}
                )
            await workflow.sleep(1)
