"""Synthetic consumer contract fixtures, not account/auth integration evidence."""

import copy
from datetime import UTC, datetime, timedelta

import pytest
from birbverify.contract import digest
from birbverify.kubernetes_contract import KubernetesRequest
from kubernetes_helpers import config
from pydantic import ValidationError

from verification.kubernetes_results import (
    REQUIRED_ASSERTIONS,
    ApplicationState,
    VerificationBinding,
    VerificationProfile,
    accept_application_result,
    operation_id,
    promotion_evidence,
)


@pytest.fixture
def evidence():
    now = datetime(2026, 11, 10, tzinfo=UTC)
    authority = config().authority
    request = KubernetesRequest(
        request_id="fixture",
        candidate_revision=authority.candidate_revision,
        producer_revision=authority.producer_revision,
        policy_revision=authority.policy_revision,
        plan_sha256=authority.plan_sha256,
        target=authority.target,
        image=authority.image,
        deadline=now + timedelta(seconds=300),
    )
    binding = VerificationBinding(
        **request.model_dump(exclude={"schema_version"}),
        request_sha256=digest(request),
        workflow_id=authority.workflow_id,
        authored_revision=authority.authored_revision,
        beans_issue=authority.beans_issue,
        installation_sha256=authority.installation_sha256,
        pod_uid="fixture-pod",
        dispatched_at=now,
    )
    profile = VerificationProfile(
        verifier_identity="fixture-verifier",
        verifier_revision="d" * 40,
        reviewer_identity="fixture-reviewer",
        suite_sha256="1" * 64,
        max_age_seconds=60,
    )
    raw = {
        "schema_version": "birbverify.account-auth.result.v1",
        "operation_id": operation_id(binding, profile),
        "binding": binding.model_dump(mode="json"),
        **profile.model_dump(exclude={"max_age_seconds"}),
        "running_image": binding.image,
        "started_at": (now + timedelta(seconds=1)).isoformat(),
        "completed_at": (now + timedelta(seconds=2)).isoformat(),
        "assertions": [
            {"assertion": name, "outcome": "passed"} for name in REQUIRED_ASSERTIONS
        ],
    }
    operations = {
        name: {
            "state": "settled",
            "body_sha256": "2" * 64,
            "response": {"metadata": {"uid": "fixture-pod"}},
        }
        for name in ("create-pod", "remove-finalizer", "restore-revision")
    }
    proof = {
        "phase": "Succeeded",
        "containerStatuses": [{"state": {"terminated": {"exitCode": 0}}}],
    }
    receipt = {
        **request.model_dump(mode="json", exclude={"deadline", "schema_version"}),
        "schema_version": "birbverify.kubernetes.closure.v1",
        "request_sha256": digest(request),
        "installation_sha256": authority.installation_sha256,
        "pod_uid": binding.pod_uid,
        "reason": "completed",
        "state": "released",
        "terminal_proof": proof,
        "operations_sha256": digest(operations),
        "effects": {
            name: {
                "body_sha256": "2" * 64,
                "object_uid": "fixture-pod",
                "expected_resource_version": None,
                "resource_version": None,
            }
            for name in operations
        },
    }
    receipt["receipt_sha256"] = digest(receipt)
    observed = {
        "request_id": "fixture",
        "request_sha256": digest(request),
        "pod_uid": binding.pod_uid,
        "state": "released",
        "reason": "completed",
        "operations": operations,
        "terminal_proof": proof,
        "receipt": receipt,
    }
    return binding, profile, raw, observed, now + timedelta(seconds=3)


def evaluate(evidence, *, raw=None, cancellation="none", now=None, closure=True):
    binding, profile, original, observed, received = evidence
    state = ApplicationState(
        accept_application_result(raw or original, binding, profile, received)
    )
    return promotion_evidence(
        state,
        binding,
        profile,
        observed if closure else None,
        cancellation=cancellation,
        closed_at=received + timedelta(seconds=1),
        now=now or received + timedelta(seconds=2),
    )


def test_fixture_pass_needs_closure_and_has_stable_expiry(evidence):
    receipt = evaluate(evidence)
    assert receipt is not None
    assert not evaluate(evidence, closure=False)
    assert evaluate(evidence, now=evidence[-1] + timedelta(seconds=20)) == receipt
    assert evaluate(evidence, now=receipt.expires_at) is None
    assert evaluate(evidence, cancellation="requested") is None


