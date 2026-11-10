from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

pytest.importorskip("birbverify.kubernetes_contract")

from kubernetes_helpers import admission, cancellation, completion, config

from verification.kubernetes import (
    KubernetesCommand,
    projection,
)
from verification.kubernetes_workflow import KubernetesQueue


@pytest.fixture
def queue(monkeypatch):
    monkeypatch.setattr(
        "verification.kubernetes_workflow.workflow.now",
        lambda: datetime(2026, 1, 1, tzinfo=UTC),
    )
    return KubernetesQueue({"config": config().model_dump(mode="json")})


def test_admission_idempotency_and_installed_authority(queue):
    first = queue.admit(admission())
    assert first["ok"]
    queue.admit(admission("r2"))
    assert queue.admit(admission()) == first
    assert queue.state["order"] == ["r1", "r2"]
    assert (
        queue.admit(admission("r3", idempotency_key="r1"))["code"]
        == "idempotency_conflict"
    )
    payload = queue.state["rows"]["r1"]["payload"]
    assert payload["target"]["namespace_uid"] == "namespace"
    assert payload["policy_revision"] == "c" * 40
    assert payload["producer_revision"] == "b" * 40


@pytest.mark.parametrize(
    "field,value",
    [
        ("candidate_revision", "f" * 40),
        ("authored_revision", "f" * 40),
        ("beans_issue", "unapproved"),
        ("approved_plan_sha256", "f" * 64),
    ],
)
def test_admission_rejects_unapproved_work(queue, field, value):
    assert not queue.admit(admission(**{field: value}))["ok"]
    assert queue.snapshot()["order"] == []


@pytest.mark.parametrize(
    "field", ["principal", "target", "policy_revision", "activity_name"]
)
def test_client_cannot_select_authority(field):
    command = admission()["command"]
    command[field] = "attacker"
    with pytest.raises(ValidationError):
        KubernetesCommand.model_validate(command)


def test_queued_cancellation_is_durable_and_scoped(queue):
    queue.admit(admission())
    assert queue.cancel(cancellation("r1", 0))["code"] == "stale_revision"
    message = cancellation("r1", 1)
    first = queue.cancel(message)
    assert first["ok"]
    assert queue.cancel(message) == first
    assert queue.cancel(cancellation("r1", 2))["code"] == "command_id_conflict"
    row = queue.snapshot()["rows"]["r1"]
    assert row["phase"] == "cancelled_before_dispatch"
    assert row["cancellation"] == "acknowledged"
    assert row["activity_outcome"] is None
    assert queue.snapshot()["outstanding_request_id"] is None


def test_projection_preserves_authored_identity_and_denies_delivery(queue):
    queue.admit(admission())
    visible = projection(queue.snapshot(), "owner", "chat")["requests"][0]
    assert visible["authored_revision"] == "a" * 40
    assert visible["beans_issue"] == "birbforge-yrnb"
    assert visible["eligibility"]["eligible"] is False
    assert projection(queue.snapshot(), "owner", "other")["requests"] == []


def test_bad_release_evidence_cannot_free_owner(queue):
    queue.admit(admission())
    row = queue.state["rows"]["r1"]
    queue.state["outstanding_request_id"] = "r1"
    row["phase"] = "closing"
    queue.reconcile(row, {"state": "released", "request_id": "r1", "receipt": {}})
    assert queue.snapshot()["outstanding_request_id"] == "r1"
    assert row["phase"] == "closing"
    assert row["observation_error"] == "invalid_producer_evidence"


def test_canonical_workflow_identity_ignores_logical_alias():
    installed = config().authority
    renamed = installed.model_copy(
        update={"target": installed.target.model_copy(update={"target_id": "alias"})}
    )
    assert installed.workflow_id == renamed.workflow_id


@pytest.mark.parametrize(
    "field,value",
    [
        ("policy_revision", "f" * 40),
        ("producer_revision", "f" * 40),
        (
            "target",
            {
                "target_id": "target",
                "cluster_uid": "cluster",
                "namespace": "other",
                "namespace_uid": "namespace",
            },
        ),
    ],
)
def test_existing_workflow_configuration_cannot_silently_change(field, value):
    from verification.kubernetes import KubernetesConfig, check_installation

    local = KubernetesConfig(
        queue=config(),
        temporal_address="localhost:7233",
        workflow_task_queue="consumer",
    )
    installed = {
        "config": local.queue.model_dump(mode="json"),
        "workflow_task_queue": "consumer",
    }
    check_installation(local, installed)
    installed["config"]["authority"][field] = value
    with pytest.raises(ValueError, match="running_installation_mismatch"):
        check_installation(local, installed)


