import copy
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from test_queue import fixture_installation, intent

from verification.model import Config
from verification.workflow import EnvironmentQueue


@pytest.fixture
def closure_queue(monkeypatch):
    binding = {
        "protocol": "birbverify.target.v2",
        "target_id": "fixture-local",
        "target_incarnation": str(uuid4()),
    }
    config = {
        "profile": "closure-v2",
        "closure_binding": binding,
        "owner_principal": "owner",
        "max_requests": 10,
    }
    monkeypatch.setattr(
        "verification.workflow.workflow.now", lambda: datetime(2026, 1, 1, tzinfo=UTC)
    )
    queue = EnvironmentQueue({"config": config})
    monkeypatch.setattr(queue, "diagnostic", lambda *args: None)
    installed = {**fixture_installation(), "closure_binding": binding}
    original = intent(installed)
    assert queue.admit({"intent": original, "installation": installed})["ok"]
    return queue


@pytest.mark.parametrize("outcome", ["cancelled", "rejected", "unknown", "completed"])
def test_dispatched_unknown_keeps_ownership_in_serialized_state_copy(
    closure_queue, outcome
):
    queue = closure_queue
    row = queue.state["requests"][0]
    identity = row["payload"]["request_id"]
    row.update(phase="uncertain", activity_outcome=outcome, cancellation="requested")
    queue.state["outstanding_request_id"] = identity
    observed = {
        "requests": {
            identity: {"attempt_id": None, "manifest": None, "release_confirmed": False}
        },
        "recovered_attempts": [],
        "environment": {"state": "free"},
    }
    queue.reconcile(observed)
    assert row["phase"] == "uncertain" and row["cancellation"] == "requested"
    resumed = EnvironmentQueue(
        {"config": queue.config, "state": copy.deepcopy(queue.state)}
    )
    assert resumed.state["outstanding_request_id"] == identity
    queue.reconcile(
        {
            **observed,
            "requests": {
                identity: {
                    **observed["requests"][identity],
                    "release_confirmed": True,
                    "closure": {"kind": "released"},
                }
            },
        }
    )
    assert queue.state["outstanding_request_id"] is None
    assert row["phase"] == "closed" and row["manifest"] is None


def test_terminal_history_does_not_retire_outstanding_or_touch_successor(closure_queue):
    queue = closure_queue
    row = queue.state["requests"][0]
    identity = row["payload"]["request_id"]
    queue.state["outstanding_request_id"] = identity
    manifest = {"outcome": "inconclusive", "environment_release": "quarantined"}
    observation = {
        "requests": {
            identity: {
                "attempt_id": "attempt",
                "manifest": manifest,
                "release_confirmed": False,
            }
        },
        "recovered_attempts": [],
        "environment": {"state": "quarantined"},
    }
    queue.reconcile(observation)
    assert (
        row["phase"] == "terminal" and queue.state["outstanding_request_id"] == identity
    )
    observation["requests"][identity]["release_confirmed"] = True
    queue.reconcile(observation)
    assert queue.state["outstanding_request_id"] is None and row["manifest"] == manifest
    installed = {
        **fixture_installation(),
        "closure_binding": queue.config["closure_binding"],
    }
    assert queue.admit({"intent": intent(installed), "installation": installed})["ok"]
    successor = queue.state["requests"][1]
    successor["phase"] = "dispatching"
    queue.state["outstanding_request_id"] = successor["payload"]["request_id"]
    before = copy.deepcopy(successor)
    queue.reconcile(observation)
    assert queue.state["outstanding_request_id"] == successor["payload"]["request_id"]
    assert successor == before


def test_admission_incarnation_drift_and_old_history_are_rejected(closure_queue):
    queue = closure_queue
    installed = {
        **fixture_installation(),
        "closure_binding": {
            **queue.config["closure_binding"],
            "target_incarnation": str(uuid4()),
        },
    }
    assert (
        queue.admit({"intent": intent(installed), "installation": installed})["code"]
        == "admission_target_changed"
    )
    with pytest.raises(ValueError, match="legacy_history_migration"):
        EnvironmentQueue(
            {
                "config": queue.config,
                "state": {"revision": 0, "requests": [], "commands": {}},
            }
        )


def test_profile_requires_fresh_explicit_binding():
    base = {
        "installation_root": "/tmp/fixture",
        "temporal_address": "localhost:1234",
        "workflow_id": "old",
        "workflow_task_queue": "q",
        "activity_task_queue": "a",
    }
    with pytest.raises(ValueError, match="profile_binding"):
        Config.model_validate({**base, "profile": "closure-v2"})
    with pytest.raises(ValueError, match="fresh_closure"):
        Config.model_validate(
            {
                **base,
                "profile": "closure-v2",
                "closure_binding": {
                    "protocol": "birbverify.target.v2",
                    "target_id": "fixture-local",
                    "target_incarnation": str(uuid4()),
                },
            }
        )


