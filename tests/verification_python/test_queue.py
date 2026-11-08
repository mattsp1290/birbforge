import copy
import json
import subprocess
import sys
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from birbverify.contract import Request, digest
from birbverify.fixture import ROOT
from pydantic import ValidationError

from verification.model import Command
from verification.workflow import EnvironmentQueue


@pytest.mark.parametrize("arguments", [["--fence"], ["fenc"], ["fence", "extra"]])
def test_supervisor_rejects_unknown_modes_before_loading_configuration(
    tmp_path, arguments
):
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "verification.supervisor",
            str(tmp_path / "missing.json"),
            "attempt-example",
            str(uuid4()),
            *arguments,
        ],
        capture_output=True,
        check=False,
        text=True,
        timeout=10,
    )
    assert result.returncode == 2
    assert "usage:" in result.stderr
    assert "FileNotFoundError" not in result.stderr


def fixture_installation():
    sample = json.loads((ROOT / "contracts/v1/request.example.json").read_text())
    return {
        "fixture_mode": True,
        "passing": sample["candidate"]["commit"],
        "plan": sample["plan"],
        "plan_sha256": sample["plan_sha256"],
        "policy_revision": sample["authority"]["policy_revision"],
    }


def intent(installation):
    return {
        "op": "admit",
        "principal": "owner",
        "conversation_id": str(uuid4()),
        "body": {
            "request_id": str(uuid4()),
            "idempotency_key": str(uuid4()),
            "candidate_commit": installation["passing"],
            "approved_plan_sha256": installation["plan_sha256"],
        },
    }


@pytest.fixture
def queue(monkeypatch):
    monkeypatch.setattr(
        "verification.workflow.workflow.now", lambda: datetime(2026, 1, 1, tzinfo=UTC)
    )
    queue = EnvironmentQueue(
        {"config": {"owner_principal": "owner", "max_requests": 2}}
    )
    monkeypatch.setattr(queue, "diagnostic", lambda event, row: None)
    return queue


def test_admission_replay_binding_drift_and_independent_identity(queue):
    installed = fixture_installation()
    original = intent(installed)
    first = queue.admit({"intent": original, "installation": installed})
    bound = copy.deepcopy(queue.state["requests"][0])
    changed = {**installed, "policy_revision": "d" * 40, "plan_sha256": "f" * 64}
    assert queue.admit({"intent": original, "installation": changed}) == first
    assert queue.state["requests"][0] == bound
    replacement = copy.deepcopy(original)
    replacement["body"]["candidate_commit"] = "e" * 40
    assert (
        queue.admit({"intent": replacement, "installation": changed})["code"]
        == "idempotency_conflict"
    )
    replacement = copy.deepcopy(original)
    replacement["body"]["idempotency_key"] = str(uuid4())
    assert (
        queue.admit({"intent": replacement, "installation": installed})["code"]
        == "request_id_conflict"
    )
    assert digest(Request.model_validate(bound["payload"])) == bound["request_sha256"]
    assert bound["payload"]["goal_id"] == original["conversation_id"]
    assert bound["payload"]["authority"]["principal"] == "fixture-owner"


def test_cancel_receipts_compare_full_payload_before_revision(queue):
    installed = fixture_installation()
    original = intent(installed)
    queue.admit({"intent": original, "installation": installed})
    command = {
        "op": "cancel",
        "principal": "owner",
        "conversation_id": original["conversation_id"],
        "body": {
            "request_id": original["body"]["request_id"],
            "command_id": str(uuid4()),
            "expected_revision": 1,
        },
    }
    first = queue.cancel(command)
    assert first["ok"] and queue.state["requests"][0]["cancellation"] == "acknowledged"
    assert queue.cancel(command) == first
    changed = copy.deepcopy(command)
    changed["body"]["expected_revision"] = 2
    assert queue.cancel(changed)["code"] == "command_id_conflict"
    changed["body"]["command_id"] = str(uuid4())
    changed["body"]["expected_revision"] = 1
    assert queue.cancel(changed)["code"] == "stale_revision"
    changed["conversation_id"] = str(uuid4())
    assert queue.cancel(changed)["code"] == "request_not_found"
    assert len(queue.state["commands"]) == 1


def test_untrusted_boundary_and_owner(queue):
    installed = fixture_installation()
    original = intent(installed)
    for field in [
        "authority",
        "resources",
        "outcome",
        "policy_revision",
        "deadline",
        "executable",
    ]:
        malformed = copy.deepcopy(original)
        malformed["body"][field] = "forged"
        with pytest.raises(ValidationError):
            Command.model_validate(malformed).normalized()
    original["principal"] = "stranger"
    assert (
        queue.admit({"intent": original, "installation": installed})["code"]
        == "forbidden"
    )
    original["principal"] = "owner"
    original["body"]["request_id"] = "../../elsewhere"
    with pytest.raises(ValidationError):
        Command.model_validate(original).normalized()