def test_completion_requires_running_and_survives_state_restore(queue):
    queue.admit(admission())
    assert queue.complete(completion("r1", 1))["code"] == "request_not_running"
    row = queue.state["rows"]["r1"]
    row.update(phase="running", activity_outcome="completed")
    queue.state["outstanding_request_id"] = "r1"
    assert queue.complete(completion("r1", 0))["code"] == "stale_revision"
    message = completion("r1", 1)
    receipt = queue.complete(message)
    restored = KubernetesQueue(
        {"config": config().model_dump(mode="json"), "state": queue.snapshot()}
    )
    assert restored.complete(message) == receipt
    assert restored.complete(completion("r1", 2))["code"] == "command_id_conflict"
    assert restored.snapshot()["rows"]["r1"]["closure_trigger"] == "complete"
    assert (
        projection(restored.snapshot(), "owner", "chat")["requests"][0][
            "requested_closure_reason"
        ]
        == "completed"
    )
    assert restored.snapshot()["outstanding_request_id"] == "r1"
    assert not projection(restored.snapshot(), "owner", "chat")["requests"][0][
        "eligibility"
    ]["eligible"]


def test_installation_capacity_is_permanent(queue):
    queue.config = queue.config.model_copy(update={"max_requests": 1})
    queue.admit(admission())
    queue.cancel(cancellation("r1", 1))
    assert queue.admit(admission("r2")) == {
        "ok": False,
        "code": "installation_capacity",
        "status": 409,
    }


@pytest.mark.asyncio
async def test_full_installation_state_fits_temporal_payload_with_headroom(queue):
    import copy
    import json
    from pathlib import Path

    from birbverify.contract import digest
    from birbverify.kubernetes_contract import KubernetesReceipt
    from temporalio.converter import DataConverter

    largest = json.loads(
        (Path(__file__).parent / "fixtures/kubernetes-receipt.json").read_text()
    )
    KubernetesReceipt.model_validate(largest)
    for number in range(128):
        identity = "r" + str(number)
        queue.admit(admission(identity))
        row = queue.state["rows"][identity]
        row.update(phase="running", activity_outcome="completed")
        assert queue.complete(
            completion(identity, row["revision"], "complete-" + identity)
        )["ok"]
        row.update(phase="closed", closure=copy.deepcopy(largest))
        assert queue.cancel(
            cancellation(identity, row["revision"], "cancel-" + identity)
        )["ok"]
    payloads = await DataConverter.default.encode(
        [{"config": queue.config.model_dump(mode="json"), "state": queue.snapshot()}]
    )
    serialized_bytes = payloads[0].ByteSize()
    print(
        f"full_installation_payload_bytes={serialized_bytes}; rows=128; receipt_sample_bytes={len(json.dumps(largest))}"
    )
    assert serialized_bytes < 1024 * 1024
    from verification.kubernetes import MAX_CLOSURE_BYTES

    padded = copy.deepcopy(largest)
    padded["terminal_proof"]["message"] = ""
    baseline = len(json.dumps(padded, sort_keys=True, separators=(",", ":")).encode())
    padded["terminal_proof"]["message"] = "x" * (MAX_CLOSURE_BYTES - baseline)
    assert (
        len(json.dumps(padded, sort_keys=True, separators=(",", ":")).encode())
        == MAX_CLOSURE_BYTES
    )
    padded["receipt_sha256"] = digest(
        {key: value for key, value in padded.items() if key != "receipt_sha256"}
    )
    for row in queue.state["rows"].values():
        row["closure"] = copy.deepcopy(padded)
    payloads = await DataConverter.default.encode(
        [{"config": queue.config.model_dump(mode="json"), "state": queue.snapshot()}]
    )
    bounded_bytes = payloads[0].ByteSize()
    print(
        f"full_installation_bounded_payload_bytes={bounded_bytes}; receipt_limit={MAX_CLOSURE_BYTES}"
    )
    assert bounded_bytes < 1_600_000


@pytest.mark.parametrize(
    "field,value",
    [("phase", "invented"), ("closure_trigger", "invented"), ("close_attempts", None)],
)
def test_restored_queue_rejects_invalid_durable_state(queue, field, value):
    import copy

    queue.admit(admission())
    state = copy.deepcopy(queue.snapshot())
    if value is None:
        del state["rows"]["r1"][field]
    else:
        state["rows"]["r1"][field] = value
    with pytest.raises(ValidationError):
        KubernetesQueue({"config": config().model_dump(mode="json"), "state": state})


@pytest.mark.parametrize("state", [[], {}, None, "unexpected"])
def test_invalid_observation_state_retains_owner_without_crashing(queue, state):
    queue.admit(admission())
    row = queue.state["rows"]["r1"]
    row["phase"] = "closing"
    queue.state["outstanding_request_id"] = "r1"
    queue.reconcile(
        row,
        {
            "request_id": "r1",
            "request_sha256": row["request_sha256"],
            "state": state,
        },
    )
    assert row["observation_error"] == "invalid_producer_evidence"
    assert queue.state["outstanding_request_id"] == "r1"
