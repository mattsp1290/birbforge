import json
from pathlib import Path

from birbverify.closure import BeginClosure, Binding, Snapshot
from birbverify.contract import digest
from birbverify.lifecycle import ADAPTER
from birbverify.target import rpc

PRODUCER_REVISION = "e785dd8882222b18eaf59ce2b1ceecbd092dcd9e"


def installed_binding(root: Path, expected: dict):
    installed = json.loads((root / "installation.json").read_text())
    binding = Binding.model_validate(expected).model_dump(mode="json")
    if installed.get("closure_binding") != binding:
        raise ValueError("admission_target_changed")
    if installed.get("producer_revision") != PRODUCER_REVISION:
        raise ValueError("producer_pin_mismatch")
    capabilities = rpc(root, "capabilities", binding=binding)
    if (
        any(capabilities.get(key) != value for key, value in binding.items())
        or capabilities.get("extensions") != ["birbverify.closure.v1"]
        or capabilities.get("adapter_revision") != ADAPTER
    ):
        raise ValueError("closure_capability_mismatch")
    return binding


def command_path(root: Path, request_id: str):
    from uuid import UUID

    return root / "closure-commands" / f"{UUID(request_id)}.json"


def receipt_matches(row, fact, receipt, binding, command=None):
    request = row["payload"]
    if (
        row.get("admission_binding") != binding
        or fact.request_sha256 != row["request_sha256"]
        or receipt.request_id != request["request_id"]
        or receipt.idempotency_key != request["idempotency_key"]
        or receipt.request_sha256 != row["request_sha256"]
        or receipt.target_id != binding["target_id"]
        or str(receipt.target_incarnation) != binding["target_incarnation"]
        or receipt.execution_epoch != fact.execution_epoch
        or receipt.acquisition != fact.closure.acquisition
        or receipt.policy_revision != request["authority"]["policy_revision"]
        or receipt.producer_revision != PRODUCER_REVISION
        or receipt.adapter_revision != ADAPTER
    ):
        return False
    if row["attempt_id"] and receipt.acquisition.attempt_id != row["attempt_id"]:
        return False
    manifest = fact.manifest.model_dump(mode="json") if fact.manifest else None
    if row["manifest"] is not None and row["manifest"] != manifest:
        return False
    if receipt.history.manifest_sha256 != (digest(manifest) if manifest else None):
        return False
    return command is None or receipt.command_sha256 == digest(command)


def observe(root: Path, rows: list[dict], expected: dict):
    binding = installed_binding(root, expected)
    identities = [row["payload"]["request_id"] for row in rows]

    def snapshot():
        result = Snapshot.model_validate(
            rpc(root, "observe_closure_state", binding=binding, request_ids=identities)
        )
        if (
            result.target_id != binding["target_id"]
            or str(result.target_incarnation) != binding["target_incarnation"]
        ):
            raise ValueError("snapshot_target_mismatch")
        if [fact.request_id for fact in result.requests] != identities:
            raise ValueError("snapshot_request_mismatch")
        return result

    first = snapshot()
    facts = {}
    for row, fact in zip(rows, first.requests, strict=True):
        identity = row["payload"]["request_id"]
        if row.get("admission_binding") != binding:
            raise ValueError("request_target_mismatch")
        if fact.request_sha256 not in {None, row["request_sha256"]}:
            raise ValueError("request_payload_mismatch")
        manifest = fact.manifest.model_dump(mode="json") if fact.manifest else None
        if manifest and (
            manifest["request_id"] != identity
            or manifest["request_sha256"] != row["request_sha256"]
        ):
            raise ValueError("manifest_request_mismatch")
        closure = {"kind": "absent"}
        release = False
        attempt = fact.manifest.attempt_id if fact.manifest else None
        if (
            first.environment.owner.kind == "attempt"
            and first.environment.owner.request_id == identity
        ):
            attempt = first.environment.owner.attempt_id
        if fact.closure:
            progress = fact.closure
            attempt = progress.acquisition.attempt_id
            closure = {
                "kind": "pending",
                "closure_id": str(progress.closure_id),
                "execution_epoch": progress.execution_epoch,
                "acquisition": progress.acquisition.model_dump(mode="json"),
                "phase": progress.phase,
                "blocking_reason": progress.blocking_reason,
            }
            if progress.receipt:
                receipt = progress.receipt
                command = None
                path = command_path(root, identity)
                if path.exists():
                    command = BeginClosure.model_validate_json(path.read_text())
                validation = rpc(
                    root,
                    "validate_closure_receipt",
                    binding=binding,
                    closure_id=str(receipt.closure_id),
                )
                valid = (
                    receipt.release.environment_revision <= first.record_revision
                    and receipt_matches(row, fact, receipt, binding, command)
                    and validation
                    == {
                        "valid": True,
                        "receipt_sha256": receipt.receipt_sha256,
                    }
                )
                closure = {
                    "kind": "released",
                    "closure_id": str(receipt.closure_id),
                    "execution_epoch": receipt.execution_epoch,
                    "acquisition": receipt.acquisition.model_dump(mode="json"),
                    "history": receipt.history.model_dump(mode="json"),
                    "receipt_sha256": receipt.receipt_sha256,
                    "proof": "valid" if valid else "invalid",
                }
                release = valid
        elif manifest:
            release = (
                manifest["environment_release"] == "released"
                and manifest["termination"] == "confirmed"
                and manifest["cleanup"] == "complete"
                and (row["manifest"] is None or row["manifest"] == manifest)
                and (
                    row["attempt_id"] is None
                    or row["attempt_id"] == manifest["attempt_id"]
                )
                and fact.execution_epoch is not None
            )
        facts[identity] = {
            "attempt_id": attempt,
            "manifest": manifest,
            "closure": closure,
            "release_confirmed": release,
        }
    second = snapshot()
    stable = first == second
    free = (
        stable
        and second.environment.state == "free"
        and second.environment.owner.kind == "none"
    )
    for fact in facts.values():
        fact["release_confirmed"] = fact["release_confirmed"] and free
        if not stable and fact["closure"]["kind"] == "released":
            fact["closure"]["proof"] = "unavailable"
    owner = second.environment.owner
    return {
        "environment": {
            "state": second.environment.state if stable else "unavailable",
            "attempt_id": owner.attempt_id if owner.kind == "attempt" else None,
            "stopped": False,
            "cleanup_complete": False,
        },
        "target_revision": second.record_revision,
        "requests": facts,
        "recovered_attempts": [],
    }