def test_canonical_producer_golden_defaults_unicode_datetime():
    sample = json.loads((ROOT / "contracts/v1/request.example.json").read_text())
    assert (
        digest(Request.model_validate(sample))
        == "ec09cc4b5f6aba77d653e4274e7e3a9eaebfc5c481aeeca558c3ad6e52e42746"
    )
    del sample["candidate"]["artifact_sha256"]
    sample["plan"]["checks"][0]["assertion"] = "値 equals 42"
    sample["plan_sha256"] = digest(sample["plan"])
    sample["resources"]["deadline"] = "2030-01-01T01:00:00.123400+01:00"
    request = Request.model_validate(sample)
    normalized = request.model_dump(mode="json")
    assert normalized["candidate"]["artifact_sha256"] is None
    assert normalized["resources"]["deadline"] == "2030-01-01T01:00:00.123400+01:00"
    assert digest(Request.model_validate(json.loads(json.dumps(normalized)))) == digest(
        request
    )
    for field, value in [("contract_version", "birbverify.v2"), ("extra", True)]:
        with pytest.raises(ValidationError):
            Request.model_validate({**sample, field: value})


def test_capacity_retains_old_receipts(queue):
    installed = fixture_installation()
    first = intent(installed)
    receipt = queue.admit({"intent": first, "installation": installed})
    assert queue.admit({"intent": intent(installed), "installation": installed})["ok"]
    assert (
        queue.admit({"intent": intent(installed), "installation": installed})["code"]
        == "queue_capacity"
    )
    assert queue.admit({"intent": first, "installation": installed}) == receipt


def test_reconciliation_preserves_requests_absent_from_observation(queue):
    installed = fixture_installation()
    queue.admit({"intent": intent(installed), "installation": installed})
    queue.reconcile(
        {"requests": {}, "environment": {"state": "free"}, "recovered_attempts": []}
    )
    assert queue.state["requests"][0]["phase"] == "queued"


def test_unknown_termination_cancel_waits_for_recovery_evidence(queue):
    installed = fixture_installation()
    original = intent(installed)
    queue.admit({"intent": original, "installation": installed})
    row = queue.state["requests"][0]
    row.update(phase="uncertain", cancellation="requested", attempt_id="attempt")
    fact = {
        "attempt_id": "attempt",
        "manifest": {
            "outcome": "inconclusive",
            "cancellation": "none",
            "termination": "unknown",
            "environment_release": "quarantined",
        },
    }
    observed = {
        "requests": {original["body"]["request_id"]: fact},
        "recovered_attempts": [],
        "environment": {"state": "quarantined"},
    }
    queue.reconcile(observed)
    assert row["phase"] == "terminal" and row["cancellation"] == "requested"
    queue.reconcile({**observed, "recovered_attempts": ["attempt"]})
    assert row["cancellation"] == "acknowledged"


def test_diagnostics_allowlist_private_fields_and_size_bound(tmp_path):
    from verification.diagnostics import MAX_LOG_BYTES, event_json, evidence_failure

    event = json.loads(
        event_json(
            "admitted",
            request_id="request",
            source_id="queue",
            timestamp="2026-01-01T00:00:00Z",
        )
    )
    assert (
        event["service"] == "birbforge-verification"
        and event["correlation_id"] == "request"
    )
    assert set(event) == {
        "service",
        "env",
        "version",
        "timestamp",
        "status",
        "message",
        "request_id",
        "attempt_id",
        "correlation_id",
        "source_id",
    }
    with pytest.raises(ValueError, match="unknown_diagnostic_event"):
        event_json(
            "private_payload", request_id="request", source_id="queue", timestamp="now"
        )
    for _ in range(300):
        evidence_failure(tmp_path, "request", "attempt")
    assert (tmp_path / "verification-diagnostics.jsonl").stat().st_size <= MAX_LOG_BYTES
    assert (
        len((tmp_path / "verification-diagnostics.jsonl").read_text().splitlines()) == 1
    )
    evidence_failure(tmp_path, "another-request", "another-attempt")
    assert (
        len((tmp_path / "verification-diagnostics.jsonl").read_text().splitlines()) == 2
    )


@pytest.mark.parametrize("field", ["passing", "plan", "policy_revision"])
def test_malformed_installation_is_rejected_without_mutation(queue, field):
    installed = fixture_installation()
    original = intent(installed)
    del installed[field]
    message = {"intent": original, "installation": installed}
    with pytest.raises(ValidationError):
        queue.validate_admit(message)
    assert queue.admit(message) == {
        "ok": False,
        "status": 403,
        "code": "installation_denied",
    }
    assert queue.state["requests"] == []


def test_installation_binding_excludes_private_runtime_fields():
    from verification.model import BindingInstallation

    installed = fixture_installation()
    extra = {
        "recovery_key_sha256": "private",
        "repository": "/private",
        "pause_after_effect": [],
    }
    subset = BindingInstallation.from_installed({**installed, **extra})
    assert subset == installed
    with pytest.raises(ValidationError):
        BindingInstallation.model_validate({**installed, **extra})


