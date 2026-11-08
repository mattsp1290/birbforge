from datetime import datetime, timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError, CancelledError

with workflow.unsafe.imports_passed_through():
    from birbverify.contract import digest

    from verification.diagnostics import event_json
    from verification.model import (
        BindingInstallation,
        Command,
        ProducerObservation,
        QueueRow,
        QueueState,
        bind,
        failure,
    )


@workflow.defn
class EnvironmentQueue:
    @workflow.init
    def __init__(self, initial: dict):
        self.state: QueueState = initial.get(
            "state",
            {
                "revision": 0,
                "requests": [],
                "commands": {},
                "outstanding_request_id": None,
            },
        )
        self.config = initial["config"]
        self.closure_mode = self.config.get("profile") == "closure-v2"
        if self.closure_mode and "outstanding_request_id" not in self.state:
            raise ValueError("legacy_history_migration_unsupported")
        self.active = None
        self.cycles = 0

    def touch(self, row):
        row["revision"] += 1
        self.state["revision"] += 1

    def diagnostic(self, event, row):
        workflow.logger.info(
            event_json(
                event,
                request_id=row["payload"]["request_id"],
                attempt_id=row["attempt_id"],
                source_id="environment_queue",
                timestamp=workflow.now().isoformat(),
            )
        )

    @workflow.update
    def admit(self, message: dict) -> dict:
        intent = Command.model_validate(message["intent"]).normalized()
        if (
            intent["op"] != "admit"
            or intent["principal"] != self.config["owner_principal"]
        ):
            return failure("forbidden", 403)
        for row in self.state["requests"]:
            old = row["intent"]
            if old["body"]["idempotency_key"] == intent["body"]["idempotency_key"]:
                return (
                    {"ok": True, "request_id": row["payload"]["request_id"]}
                    if old == intent
                    else failure("idempotency_conflict")
                )
            if old["body"]["request_id"] == intent["body"]["request_id"]:
                return failure("request_id_conflict")
        if len(self.state["requests"]) >= self.config["max_requests"]:
            return failure("queue_capacity", 429)
        try:
            payload = bind(intent, message["installation"], workflow.now())
        except Exception:  # noqa: BLE001
            return failure("installation_denied", 403)
        admission_binding = message["installation"].get("closure_binding")
        if self.closure_mode and admission_binding != self.config["closure_binding"]:
            return failure("admission_target_changed", 403)
        if not self.closure_mode and admission_binding is not None:
            return failure("legacy_profile_cannot_access_closure_target", 403)
        row: QueueRow = {
            "admission_binding": admission_binding,
            "intent": intent,
            "payload": payload,
            "request_sha256": digest(payload),
            "revision": 0,
            "phase": "queued",
            "cancellation": "none",
            "cancellation_command_ids": [],
            "attempt_id": None,
            "manifest": None,
            "activity_outcome": None,
        }
        self.state["requests"].append(row)
        self.touch(row)
        self.diagnostic("admitted", row)
        if any(
            item["phase"] in {"queued", "dispatching", "running", "uncertain"}
            for item in self.state["requests"][:-1]
        ):
            self.diagnostic("queue_wait", row)
        return {"ok": True, "request_id": payload["request_id"]}

    @admit.validator
    def validate_admit(self, message: dict):
        if not isinstance(message, dict) or set(message) != {"intent", "installation"}:
            raise ValueError("invalid_admission")
        if Command.model_validate(message["intent"]).normalized()["op"] != "admit":
            raise ValueError("invalid_admission")
        BindingInstallation.model_validate(message["installation"])

    @workflow.update
    def cancel(self, message: dict) -> dict:
        intent = Command.model_validate(message).normalized()
        if (
            intent["op"] != "cancel"
            or intent["principal"] != self.config["owner_principal"]
        ):
            return failure("forbidden", 403)
        body = intent["body"]
        row = next(
            (
                row
                for row in self.state["requests"]
                if row["payload"]["request_id"] == body["request_id"]
                and row["intent"]["principal"] == intent["principal"]
                and row["intent"]["conversation_id"] == intent["conversation_id"]
            ),
            None,
        )
        if row is None:
            return failure("request_not_found", 404)
        old = self.state["commands"].get(body["command_id"])
        if old:
            return (
                old["receipt"]
                if old["intent"] == intent
                else failure("command_id_conflict")
            )
        if body["expected_revision"] != row["revision"]:
            return failure("stale_revision")
        if row["cancellation_command_ids"]:
            return failure("cancellation_already_decided")
        row["cancellation_command_ids"].append(body["command_id"])
        if row["phase"] in {"terminal", "expired", "not_acquired", "closed"}:
            row["cancellation"] = "too_late"
        elif row["phase"] == "queued":
            row.update(phase="cancelled_before_dispatch", cancellation="acknowledged")
        else:
            row["cancellation"] = "requested"
        self.touch(row)
        self.diagnostic("cancellation_requested", row)
        receipt = {"ok": True, "request_id": body["request_id"]}
        self.state["commands"][body["command_id"]] = {
            "intent": intent,
            "receipt": receipt,
        }
        if self.active is not None and row["phase"] in {"dispatching", "running"}:
            self.active.cancel()
        return receipt

    @cancel.validator
    def validate_cancel(self, message: dict):
        if Command.model_validate(message).normalized()["op"] != "cancel":
            raise ValueError("invalid_cancellation")

    @workflow.query
    def snapshot(self) -> dict:
        return self.state

    async def inspect(self):
        return await workflow.execute_activity(
            "inspect_verification",
            {"rows": self.state["requests"], "binding": self.config["closure_binding"]}
            if self.closure_mode
            else [
                row["payload"]["request_id"]
                for row in self.state["requests"]
                if row["phase"] in {"dispatching", "running", "uncertain"}
            ],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )

    def reconcile(self, observation: ProducerObservation):
        for row in self.state["requests"]:
            fact = observation["requests"].get(row["payload"]["request_id"])
            before = (
                row["attempt_id"],
                row["phase"],
                row["cancellation"],
                row["manifest"],
            )
            if fact is not None:
                row["attempt_id"] = fact["attempt_id"] or row["attempt_id"]
                if fact["manifest"]:
                    if row["manifest"] is None:
                        row["manifest"] = fact["manifest"]
                        self.diagnostic(
                            "manifest_recorded"
                            if fact["manifest"]["environment_release"] == "released"
                            else "worker_uncertain",
                            row,
                        )
                    elif row["manifest"] != fact["manifest"]:
                        self.diagnostic("manifest_conflict", row)
                    row["phase"] = "terminal"
                elif (
                    not self.closure_mode
                    and row["phase"] == "uncertain"
                    and row["attempt_id"] is None
                    and row.get("activity_outcome") in {"cancelled", "rejected"}
                ):
                    row["phase"] = "not_acquired"
                    if row["cancellation"] == "requested":
                        row["cancellation"] = "acknowledged"
            if (
                self.closure_mode
                and fact
                and fact.get("release_confirmed")
                and self.state["outstanding_request_id"] == row["payload"]["request_id"]
            ):
                self.state["outstanding_request_id"] = None
                self.state["revision"] += 1
                if row["manifest"] is None:
                    row["phase"] = "closed"
                if (
                    row["cancellation"] == "requested"
                    and fact.get("closure", {}).get("kind") == "released"
                ):
                    row["cancellation"] = "acknowledged"
            if row["manifest"] and row["cancellation"] == "requested":
                manifest = row["manifest"]
                if (
                    manifest["cancellation"] == "acknowledged"
                    or row["attempt_id"] in observation["recovered_attempts"]
                ):
                    row["cancellation"] = "acknowledged"
                elif manifest["termination"] == "confirmed":
                    row["cancellation"] = "too_late"
            if before != (
                row["attempt_id"],
                row["phase"],
                row["cancellation"],
                row["manifest"],
            ):
                self.touch(row)

    def expire_queued(self):
        for row in self.state["requests"]:
            if (
                row["phase"] == "queued"
                and datetime.fromisoformat(row["payload"]["resources"]["deadline"])
                <= workflow.now()
            ):
                row["phase"] = "expired"
                self.touch(row)

    @workflow.run
    async def run(self, initial: dict) -> None:
        while True:
            self.cycles += 1
            self.expire_queued()
            try:
                observed = await self.inspect()
            except ActivityError:
                observed = None
            if observed:
                self.reconcile(observed)
            head = next(
                (
                    row
                    for row in self.state["requests"]
                    if row["phase"]
                    not in {
                        "terminal",
                        "cancelled_before_dispatch",
                        "expired",
                        "not_acquired",
                        "closed",
                    }
                ),
                None,
            )
            if head and head["phase"] == "queued" and head["cancellation"] == "none":
                deadline = datetime.fromisoformat(
                    head["payload"]["resources"]["deadline"]
                )
                if deadline <= workflow.now():
                    head["phase"] = "expired"
                    self.touch(head)
                elif (
                    observed
                    and observed["environment"]["state"] == "free"
                    and (
                        not self.closure_mode
                        or self.state["outstanding_request_id"] is None
                    )
                ):
                    if self.closure_mode:
                        self.state["outstanding_request_id"] = head["payload"][
                            "request_id"
                        ]
                    head["phase"] = "dispatching"
                    self.touch(head)
                    self.active = workflow.start_activity(
                        "verify_candidate",
                        head["payload"],
                        activity_id=head["payload"]["request_id"],
                        task_queue=self.config["activity_task_queue"],
                        start_to_close_timeout=timedelta(seconds=90),
                        schedule_to_close_timeout=deadline - workflow.now(),
                        heartbeat_timeout=timedelta(seconds=15),
                        retry_policy=RetryPolicy(maximum_attempts=1),
                        cancellation_type=workflow.ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
                    )
                    try:
                        await self.active
                        head["activity_outcome"] = "completed"
                    except ActivityError as error:
                        head["activity_outcome"] = (
                            "cancelled"
                            if isinstance(error.cause, CancelledError)
                            else "rejected"
                            if isinstance(error.cause, ApplicationError)
                            and error.cause.non_retryable
                            else "unknown"
                        )
                        self.diagnostic("worker_uncertain", head)
                    finally:
                        self.active = None
                    head["phase"] = "uncertain"
                    self.touch(head)
                    continue
            if (
                self.cycles >= self.config["continue_threshold"]
                or workflow.info().is_continue_as_new_suggested()
            ):
                await workflow.wait_condition(workflow.all_handlers_finished)
                workflow.continue_as_new({"config": self.config, "state": self.state})
            await workflow.sleep(1)
