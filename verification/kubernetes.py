from datetime import datetime, timedelta
from typing import Annotated, Literal, TypedDict

from birbverify.contract import Commit, Id, Record, RequestId, Sha, digest
from birbverify.kubernetes_contract import (
    Image,
    KubernetesBinding,
    KubernetesClosureReceipt,
    KubernetesRequest,
)
from pydantic import Field


class KubernetesAdmission(Record):
    request_id: RequestId
    idempotency_key: Id
    candidate_revision: Commit
    authored_revision: Commit
    beans_issue: Id
    approved_plan_sha256: Sha


class KubernetesRevisionCommand(Record):
    request_id: RequestId
    command_id: Id
    expected_revision: Annotated[int, Field(strict=True, ge=0)]


class KubernetesCommand(Record):
    op: Literal["admit", "cancel", "complete", "snapshot"]
    conversation_id: Id
    body: dict

    def normalized(self) -> dict:
        body = self.body
        if self.op == "admit":
            body = KubernetesAdmission.model_validate(body).model_dump(mode="json")
        elif self.op in {"cancel", "complete"}:
            body = KubernetesRevisionCommand.model_validate(body).model_dump(
                mode="json"
            )
        elif body:
            raise ValueError("snapshot_body_not_empty")
        return {**self.model_dump(mode="json"), "body": body}


class KubernetesAuthority(Record):
    target: KubernetesBinding
    candidate_revision: Commit
    authored_revision: Commit
    beans_issue: Id
    producer_revision: Commit
    installation_sha256: Sha
    policy_revision: Commit
    plan_sha256: Sha
    image: Image
    owner_principal: Id = "owner"
    scope: Literal["account-auth"] = "account-auth"

    @property
    def workflow_id(self) -> str:
        return "birbforge-kubernetes-" + digest(
            {
                "cluster_uid": self.target.cluster_uid,
                "namespace_uid": self.target.namespace_uid,
            }
        )


class KubernetesQueueConfig(Record):
    authority: KubernetesAuthority
    activity_task_queue: Id
    max_requests: Annotated[int, Field(strict=True, ge=1, le=128)] = 128
    continue_threshold: Annotated[int, Field(strict=True, ge=2, le=10000)] = 100
    request_timeout_seconds: Annotated[int, Field(strict=True, ge=10, le=3600)] = 300
    activity_timeout_seconds: Annotated[int, Field(strict=True, ge=5, le=300)] = 30


class KubernetesConfig(Record):
    queue: KubernetesQueueConfig
    temporal_address: str
    namespace: str = "default"
    workflow_task_queue: Id


class KubernetesRow(TypedDict):
    intent: dict
    payload: dict
    request_sha256: str
    revision: int
    phase: Literal[
        "queued",
        "dispatching",
        "running",
        "closing",
        "closed",
        "expired",
        "cancelled_before_dispatch",
    ]
    cancellation: Literal["none", "requested", "acknowledged", "too_late"]
    activity_outcome: Literal["completed", "unknown"] | None
    closure_reason: Literal["completed", "cancelled", "worker_lost"] | None
    closure_trigger: (
        Literal["complete", "cancel", "execution_unknown", "deadline"] | None
    )
    closure: dict | None
    observation_error: str | None


class KubernetesState(TypedDict):
    revision: int
    rows: dict[str, KubernetesRow]
    order: list[str]
    commands: dict[str, dict]
    outstanding_request_id: str | None


def failure(code: str, status: int = 409) -> dict:
    return {"ok": False, "code": code, "status": status}


def bind_kubernetes(intent: dict, config: KubernetesQueueConfig, now: datetime) -> dict:
    body = KubernetesAdmission.model_validate(intent["body"])
    authority = config.authority
    if intent["principal"] != authority.owner_principal:
        raise ValueError("forbidden")
    for field in ("candidate_revision", "authored_revision", "beans_issue"):
        if getattr(body, field) != getattr(authority, field):
            raise ValueError(field + "_not_current")
    if body.approved_plan_sha256 != authority.plan_sha256:
        raise ValueError("plan_not_approved")
    return KubernetesRequest(
        request_id=body.request_id,
        candidate_revision=authority.candidate_revision,
        producer_revision=authority.producer_revision,
        policy_revision=authority.policy_revision,
        plan_sha256=authority.plan_sha256,
        target=authority.target,
        image=authority.image,
        deadline=now + timedelta(seconds=config.request_timeout_seconds),
    ).model_dump(mode="json")