@pytest.mark.parametrize(
    "outcome,phase",
    [
        ("cancelled", "not_acquired"),
        ("rejected", "not_acquired"),
        ("unknown", "uncertain"),
        ("completed", "uncertain"),
    ],
)
def test_no_attempt_requires_known_activity_closure(queue, outcome, phase):
    installed = fixture_installation()
    original = intent(installed)
    queue.admit({"intent": original, "installation": installed})
    row = queue.state["requests"][0]
    row.update(phase="uncertain", cancellation="requested", activity_outcome=outcome)
    queue.reconcile(
        {
            "requests": {
                original["body"]["request_id"]: {"attempt_id": None, "manifest": None}
            },
            "environment": {"state": "free"},
            "recovered_attempts": [],
        }
    )
    assert row["phase"] == phase
    assert row["cancellation"] == (
        "acknowledged" if phase == "not_acquired" else "requested"
    )
    assert row["manifest"] is None


def test_all_queued_deadlines_expire_behind_uncertain_head(queue):
    installed = fixture_installation()
    queue.config["max_requests"] = 4
    for _ in range(4):
        queue.admit({"intent": intent(installed), "installation": installed})
    queue.state["requests"][0]["phase"] = "uncertain"
    for row in queue.state["requests"]:
        row["payload"]["resources"]["deadline"] = "2025-01-01T00:00:00+00:00"
    queue.expire_queued()
    assert [row["phase"] for row in queue.state["requests"]] == [
        "uncertain",
        "expired",
        "expired",
        "expired",
    ]


@pytest.mark.asyncio
async def test_inspection_omits_queued_and_terminal_history(queue, monkeypatch):
    installed = fixture_installation()
    queue.config["max_requests"] = 4
    for phase in ["queued", "dispatching", "uncertain", "terminal"]:
        queue.admit({"intent": intent(installed), "installation": installed})
        queue.state["requests"][-1]["phase"] = phase
    calls = []

    async def inspect(name, request_ids, **options):
        calls.append(request_ids)

    monkeypatch.setattr("verification.workflow.workflow.execute_activity", inspect)
    await queue.inspect()
    assert calls == [
        [row["payload"]["request_id"] for row in queue.state["requests"][1:3]]
    ]


def test_manifest_is_immutable_on_conflicting_observation(queue, monkeypatch):
    installed = fixture_installation()
    original = intent(installed)
    queue.admit({"intent": original, "installation": installed})
    manifest = {"outcome": "passed", "environment_release": "released"}
    observed = {
        "requests": {
            original["body"]["request_id"]: {
                "attempt_id": "attempt",
                "manifest": manifest,
            }
        },
        "environment": {"state": "free"},
        "recovered_attempts": [],
    }
    queue.reconcile(observed)
    row = queue.state["requests"][0]
    revision = row["revision"]
    events = []
    monkeypatch.setattr(queue, "diagnostic", lambda event, row: events.append(event))
    observed["requests"][original["body"]["request_id"]]["manifest"] = {
        **manifest,
        "outcome": "failed",
    }
    queue.reconcile(observed)
    assert row["manifest"] == manifest
    assert row["revision"] == revision
    assert events == ["manifest_conflict"]


@pytest.mark.asyncio
@pytest.mark.parametrize("known_rejection", [False, True])
async def test_generic_worker_error_does_not_prove_no_acquisition(
    queue, monkeypatch, known_rejection
):
    from types import SimpleNamespace

    from temporalio.exceptions import ActivityError, ApplicationError

    installed = fixture_installation()
    original = intent(installed)
    queue.admit({"intent": original, "installation": installed})
    queue.config.update(activity_task_queue="unavailable", continue_threshold=100)
    failure = ActivityError(
        "activity failed",
        scheduled_event_id=1,
        started_event_id=2,
        identity="worker",
        activity_type="verify_candidate",
        activity_id=original["body"]["request_id"],
        retry_state=None,
    )
    failure.__cause__ = ApplicationError("worker failed", non_retryable=known_rejection)
    dispatched = []

    async def failed_activity():
        raise failure

    def dispatch(*args, **kwargs):
        dispatched.append(kwargs["activity_id"])
        return failed_activity()

    async def inspect():
        return {
            "requests": {
                original["body"]["request_id"]: {"attempt_id": None, "manifest": None}
            },
            "environment": {"state": "free"},
            "recovered_attempts": [],
        }

    class CycleFinished(Exception):
        pass

    async def stop_loop(seconds):
        raise CycleFinished

    monkeypatch.setattr(queue, "inspect", inspect)
    monkeypatch.setattr("verification.workflow.workflow.start_activity", dispatch)
    monkeypatch.setattr(
        "verification.workflow.workflow.info",
        lambda: SimpleNamespace(is_continue_as_new_suggested=lambda: False),
    )
    monkeypatch.setattr("verification.workflow.workflow.sleep", stop_loop)
    with pytest.raises(CycleFinished):
        await queue.run({})
    assert dispatched == [original["body"]["request_id"]]
    assert queue.state["requests"][0]["phase"] == (
        "not_acquired" if known_rejection else "uncertain"
    )
