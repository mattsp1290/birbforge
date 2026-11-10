import json
from datetime import datetime, timedelta
from typing import Annotated, Literal, NotRequired, TypedDict

from birbverify.contract import Commit, Id, Record, RequestId, Sha, digest
from birbverify.kubernetes_contract import (
    Image,
    KubernetesBinding,
    KubernetesReceipt,
    KubernetesRequest,
)
from pydantic import AwareDatetime, Field, RootModel, TypeAdapter

from verification.deployment_runtime import DeploymentRuntime
from verification.temporal_transport import TemporalTLS

MAX_CLOSURE_BYTES = 8192


class KubernetesAdmission(Record):
    request_id: RequestId = Field(max_length=63)
    idempotency_key: Id
    candidate_revision: Commit
    authored_revision: Commit
    beans_issue: Id
    approved_plan_sha256: Sha


class KubernetesRevisionCommand(Record):
    request_id: RequestId = Field(max_length=63)
    command_id: Id
    expected_revision: Annotated[int, Field(strict=True, ge=0)]


class KubernetesAdmissionCommand(Record):
    op: Literal["admit"]
    conversation_id: Id
    body: KubernetesAdmission


class KubernetesMutationCommand(Record):
    op: Literal["cancel", "complete"]
    conversation_id: Id
    body: KubernetesRevisionCommand


class KubernetesSnapshotCommand(Record):
    op: Literal["snapshot"]
    conversation_id: Id
    body: Annotated[dict, Field(max_length=0)]


class KubernetesCommand(
    RootModel[
        Annotated[
            KubernetesAdmissionCommand
            | KubernetesMutationCommand
            | KubernetesSnapshotCommand,
            Field(discriminator="op"),
        ]
    ]
):
    def normalized(self) -> dict:
        return self.root.model_dump(mode="json")


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


class DeploymentQueueProfile(Record):
    request_id: RequestId = Field(max_length=63)
    request_sha256: Sha
    activity_installation_sha256: Sha
    producer_package_sha256: Sha
    ownership_server_cert_sha256: Sha
    epoch: Id
    deadline: AwareDatetime
    verifier_task_queue: Id

    @property
    def invocation(self) -> dict:
        return self.model_dump(include={"request_id", "request_sha256", "epoch"})

    @property
    def operation_id(self) -> str:
        return digest(
            {
                "invocation": self.invocation,
                "installation": self.activity_installation_sha256,
            }
        )


class KubernetesQueueConfig(Record):
    authority: KubernetesAuthority
    deployment: DeploymentQueueProfile | None = Field(
        default=None, exclude_if=lambda profile: profile is None
    )
    activity_task_queue: Id
    max_requests: Annotated[int, Field(strict=True, ge=1, le=128)] = 128
    continue_threshold: Annotated[int, Field(strict=True, ge=2, le=10000)] = 100
    request_timeout_seconds: Annotated[int, Field(strict=True, ge=10, le=3600)] = 300
    activity_timeout_seconds: Annotated[int, Field(strict=True, ge=5, le=300)] = 30


class KubernetesConfig(Record):
    queue: KubernetesQueueConfig
    temporal_address: str
    temporal_tls: TemporalTLS | None = None
    deployment_runtime: DeploymentRuntime | None = None
    namespace: str = "default"
    workflow_task_queue: Id


ClosureTrigger = Literal["complete", "cancel", "execution_unknown", "deadline"]
ClosureReason = Literal["completed", "cancelled", "worker_lost"]
CLOSURE_REASONS: dict[ClosureTrigger, ClosureReason] = {
    "complete": "completed",
    "cancel": "cancelled",
    "execution_unknown": "worker_lost",
    "deadline": "worker_lost",
}


def closure_reason(trigger: ClosureTrigger | None) -> ClosureReason | None:
    return CLOSURE_REASONS[trigger] if trigger is not None else None


class DeploymentRecord(TypedDict):
    operation_id: str
    lookup_status: Literal["unavailable", "absent", "pending", "recorded"]
    result: dict | None
    seal_observation: dict | None


class KubernetesRow(TypedDict):
    deployment: NotRequired[DeploymentRecord]
    intent: dict
    payload: dict
    request_sha256: str
    revision: int
    phase: Literal[
        "queued",
        "dispatching",
        "running",
        "closing",
        "retained",
        "closed",
        "expired",
        "cancelled_before_dispatch",
    ]
    cancellation: Literal["none", "requested", "acknowledged", "too_late"]
    activity_outcome: Literal["completed", "unknown"] | None
    closure_trigger: ClosureTrigger | None
    closure: dict | None
    observation_error: str | None
    close_attempts: Annotated[int, Field(strict=True, ge=0, le=4)]


class KubernetesState(TypedDict):
    revision: int
    rows: dict[str, KubernetesRow]
    order: list[str]
    commands: dict[str, dict]
    outstanding_request_id: str | None


STATE_ADAPTER = TypeAdapter(KubernetesState)


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
    if profile := config.deployment:
        if body.request_id != profile.request_id:
            raise ValueError("request_not_installed")
        return {
            "request_id": body.request_id,
            "candidate_revision": authority.candidate_revision,
            "deadline": profile.deadline.isoformat(),
        }
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
    if observed.get("request_id") != request.request_id or observed.get(
        "request_sha256"
    ) != digest(request):
        raise ValueError("observation_request_mismatch")
    state = observed.get("state")
    if not isinstance(state, str) or state not in {
        "active",
        "closing",
        "released",
        "quarantined",
        "sealed_unadmitted",
    }:
        raise ValueError("observation_state_invalid")
    receipt = observed.get("receipt")
    if observed.get("state") != "released":
        if receipt is not None:
            raise ValueError("receipt_without_release")
        return None
    if not isinstance(receipt, dict):
        raise TypeError("release_receipt_missing")
    if len(json.dumps(receipt, separators=(",", ":")).encode()) > MAX_CLOSURE_BYTES:
        raise ValueError("closure_receipt_too_large")
    KubernetesReceipt.model_validate(receipt)
    _validate_binding(request, observed, receipt, installation_sha256)
    _validate_release_evidence(observed, receipt)
    return receipt


def _validate_binding(
    request: KubernetesRequest, observed: dict, receipt: dict, installation_sha256: str
):
    expected = {
        "schema_version": "birbverify.kubernetes.closure.v1",
        "request_id": request.request_id,
        "image": request.image,
        "installation_sha256": installation_sha256,
        "pod_uid": observed.get("pod_uid"),
        "request_sha256": digest(request),
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


def _validate_release_evidence(observed: dict, receipt: dict):
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
    if receipt["operations_sha256"] != digest(operations):
        raise ValueError("closure_operations_mismatch")
    if receipt["terminal_proof"] != observed.get("terminal_proof"):
        raise ValueError("closure_terminal_proof_mismatch")
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
    if receipt["effects"] != _closure_effects(operations):
        raise ValueError("closure_effects_mismatch")


def _closure_effects(operations: dict) -> dict:
    return {
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
                "requested_closure_reason": closure_reason(row["closure_trigger"]),
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