def validate_closure(
    payload: dict, observed: dict, installation_sha256: str
) -> dict | None:
    if not isinstance(observed, dict):
        raise TypeError("observation_invalid")
    request = KubernetesRequest.model_validate(payload)
    request_sha256 = digest(request)
    if (
        observed.get("request_id") != request.request_id
        or observed.get("request_sha256") != request_sha256
    ):
        raise ValueError("observation_request_mismatch")
    receipt = observed.get("receipt")
    if observed.get("state") != "released":
        if receipt is not None:
            raise ValueError("receipt_without_release")
        return None
    if not isinstance(receipt, dict):
        raise TypeError("release_receipt_missing")
    expected = {
        "schema_version": "birbverify.kubernetes.closure.v1",
        "request_id": request.request_id,
        "image": request.image,
        "installation_sha256": installation_sha256,
        "pod_uid": observed.get("pod_uid"),
        "request_sha256": request_sha256,
        "candidate_revision": request.candidate_revision,
        "producer_revision": request.producer_revision,
        "policy_revision": request.policy_revision,
        "plan_sha256": request.plan_sha256,
        "target": request.target.model_dump(mode="json"),
        "state": "released",
    }
    if any(receipt.get(key) != value for key, value in expected.items()):
        raise ValueError("closure_binding_mismatch")
    if receipt.get("reason") != observed.get("reason") or receipt.get("reason") not in {
        "completed",
        "cancelled",
        "worker_lost",
    }:
        raise ValueError("closure_reason_invalid")
    if receipt.get("operations_sha256") != digest(observed.get("operations", {})):
        raise ValueError("closure_operations_mismatch")
    if receipt.get("terminal_proof") != observed.get("terminal_proof"):
        raise ValueError("closure_terminal_proof_mismatch")
    unsigned = {key: value for key, value in receipt.items() if key != "receipt_sha256"}
    KubernetesClosureReceipt.model_validate(unsigned)
    operations = observed.get("operations", {})
    if not isinstance(operations, dict) or "restore-revision" not in operations:
        raise ValueError("closure_restore_missing")
    if any(
        not isinstance(effect, dict) or effect.get("state") != "settled"
        for effect in operations.values()
    ):
        raise ValueError("closure_unsettled_effect")
    for effect in operations.values():
        response = effect.get("response")
        if not isinstance(response, dict) or not isinstance(
            response.get("metadata", {}), dict
        ):
            raise TypeError("closure_effect_invalid")
    created = operations.get("create-pod")
    if created is not None:
        uid = created["response"].get("metadata", {}).get("uid")
        proof = observed.get("terminal_proof")
        if not uid or uid != observed.get("pod_uid"):
            raise ValueError("closure_pod_uid_mismatch")
        if (
            "remove-finalizer" not in operations
            or not isinstance(proof, dict)
            or proof.get("phase") not in {"Succeeded", "Failed"}
        ):
            raise ValueError("closure_terminal_proof_missing")
        statuses = proof.get("containerStatuses")
        if (
            not isinstance(statuses, list)
            or not statuses
            or any(
                not isinstance(status, dict)
                or not isinstance(status.get("state"), dict)
                or set(status["state"]) != {"terminated"}
                or not isinstance(status["state"]["terminated"], dict)
                for status in statuses
            )
        ):
            raise ValueError("closure_containers_not_terminal")
    effects = {
        name: {
            "body_sha256": effect["body_sha256"],
            "object_uid": effect["response"].get("metadata", {}).get("uid")
            or effect.get("expected_uid"),
            "expected_resource_version": effect.get("expected_resource_version"),
            "resource_version": effect["response"]
            .get("metadata", {})
            .get("resourceVersion"),
        }
        for name, effect in operations.items()
    }
    if receipt["effects"] != effects:
        raise ValueError("closure_effects_mismatch")
    if receipt.get("receipt_sha256") != digest(unsigned):
        raise ValueError("closure_digest_mismatch")
    return receipt


def projection(state: dict, principal: str, conversation_id: str) -> dict:
    rows = []
    for identity in state["order"]:
        row = state["rows"][identity]
        intent = row["intent"]
        if (
            intent["principal"] != principal
            or intent["conversation_id"] != conversation_id
        ):
            continue
        rows.append(
            {
                "request_id": identity,
                "candidate_revision": row["payload"]["candidate_revision"],
                "beans_issue": intent["body"]["beans_issue"],
                "authored_revision": intent["body"]["authored_revision"],
                "request_sha256": row["request_sha256"],
                "revision": row["revision"],
                "phase": row["phase"],
                "cancellation": row["cancellation"],
                "closure": row["closure"],
                "requested_closure_reason": row["closure_reason"],
                "closure_trigger": row["closure_trigger"],
                "observation_error": row["observation_error"],
                "eligibility": {"eligible": False, "reason": "delivery_not_authorized"},
            }
        )
    return {
        "revision": state["revision"],
        "requests": rows,
        "target_retained": state["outstanding_request_id"] is not None,
    }


def check_installation(config: KubernetesConfig, installed: dict) -> None:
    expected = {
        "config": config.queue.model_dump(mode="json"),
        "workflow_task_queue": config.workflow_task_queue,
    }
    if installed != expected:
        raise ValueError("running_installation_mismatch")
