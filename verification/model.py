from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal, TypedDict
from uuid import UUID

from birbverify.contract import Plan, Request
from birbverify.policy import authorize
from pydantic import BaseModel, ConfigDict, Field

RequestPhase = Literal[
    "queued",
    "dispatching",
    "running",
    "uncertain",
    "terminal",
    "cancelled_before_dispatch",
    "expired",
    "not_acquired",
]
CancellationState = Literal["none", "requested", "acknowledged", "too_late"]


class QueueRow(TypedDict):
    intent: dict
    payload: dict
    request_sha256: str
    revision: int
    phase: RequestPhase
    cancellation: CancellationState
    cancellation_command_ids: list[str]
    attempt_id: str | None
    manifest: dict | None
    activity_outcome: Literal["cancelled", "rejected", "unknown", "completed"] | None


class QueueState(TypedDict):
    revision: int
    requests: list[QueueRow]
    commands: dict[str, dict]


class ProducerObservation(TypedDict):
    environment: dict
    requests: dict[str, dict]
    recovered_attempts: list[str]


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BindingInstallation(Record):
    fixture_mode: Literal[True]
    passing: Annotated[str, Field(pattern=r"^[0-9a-f]{40}$")]
    current_candidate: Annotated[str, Field(pattern=r"^[0-9a-f]{40}$")] | None = None
    plan: Plan
    plan_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    policy_revision: Annotated[str, Field(pattern=r"^[0-9a-f]{40}$")]

    @classmethod
    def from_installed(cls, installed: dict):
        return cls.model_validate(
            {key: value for key, value in installed.items() if key in cls.model_fields}
        ).model_dump(mode="json", exclude_none=True)


class Config(Record):
    installation_root: Path
    temporal_address: str
    namespace: str = "default"
    workflow_id: str
    workflow_task_queue: str
    activity_task_queue: str
    owner_principal: Literal["owner"] = "owner"
    max_requests: Annotated[int, Field(strict=True, ge=1, le=128)] = 128
    continue_threshold: Annotated[int, Field(strict=True, ge=2, le=10000)] = 100


class Admission(Record):
    request_id: UUID
    idempotency_key: UUID
    candidate_commit: Annotated[str, Field(pattern=r"^[0-9a-f]{40}$")]
    approved_plan_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class Cancellation(Record):
    request_id: UUID
    command_id: UUID
    expected_revision: Annotated[int, Field(strict=True, ge=0)]


class Command(Record):
    op: Literal["admit", "cancel", "snapshot"]
    principal: Annotated[str, Field(min_length=1, max_length=96)]
    conversation_id: UUID
    body: dict

    def normalized(self):
        body = self.body
        if self.op == "admit":
            body = Admission.model_validate(body).model_dump(mode="json")
        elif self.op == "cancel":
            body = Cancellation.model_validate(body).model_dump(mode="json")
        elif body:
            raise ValueError("snapshot_body_not_empty")
        return {**self.model_dump(mode="json"), "body": body}


def failure(code, status=409):
    return {"ok": False, "status": status, "code": code}


def bind(intent: dict, installation: dict, now: datetime) -> dict:
    installation = BindingInstallation.model_validate(installation).model_dump(
        mode="json", exclude_none=True
    )
    body = intent["body"]
    if body["candidate_commit"] != installation.get(
        "current_candidate", installation["passing"]
    ):
        raise ValueError("candidate_not_current")
    if body["approved_plan_sha256"] != installation["plan_sha256"]:
        raise ValueError("plan_not_approved")
    identity = body["request_id"]
    request = Request.model_validate(
        {
            "contract_version": "birbverify.v1",
            "request_id": identity,
            "idempotency_key": body["idempotency_key"],
            "goal_id": intent["conversation_id"],
            "pull_request": "pr-1",
            "correlation_id": identity,
            "candidate": {
                "repository": "fixture",
                "commit": body["candidate_commit"],
                "pr_head": body["candidate_commit"],
                "base": installation["passing"],
                "kind": "head",
            },
            "plan": installation["plan"],
            "plan_sha256": installation["plan_sha256"],
            "authority": {
                "principal": "fixture-owner",
                "workflow": "forge-fixture",
                "policy_revision": installation["policy_revision"],
                "environment": "fixture-local",
                "permitted_operations": ["fixture.apply", "fixture.reset"],
            },
            "resources": {
                "capabilities": ["linux-docker"],
                "fixture": "isolated-counter-v1",
                "timeout_seconds": 30,
                "max_attempts": 1,
                "deadline": now + timedelta(seconds=150),
            },
            "evidence": {
                "classification": "private",
                "retention": "fixture-local-until-owner-deletes-v1",
                "telemetry_correlation": identity,
            },
            "components": ["fixture-counter"],
            "revision_method": "git-archive-and-target-receipt-v1",
        }
    )
    authorize(request, installation)
    return request.model_dump(mode="json")


def public_row(row: QueueRow):
    intent, payload = row["intent"], row["payload"]
    return {
        "request_id": payload["request_id"],
        "idempotency_key": payload["idempotency_key"],
        "conversation_id": intent["conversation_id"],
        "principal": intent["principal"],
        "request_sha256": row["request_sha256"],
        "candidate_commit": payload["candidate"]["commit"],
        "plan_sha256": payload["plan_sha256"],
        "revision": row["revision"],
        "phase": row["phase"],
        "cancellation": row["cancellation"],
        "cancellation_command_ids": row["cancellation_command_ids"],
        "attempt_id": row["attempt_id"],
        "outcome": row["manifest"]["outcome"] if row["manifest"] else None,
        "manifest": row["manifest"],
        "eligibility": {"eligible": False, "reason": "not_passed"},
    }