@pytest.fixture
def closure_observation(tmp_path, monkeypatch):
    import json

    from birbverify.closure import BeginClosure, ClosureReceipt
    from birbverify.contract import digest
    from birbverify.fixture import ROOT
    from birbverify.lifecycle import ADAPTER

    from verification import closure

    command = json.loads((ROOT / "contracts/closure/v1/begin.example.json").read_text())
    receipt = json.loads(
        (ROOT / "contracts/closure/v1/receipt.example.json").read_text()
    )
    request_id = str(uuid4())
    command["request"]["request_id"] = request_id
    command["request_sha256"] = digest(command["request"])
    command = BeginClosure.model_validate(command).model_dump(mode="json")
    receipt.update(
        request_id=request_id,
        request_sha256=command["request_sha256"],
        command_sha256=digest(command),
        producer_revision=closure.PRODUCER_REVISION,
        adapter_revision=ADAPTER,
    )
    receipt["receipt_sha256"] = digest(
        {key: value for key, value in receipt.items() if key != "receipt_sha256"}
    )
    receipt = ClosureReceipt.model_validate(receipt).model_dump(mode="json")
    binding = {
        "protocol": "birbverify.target.v2",
        "target_id": receipt["target_id"],
        "target_incarnation": receipt["target_incarnation"],
    }
    (tmp_path / "installation.json").write_text(
        json.dumps(
            {"closure_binding": binding, "producer_revision": closure.PRODUCER_REVISION}
        )
    )
    (tmp_path / "closure-commands").mkdir()
    (tmp_path / "closure-commands" / (request_id + ".json")).write_text(
        json.dumps(command)
    )
    row = {
        "payload": command["request"],
        "request_sha256": command["request_sha256"],
        "admission_binding": binding,
        "attempt_id": None,
        "manifest": None,
    }
    progress = {
        "closure_id": receipt["closure_id"],
        "execution_epoch": receipt["execution_epoch"],
        "acquisition": receipt["acquisition"],
        "phase": "release_confirmed",
        "blocking_reason": None,
        "fence": receipt["fence"],
        "stop": receipt["stop"],
        "cleanup": receipt["cleanup"],
        "receipt": receipt,
    }
    snapshot = {
        "contract_version": "birbverify.closure.v1",
        "target_id": binding["target_id"],
        "target_incarnation": binding["target_incarnation"],
        "record_revision": receipt["release"]["environment_revision"],
        "requests": [
            {
                "request_id": request_id,
                "request_sha256": row["request_sha256"],
                "execution_epoch": receipt["execution_epoch"],
                "manifest": None,
                "closure": progress,
                "terminal": "closed_without_verification",
            }
        ],
        "environment": {
            "state": "free",
            "owner": {"kind": "none"},
            "candidate": None,
            "value": 0,
        },
    }
    capabilities = {
        **binding,
        "extensions": ["birbverify.closure.v1"],
        "adapter_revision": ADAPTER,
    }
    control = {"reads": 0, "unstable": False}

    def rpc(root, method, **data):
        if method == "capabilities":
            return capabilities
        if method == "validate_closure_receipt":
            return {"valid": True, "receipt_sha256": receipt["receipt_sha256"]}
        assert method == "observe_closure_state"
        control["reads"] += 1
        result = copy.deepcopy(snapshot)
        if control["unstable"] and control["reads"] > 1:
            result["record_revision"] += 1
        return result

    monkeypatch.setattr(closure, "rpc", rpc)
    return closure, row, snapshot, receipt, capabilities, control, tmp_path, binding


@pytest.mark.parametrize(
    "mutation", ["request", "payload", "epoch", "history", "command", "future_release"]
)
def test_release_requires_exact_attributable_receipt(closure_observation, mutation):
    from birbverify.contract import digest

    closure, row, snapshot, receipt, _, _, root, binding = closure_observation
    if mutation == "request":
        receipt["request_id"] = str(uuid4())
    elif mutation == "payload":
        receipt["request_sha256"] = "f" * 64
    elif mutation == "epoch":
        snapshot["requests"][0]["execution_epoch"] += 1
    elif mutation == "history":
        receipt["history"] = {"manifest_status": "present", "manifest_sha256": "f" * 64}
    elif mutation == "command":
        receipt["command_sha256"] = "f" * 64
    else:
        receipt["release"]["environment_revision"] += 1
    receipt["receipt_sha256"] = digest(
        {key: value for key, value in receipt.items() if key != "receipt_sha256"}
    )
    result = closure.observe(root, [row], binding)
    fact = result["requests"][row["payload"]["request_id"]]
    assert not fact["release_confirmed"] and fact["closure"]["proof"] == "invalid"
    assert fact["manifest"] is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("extensions", []),
        ("adapter_revision", "f" * 64),
        ("target_incarnation", "cbe2b7db-9b36-432b-a369-3c65f275c454"),
    ],
)
def test_capability_mismatch_has_no_legacy_fallback(closure_observation, field, value):
    closure, row, _, _, capabilities, _, root, binding = closure_observation
    capabilities[field] = value
    with pytest.raises(ValueError, match="closure_capability_mismatch"):
        closure.observe(root, [row], binding)


