import json
import os
import tempfile
from pathlib import Path
from uuid import uuid4

from birbverify.contract import Manifest, Request, eligible
from birbverify.target import rpc
from temporalio import activity

from verification.diagnostics import evidence_failure
from verification.model import ProducerObservation, QueueState, public_row


def installation(root: Path):
    return json.loads((root / "installation.json").read_text())


def write_installation(root: Path, value: dict):
    with tempfile.NamedTemporaryFile(dir=root, delete=False) as temporary:
        temporary.write(json.dumps(value).encode())
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, root / "installation.json")
    finally:
        temporary_path.unlink(missing_ok=True)


def observe(root: Path, request_ids: list[str]) -> ProducerObservation:
    environment = rpc(root, "inspect")["environment"]
    rows = {}
    for identity in request_ids:
        result = rpc(root, "result", request_id=identity)
        rows[identity] = {
            "attempt_id": rpc(root, "current_attempt", request_id=identity),
            "manifest": Manifest.model_validate(result).model_dump(mode="json")
            if result
            else None,
        }
    recovered = [
        json.loads(path.read_text()) for path in (root / "recoveries").glob("*.json")
    ]
    return {
        "environment": {
            "state": environment["state"],
            "attempt_id": environment["owner"],
            "stopped": bool(environment["stopped"]),
            "cleanup_complete": bool(environment["cleanup"]),
        },
        "requests": rows,
        "recovered_attempts": [
            receipt["attempt_id"]
            for receipt in recovered
            if receipt["worker_stopped"] and receipt["container_absent"]
        ],
    }


class Observations:
    def __init__(self, root: Path):
        self.root = root

    @activity.defn(name="inspect_verification")
    async def inspect(self, request_ids: list[str]) -> dict:
        return observe(self.root, request_ids)


def projection(root: Path, state: QueueState, principal: str, conversation_id: str):
    current = installation(root)
    rows = [
        row
        for row in state["requests"]
        if row["intent"]["principal"] == principal
        and row["intent"]["conversation_id"] == conversation_id
    ]
    observed = observe(
        root,
        [
            row["payload"]["request_id"]
            for row in rows
            if row["phase"] in {"dispatching", "running", "uncertain"}
        ],
    )
    requests = []
    for row in rows:
        view = public_row(row)
        fact = observed["requests"].get(view["request_id"])
        if fact:
            view["attempt_id"] = fact["attempt_id"] or view["attempt_id"]
        if fact and fact["manifest"] and view["manifest"] is None:
            view.update(
                manifest=fact["manifest"],
                outcome=fact["manifest"]["outcome"],
                phase="terminal",
            )
        elif view["attempt_id"] and view["phase"] == "dispatching":
            view["phase"] = "running"
        request = Request.model_validate(row["payload"])
        reason = "not_passed"
        if view["manifest"] and view["outcome"] == "passed":
            result = Manifest.model_validate(view["manifest"])
            if request.candidate.commit != current.get(
                "current_candidate", current["passing"]
            ):
                reason = "candidate_changed"
            elif request.plan_sha256 != current["plan_sha256"]:
                reason = "approval_changed"
            elif request.authority.policy_revision != current["policy_revision"]:
                reason = "policy_changed"
            elif eligible(
                request,
                result,
                request.candidate,
                lambda item: read_artifact(root, item),
            ):
                reason = "eligible"
            else:
                reason = "evidence_unavailable_or_invalid"
                evidence_failure(root, view["request_id"], view["attempt_id"])
        view["eligibility"] = {"eligible": reason == "eligible", "reason": reason}
        requests.append(view)
    identities = {row["request_id"] for row in requests}
    recoveries = []
    for path in sorted((root / "recoveries").glob("*.json")):
        receipt = json.loads(path.read_text())
        if receipt["request_id"] in identities:
            recoveries.append(receipt)
    environment = observed["environment"]
    if environment["attempt_id"] not in {row["attempt_id"] for row in requests}:
        environment["attempt_id"] = None
    return {
        "installed": {
            "candidate_commit": current.get("current_candidate", current["passing"]),
            "approved_plan_sha256": current["plan_sha256"],
            "policy_revision": current["policy_revision"],
            "environment": "fixture-local",
        },
        "revision": state["revision"],
        "observation_id": str(uuid4()),
        "requests": requests,
        "environment": environment,
        "recoveries": recoveries,
    }


def read_artifact(root, artifact):
    try:
        with (root / "artifacts" / artifact.id).open("rb") as source:
            return source.read(65537)
    except OSError:
        return None