@pytest.mark.parametrize("field", list(VerificationBinding.model_fields))
def test_each_rehashed_subject_mutation_rejected(evidence, field):
    binding, profile, raw, _, received = evidence
    raw = copy.deepcopy(raw)
    value = raw["binding"][field]
    if isinstance(value, dict):
        value = {**value, "namespace_uid": "wrong"}
    elif field in {"dispatched_at", "deadline"}:
        value = (received + timedelta(seconds=30)).isoformat()
    elif field == "image":
        value = "wrong/app@sha256:" + "0" * 64
    else:
        value = "0" * len(value) if len(value) in {40, 64} else "wrong"
    raw["binding"][field] = value
    raw["operation_id"] = operation_id(
        VerificationBinding.model_validate(raw["binding"]), profile
    )
    with pytest.raises(ValueError, match="binding_mismatch"):
        accept_application_result(raw, binding, profile, received)


@pytest.mark.parametrize(
    "field",
    [
        "verifier_identity",
        "verifier_revision",
        "reviewer_identity",
        "suite_sha256",
        "running_image",
        "operation_id",
    ],
)
def test_profile_and_image_mismatch(evidence, field):
    binding, profile, raw, _, received = evidence
    raw = copy.deepcopy(raw)
    raw[field] = (
        "0" * len(raw[field])
        if field.endswith(("revision", "sha256")) or field == "operation_id"
        else "wrong"
    )
    with pytest.raises(ValueError):
        accept_application_result(raw, binding, profile, received)


@pytest.mark.parametrize("outcome", ["failed", "unknown"])
def test_negative_assertion_cannot_pass(evidence, outcome):
    raw = copy.deepcopy(evidence[2])
    raw["assertions"][0]["outcome"] = outcome
    assert evaluate(evidence, raw=raw) is None


@pytest.mark.parametrize(
    "mutation", ["missing", "duplicate", "unexpected", "skipped", "secret", "oversized"]
)
def test_malformed_or_sensitive_assertions_rejected(evidence, mutation):
    binding, profile, raw, _, received = evidence
    raw = copy.deepcopy(raw)
    if mutation == "missing":
        raw["assertions"].pop()
    elif mutation == "duplicate":
        raw["assertions"][0] = raw["assertions"][1]
    elif mutation == "unexpected":
        raw["assertions"][0]["assertion"] = "healthcheck"
    elif mutation == "skipped":
        raw["assertions"][0]["outcome"] = "skipped"
    else:
        raw["token"] = "secret" if mutation == "secret" else "x" * 9000
    with pytest.raises(ValueError):
        accept_application_result(raw, binding, profile, received)


@pytest.mark.parametrize(
    "field,offset", [("started_at", -4), ("completed_at", 1), ("started_at", 0)]
)
def test_future_predispatch_and_reversed_times_rejected(evidence, field, offset):
    binding, profile, raw, _, received = evidence
    raw = copy.deepcopy(raw)
    raw[field] = (received + timedelta(seconds=offset)).isoformat()
    with pytest.raises(ValueError, match="time_invalid"):
        accept_application_result(raw, binding, profile, received)


def test_stale_and_deadline_receipt_rejected(evidence):
    binding, profile, raw, _, received = evidence
    for when in (received + timedelta(seconds=60), binding.deadline):
        with pytest.raises(ValueError):
            accept_application_result(raw, binding, profile, when)


@pytest.mark.parametrize(
    "mutation", ["pod", "reason", "unsettled", "terminal", "checksum"]
)
def test_closure_failures_block_rehashed_receipts(evidence, mutation):
    evidence = copy.deepcopy(evidence)
    observed = evidence[3]
    if mutation == "pod":
        observed["pod_uid"] = observed["receipt"]["pod_uid"] = "other"
    elif mutation == "reason":
        observed["reason"] = observed["receipt"]["reason"] = "cancelled"
    elif mutation == "unsettled":
        observed["operations"]["create-pod"]["state"] = "unknown"
    elif mutation == "terminal":
        observed["terminal_proof"] = observed["receipt"]["terminal_proof"] = None
    else:
        observed["receipt"]["operations_sha256"] = "0" * 64
    observed["receipt"]["receipt_sha256"] = digest(
        {k: v for k, v in observed["receipt"].items() if k != "receipt_sha256"}
    )
    assert evaluate(evidence) is None