def test_target_change_during_validation_cannot_retire_ownership(closure_observation):
    closure, row, _, _, _, control, root, binding = closure_observation
    identity = row["payload"]["request_id"]
    first = closure.observe(root, [row], binding)
    assert first["requests"][identity]["release_confirmed"]
    control.update(reads=0, unstable=True)
    changed = closure.observe(root, [row], binding)
    assert not changed["requests"][identity]["release_confirmed"]
    assert changed["requests"][identity]["closure"]["proof"] == "unavailable"
    assert changed["environment"]["state"] == "unavailable"


@pytest.mark.parametrize(
    "field,value",
    [
        ("idempotency_key", "different-key"),
        ("target_id", "different-target"),
        ("target_incarnation", "cbe2b7db-9b36-432b-a369-3c65f275c454"),
        ("policy_revision", "f" * 40),
        ("producer_revision", "f" * 40),
        ("adapter_revision", "f" * 64),
    ],
)
def test_receipt_binding_checks_each_attested_identity(
    closure_observation, field, value
):
    from birbverify.closure import Snapshot

    closure, row, snapshot, _, _, _, _, binding = closure_observation
    fact = Snapshot.model_validate(snapshot).requests[0]
    receipt = fact.closure.receipt.model_copy(update={field: value})
    assert not closure.receipt_matches(row, fact, receipt, binding)


def test_receipt_binding_requires_known_attempt_and_acquisition(closure_observation):
    from birbverify.closure import Acquired, Snapshot

    closure, row, snapshot, _, _, _, _, binding = closure_observation
    fact = Snapshot.model_validate(snapshot).requests[0]
    receipt = fact.closure.receipt
    altered = receipt.model_copy(
        update={
            "acquisition": Acquired(attempt_id="other", reservation_sha256="f" * 64)
        }
    )
    assert not closure.receipt_matches(row, fact, altered, binding)
    row["attempt_id"] = "known-attempt"
    assert not closure.receipt_matches(row, fact, receipt, binding)


def test_present_manifest_digest_allows_exact_closure_release(closure_observation):
    import json

    from birbverify.contract import Manifest, digest
    from birbverify.fixture import ROOT

    closure, row, snapshot, receipt, _, _, root, binding = closure_observation
    value = json.loads((ROOT / "contracts/v1/manifest.example.json").read_text())
    value.update(
        request_id=row["payload"]["request_id"],
        request_sha256=row["request_sha256"],
        outcome="inconclusive",
        termination="unknown",
        cleanup="unknown",
        environment_release="quarantined",
        reason="termination_unknown",
    )
    manifest = Manifest.model_validate(value)
    row["manifest"] = manifest.model_dump(mode="json")
    row["attempt_id"] = manifest.attempt_id
    receipt["acquisition"] = {
        "kind": "acquired",
        "attempt_id": manifest.attempt_id,
        "reservation_sha256": "a" * 64,
    }
    snapshot["requests"][0]["closure"]["acquisition"] = receipt["acquisition"]
    receipt["stop"] = {
        "kind": "confirmed",
        "checker_id": "fixture-engine-http-v1",
        "evidence_refs": receipt["stop"]["evidence_refs"],
    }
    snapshot["requests"][0]["closure"]["stop"] = receipt["stop"]
    snapshot["requests"][0]["manifest"] = row["manifest"]
    snapshot["requests"][0]["terminal"] = "verification"
    receipt["history"] = {
        "manifest_status": "present",
        "manifest_sha256": digest(manifest),
    }
    receipt["receipt_sha256"] = digest(
        {key: value for key, value in receipt.items() if key != "receipt_sha256"}
    )
    result = closure.observe(root, [row], binding)["requests"][
        row["payload"]["request_id"]
    ]
    assert result["release_confirmed"]
    assert result["closure"]["history"]["manifest_status"] == "present"
    assert result["manifest"] == row["manifest"]
