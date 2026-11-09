from datetime import timedelta
from uuid import NAMESPACE_URL, uuid5

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from birbcrew.execution.contract import (
        EXECUTION_RESULT,
        PUBLICATION_RESULT,
        ApprovedGoal,
        ExecutionInput,
        GoalOffer,
        PublicationInput,
        ReviewInput,
        ReviewReceipt,
        digest,
    )

    from delivery.model import Intent


@workflow.defn
class DeliveryWorkflow:
    @workflow.init
    def __init__(self, installation: dict):
        self.installation = installation
        self.offer = GoalOffer.model_validate(installation["offer"])
        self.offer_digest = digest(self.offer)
        self.revision = 0
        self.stage = {"kind": "awaiting_approval"}
        self.approved = None
        self.conversation = None
        self.commands = {}
        self.cancellation = "none"
        self.active = None
        self.candidate = None
        self.review_attempt = 0
        self.retry_review_requested = False

    def transition(self, stage):
        self.stage = stage
        self.revision += 1

    @workflow.update
    def command(self, raw: dict):
        intent = Intent.model_validate(raw)
        command = intent.body
        if intent.principal != self.installation["owner_principal"]:
            return {"ok": False, "status": 403, "code": "forbidden"}
        if intent.op != "command" or command is None:
            return {"ok": False, "status": 400, "code": "invalid_command"}
        identity = str(command.command_id)
        normalized = intent.model_dump(mode="json")
        previous = self.commands.get(identity)
        if previous:
            return (
                {"ok": True}
                if previous == normalized
                else {"ok": False, "status": 409, "code": "command_conflict"}
            )
        if len(self.commands) >= 128:
            return {"ok": False, "status": 429, "code": "command_capacity"}
        if command.offer_sha256 != self.offer_digest:
            return {"ok": False, "status": 409, "code": "stale_offer_or_revision"}
        if (
            self.approved
            and command.action == "approve"
            and self.conversation == str(intent.conversation_id)
        ):
            self.commands[identity] = normalized
            return {"ok": True}
        if command.expected_revision != self.revision:
            return {"ok": False, "status": 409, "code": "stale_offer_or_revision"}
        if self.conversation and self.conversation != str(intent.conversation_id):
            return {"ok": False, "status": 409, "code": "bound_elsewhere"}
        kind = self.stage["kind"]
        if command.action in {"approve", "reject"}:
            if kind != "awaiting_approval":
                return {"ok": False, "status": 409, "code": "already_decided"}
            self.conversation = str(intent.conversation_id)
            if command.action == "reject":
                self.transition({"kind": "rejected"})
            else:
                self.approved = ApprovedGoal(
                    delivery_id=uuid5(
                        NAMESPACE_URL,
                        self.installation["workflow_id"] + ":" + self.offer_digest,
                    ),
                    conversation_id=intent.conversation_id,
                    owner_principal=intent.principal,
                    approval_command_id=command.command_id,
                    offer=self.offer,
                    offer_sha256=self.offer_digest,
                )
                self.transition({"kind": "authoring"})
        elif command.action == "retry_review":
            if (
                kind != "uncertain"
                or self.stage.get("reason") != "review_inconclusive"
                or self.candidate is None
                or self.cancellation != "none"
            ):
                return {"ok": False, "status": 409, "code": "review_not_retryable"}
            self.review_attempt += 1
            self.retry_review_requested = True
            self.transition(
                {
                    "kind": "reviewing",
                    "candidate": self.candidate.model_dump(mode="json"),
                }
            )
        else:
            if (
                kind not in {"authoring", "reviewing", "publishing"}
                or self.cancellation != "none"
            ):
                return {"ok": False, "status": 409, "code": "not_cancellable"}
            self.cancellation = "requested"
            self.revision += 1
            if self.active:
                self.active.cancel()
        self.commands[identity] = normalized
        return {"ok": True}

    @workflow.query
    def installation_digest(self):
        return digest(self.installation)

    @workflow.query
    def snapshot(self):
        return {
            "revision": self.revision,
            "offer": self.offer.model_dump(mode="json"),
            "offer_sha256": self.offer_digest,
            "conversation_id": self.conversation,
            "delivery_id": str(self.approved.delivery_id) if self.approved else None,
            "stage": self.stage,
            "cancellation": self.cancellation,
            "command_ids": list(self.commands),
        }

    async def activity(self, name, value):
        self.active = workflow.start_activity(
            name,
            value.model_dump(mode="json"),
            task_queue=self.installation["activity_task_queue"],
            start_to_close_timeout=timedelta(hours=2),
            heartbeat_timeout=timedelta(seconds=90),
            retry_policy=RetryPolicy(maximum_attempts=3),
            cancellation_type=workflow.ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
        )
        try:
            return await self.active
        finally:
            self.active = None

    async def deliver(self):
        approved = self.approved
        if approved is None:
            raise ValueError("approval_required")
        if self.cancellation == "requested":
            self.cancellation = "acknowledged"
            self.transition(
                {"kind": "cancelled", "reason": "cancelled_before_dispatch"}
            )
            return
        execution = ExecutionInput(
            operation_id=approved.delivery_id, approved_goal=approved
        )
        result = EXECUTION_RESULT.validate_python(
            await self.activity("birbcrew.author_goal.v1", execution)
        )
        if result.status != "candidate":
            if result.status == "cancelled":
                self.cancellation = "acknowledged"
            self.transition({"kind": result.status, "reason": result.reason})
            return
        candidate = result.candidate
        if (
            candidate.repository_id != self.offer.repository_id
            or candidate.base_commit != self.offer.base_commit
            or candidate.acceptance.acceptance_id != self.offer.acceptance_id
        ):
            raise ValueError("candidate_binding_mismatch")
        if self.cancellation == "requested":
            self.transition(
                {
                    "kind": "uncertain",
                    "reason": "cancelled_authoring_returned_candidate",
                }
            )
            return
        self.candidate = candidate
        await self.review_and_publish(execution, candidate)

    async def review_and_publish(self, execution, candidate):
        if self.cancellation == "requested":
            self.cancellation = "acknowledged"
            self.transition(
                {"kind": "cancelled", "reason": "cancelled_before_review_dispatch"}
            )
            return
        self.transition(
            {"kind": "reviewing", "candidate": candidate.model_dump(mode="json")}
        )
        review = ReviewReceipt.model_validate(
            await self.activity(
                "birbcrew.review_candidate.v1",
                ReviewInput(
                    **execution.model_dump(),
                    candidate=candidate,
                    review_attempt=self.review_attempt,
                ),
            )
        )
        if (
            review.candidate_commit != candidate.head_commit
            or review.review_attempt != self.review_attempt
        ):
            raise ValueError("review_binding_mismatch")
        if self.cancellation == "requested":
            self.transition(
                {"kind": "uncertain", "reason": "cancellation_requires_confirmation"}
            )
            return
        if review.disposition == "inconclusive":
            self.transition(
                {
                    "kind": "uncertain",
                    "reason": "review_inconclusive"
                    if review.can_retry
                    else "review_interrupted_requires_recovery",
                }
            )
            return
        if review.disposition != "approved":
            self.transition(
                {
                    "kind": "changes_requested",
                    "candidate": candidate.model_dump(mode="json"),
                    "review": review.model_dump(mode="json"),
                }
            )
            return
        self.transition(
            {
                "kind": "publishing",
                "candidate": candidate.model_dump(mode="json"),
                "review": review.model_dump(mode="json"),
            }
        )
        published = PUBLICATION_RESULT.validate_python(
            await self.activity(
                "birbcrew.publish_draft.v1",
                PublicationInput(
                    **execution.model_dump(),
                    candidate=candidate,
                    review=review,
                    review_attempt=self.review_attempt,
                ),
            )
        )
        if published.status == "draft_ready":
            if (
                published.head_commit != candidate.head_commit
                or published.repository_id != candidate.repository_id
            ):
                raise ValueError("publication_binding_mismatch")
            self.transition(
                {
                    "kind": "draft_ready",
                    "candidate": candidate.model_dump(mode="json"),
                    "review": review.model_dump(mode="json"),
                    "draft": published.model_dump(mode="json"),
                }
            )
        else:
            if published.status == "cancelled":
                self.cancellation = "acknowledged"
            self.transition({"kind": published.status, "reason": published.reason})

    @workflow.run
    async def run(self, installation: dict):
        await workflow.wait_condition(lambda: self.stage["kind"] != "awaiting_approval")
        if self.approved:
            try:
                await self.deliver()
            except (ActivityError, ValueError):
                self.transition(
                    {"kind": "uncertain", "reason": "activity_or_receipt_unconfirmed"}
                )
        while True:
            await workflow.wait_condition(lambda: self.retry_review_requested)
            self.retry_review_requested = False
            try:
                await self.review_and_publish(
                    ExecutionInput(
                        operation_id=self.approved.delivery_id,
                        approved_goal=self.approved,
                    ),
                    self.candidate,
                )
            except (ActivityError, ValueError):
                self.transition(
                    {"kind": "uncertain", "reason": "activity_or_receipt_unconfirmed"}
                )
