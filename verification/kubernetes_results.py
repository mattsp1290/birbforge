"""Provisional consumer contract. No installed producer emits this contract yet."""

import json
from datetime import datetime, timedelta
from typing import Annotated, Literal, get_args

from birbverify.contract import Commit, Id, Record, RequestId, Sha, digest
from birbverify.kubernetes_contract import (
    Image,
    KubernetesBinding,
    KubernetesReceipt,
    KubernetesRequest,
)
from pydantic import AwareDatetime, ConfigDict, Field, RootModel

from verification.kubernetes import validate_closure

AssertionId = Literal[
    "account_create",
    "login_success",
    "authenticated_identity",
    "invalid_credentials_rejected",
    "unauthenticated_access_rejected",
]
REQUIRED_ASSERTIONS = get_args(AssertionId)
MAX_RESULT_BYTES = 8192


class VerificationProfile(Record):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)
    verifier_identity: Id
    verifier_revision: Commit
    reviewer_identity: Id
    suite_sha256: Sha
    max_age_seconds: Annotated[int, Field(ge=1, le=3600)]


class VerificationBinding(Record):
    request_id: RequestId
    request_sha256: Sha
    workflow_id: Id
    candidate_revision: Commit
    authored_revision: Commit
    beans_issue: Id
    producer_revision: Commit
    policy_revision: Commit
    plan_sha256: Sha
    installation_sha256: Sha
    target: KubernetesBinding
    image: Image
    pod_uid: Id
    dispatched_at: AwareDatetime
    deadline: AwareDatetime


class AssertionOutcome(Record):
    assertion: AssertionId
    outcome: Literal["passed", "failed", "unknown"]


class ApplicationResult(Record):
    schema_version: Literal["birbverify.account-auth.result.v1"]
    operation_id: Sha
    binding: VerificationBinding
    verifier_identity: Id
    verifier_revision: Commit
    reviewer_identity: Id
    suite_sha256: Sha
    running_image: Image
    started_at: AwareDatetime
    completed_at: AwareDatetime
    assertions: tuple[AssertionOutcome, ...] = Field(min_length=5, max_length=5)


class Pending(Record):
    status: Literal["pending"] = "pending"


class Verifying(Record):
    status: Literal["verifying"] = "verifying"
    operation_id: Sha
    binding: VerificationBinding


class Recorded(Record):
    status: Literal["recorded"] = "recorded"
    result: ApplicationResult
    received_at: AwareDatetime


class Unavailable(Record):
    status: Literal["unavailable"] = "unavailable"
    reason: Literal["transport_unknown", "invalid_result", "cancelled"]


class ApplicationState(
    RootModel[
        Annotated[
            Pending | Verifying | Recorded | Unavailable, Field(discriminator="status")
        ]
    ]
):
    model_config = ConfigDict(frozen=True)


class PromotionEvidenceBody(Record):
    schema_version: Literal["birbforge.promotion-evidence.v1"] = (
        "birbforge.promotion-evidence.v1"
    )
    binding: VerificationBinding
    result_sha256: Sha
    closure_sha256: Sha
    issued_at: AwareDatetime
    expires_at: AwareDatetime


class PromotionEvidence(PromotionEvidenceBody):
    evidence_id: Sha


def operation_id(binding: VerificationBinding, profile: VerificationProfile) -> str:
    return digest(
        {
            "binding": binding.model_dump(mode="json"),
            "profile": profile.model_dump(mode="json"),
        }
    )


def accept_application_result(
    raw: dict,
    binding: VerificationBinding,
    profile: VerificationProfile,
    received_at: datetime,
) -> Recorded:
    """Validate bindings and outcomes; caller authentication is external."""
    if len(json.dumps(raw, separators=(",", ":")).encode()) > MAX_RESULT_BYTES:
        raise ValueError("result_too_large")
    result = ApplicationResult.model_validate(raw)
    if result.binding != binding or result.operation_id != operation_id(
        binding, profile
    ):
        raise ValueError("result_binding_mismatch")
    if any(
        getattr(result, key) != getattr(profile, key)
        for key in (
            "verifier_identity",
            "verifier_revision",
            "reviewer_identity",
            "suite_sha256",
        )
    ):
        raise ValueError("result_profile_mismatch")
    if result.running_image != binding.image:
        raise ValueError("running_image_mismatch")
    assertions = [item.assertion for item in result.assertions]
    if sorted(assertions) != sorted(REQUIRED_ASSERTIONS):
        raise ValueError("assertion_suite_mismatch")
    if not (
        binding.dispatched_at
        <= result.started_at
        <= result.completed_at
        <= received_at
        < binding.deadline
    ):
        raise ValueError("result_time_invalid")
    if received_at >= result.completed_at + timedelta(seconds=profile.max_age_seconds):
        raise ValueError("result_stale")
    return Recorded(result=result, received_at=received_at)


def promotion_evidence(
    application: ApplicationState,
    binding: VerificationBinding,
    profile: VerificationProfile,
    closure: dict | None,
    *,
    cancellation: str,
    closed_at: datetime,
    now: datetime,
) -> PromotionEvidence | None:
    """Evaluate producer closure observation; not wired to production export."""
    if (
        cancellation != "none"
        or not isinstance(application.root, Recorded)
        or closure is None
    ):
        return None
    recorded = application.root
    try:
        result = accept_application_result(
            recorded.result.model_dump(mode="json"),
            binding,
            profile,
            recorded.received_at,
        ).result
        request = KubernetesRequest(
            request_id=binding.request_id,
            candidate_revision=binding.candidate_revision,
            producer_revision=binding.producer_revision,
            policy_revision=binding.policy_revision,
            plan_sha256=binding.plan_sha256,
            target=binding.target,
            image=binding.image,
            deadline=binding.deadline,
        )
        validated = validate_closure(
            request.model_dump(mode="json"), closure, binding.installation_sha256
        )
        if validated is None:
            return None
        receipt = KubernetesReceipt.model_validate(validated)
        if "create-pod" not in closure["operations"]:
            return None
    except (ValueError, TypeError, KeyError, AttributeError):
        return None
    if any(item.outcome != "passed" for item in result.assertions):
        return None
    expected = {
        "request_id": binding.request_id,
        "request_sha256": binding.request_sha256,
        "candidate_revision": binding.candidate_revision,
        "producer_revision": binding.producer_revision,
        "policy_revision": binding.policy_revision,
        "plan_sha256": binding.plan_sha256,
        "installation_sha256": binding.installation_sha256,
        "target": binding.target.model_dump(mode="json"),
        "image": binding.image,
        "pod_uid": binding.pod_uid,
        "reason": "completed",
        "state": "released",
    }
    document = receipt.model_dump(mode="json")
    if any(document[key] != value for key, value in expected.items()):
        return None
    expires_at = result.completed_at + timedelta(seconds=profile.max_age_seconds)
    if not (recorded.received_at <= closed_at <= now < expires_at):
        return None
    body = {
        "binding": binding.model_dump(mode="json"),
        "result_sha256": digest(result),
        "closure_sha256": digest(receipt),
        "issued_at": closed_at.isoformat(),
        "expires_at": expires_at.isoformat(),
    }
    normalized = PromotionEvidenceBody.model_validate(body).model_dump(mode="json")
    return PromotionEvidence(evidence_id=digest(normalized), **normalized)