def test_application_state_roundtrip_and_unavailable_denial(evidence):
    binding, profile, raw, observed, received = evidence
    recorded = ApplicationState(
        accept_application_result(raw, binding, profile, received)
    )
    for state in (
        recorded,
        ApplicationState.model_validate({"status": "pending"}),
        ApplicationState.model_validate(
            {
                "status": "verifying",
                "binding": binding,
                "operation_id": operation_id(binding, profile),
            }
        ),
        ApplicationState.model_validate(
            {"status": "unavailable", "reason": "transport_unknown"}
        ),
    ):
        restored = ApplicationState.model_validate_json(state.model_dump_json())
        assert restored == state
        receipt = promotion_evidence(
            restored,
            binding,
            profile,
            observed,
            cancellation="none",
            closed_at=received,
            now=received,
        )
        assert (receipt is not None) == (state == recorded)
    with pytest.raises(ValidationError):
        profile.max_age_seconds = 100


@pytest.mark.parametrize("cancellation", ["requested", "acknowledged", "too_late"])
def test_every_cancellation_blocks_fixture_eligibility(evidence, cancellation):
    assert evaluate(evidence, cancellation=cancellation) is None


@pytest.mark.parametrize("reason", ["worker_lost", "cancelled"])
def test_noncompleted_closure_blocks_fixture_eligibility(evidence, reason):
    evidence = copy.deepcopy(evidence)
    observed = evidence[3]
    observed["reason"] = observed["receipt"]["reason"] = reason
    observed["receipt"]["receipt_sha256"] = digest(
        {
            key: value
            for key, value in observed["receipt"].items()
            if key != "receipt_sha256"
        }
    )
    assert evaluate(evidence) is None


def test_unknown_closure_cannot_create_evidence(evidence):
    evidence = copy.deepcopy(evidence)
    evidence[3].update(state="closing", receipt=None)
    assert evaluate(evidence) is None


def test_production_projection_rejects_injected_fixture_result(evidence, monkeypatch):
    from kubernetes_helpers import admission
    from temporalio import workflow

    from verification.kubernetes import projection
    from verification.kubernetes_workflow import KubernetesQueue

    monkeypatch.setattr(workflow, "now", lambda: evidence[-1])
    queue = KubernetesQueue({"config": config().model_dump(mode="json")})
    queue.admit(admission())
    row = queue.state["rows"]["r1"]
    row.update(
        phase="closed",
        closure=evidence[3]["receipt"],
        application=evidence[2],
        promotion_evidence=evaluate(evidence).model_dump(mode="json"),
    )
    assert projection(queue.snapshot(), "owner", "chat")["requests"][0][
        "eligibility"
    ] == {"eligible": False, "reason": "delivery_not_authorized"}


def test_exported_provisional_schemas_match_models():
    import json
    from pathlib import Path

    from verification.kubernetes_results import PromotionEvidence

    folder = (
        Path(__file__).resolve().parents[2]
        / "server/contracts/birbforge.account-auth.provisional.v1"
    )
    for name, model in (
        ("profile", VerificationProfile),
        ("application", ApplicationState),
        ("evidence", PromotionEvidence),
    ):
        schema = json.loads((folder / (name + ".schema.json")).read_text())
        assert (
            schema.pop("$comment")
            == "Provisional consumer-only bare-Pod contract. Not production authorization or producer integration evidence."
        )
        assert schema == model.model_json_schema()


def test_exported_evidence_identity_is_recomputable(evidence):
    from verification.kubernetes_results import PromotionEvidence

    receipt = evaluate(evidence)
    restored = PromotionEvidence.model_validate_json(receipt.model_dump_json())
    assert restored.evidence_id == digest(
        restored.model_dump(mode="json", exclude={"evidence_id"})
    )


def test_preexecution_release_cannot_qualify_as_verified_workload(evidence):
    evidence = copy.deepcopy(evidence)
    observed = evidence[3]
    del observed["operations"]["create-pod"]
    del observed["receipt"]["effects"]["create-pod"]
    observed["receipt"]["operations_sha256"] = digest(observed["operations"])
    observed["receipt"]["receipt_sha256"] = digest(
        {
            key: value
            for key, value in observed["receipt"].items()
            if key != "receipt_sha256"
        }
    )
    assert evaluate(evidence) is None
