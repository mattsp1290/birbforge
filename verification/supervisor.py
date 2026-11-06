import argparse
import asyncio
import fcntl
import json
import os
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from birbverify.contract import Id, Request, digest
from birbverify.runner import Runner
from birbverify.target import rpc
from pydantic import TypeAdapter

from verification.adapter import load_config
from verification.diagnostics import event_json


def stopped(identity):
    if (
        identity["boot_id"]
        != Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    ):
        return True
    try:
        fields = (
            Path(f"/proc/{int(identity['pid'])}/stat")
            .read_text()
            .rsplit(")", 1)[1]
            .split()
        )
    except FileNotFoundError:
        return True
    return fields[19] != identity["start_ticks"] or fields[0] == "Z"


def record_receipt(path, receipt):
    path.parent.mkdir(mode=0o700, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(json.dumps(receipt, sort_keys=True).encode())
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    try:
        os.link(temporary_path, path)
    except FileExistsError:
        existing = json.loads(path.read_text())
        if existing["recovery_id"] != receipt["recovery_id"]:
            raise ValueError("attempt_already_recovered")
        return existing
    finally:
        temporary_path.unlink()
    return receipt


async def supervise(root: Path, attempt_id: str, recovery_id: str, *, fence_only=False):
    TypeAdapter(Id).validate_python(attempt_id)
    recovery_id = str(UUID(recovery_id))
    runner = Runner(root)
    context = runner.context(attempt_id)
    request = Request.model_validate(context["request"])
    owner = context["owner"]
    if owner["attempt_id"] != attempt_id:
        raise ValueError("context_identity_conflict")
    receipt_path = root / "recoveries" / f"{attempt_id}.json"
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
        if (
            receipt["attempt_id"] != attempt_id
            or receipt["request_id"] != request.request_id
        ):
            raise ValueError("recovery_identity_conflict")
        if receipt["recovery_id"] != recovery_id:
            raise ValueError("attempt_already_recovered")
        return receipt
    identities = [
        json.loads(path.read_text())
        for path in (root / "worker-identities").glob("*.json")
    ]
    identities = [
        identity
        for identity in identities
        if identity["installation_root"] == str(root.resolve())
        and datetime.fromisoformat(identity["started_at"])
        <= datetime.fromisoformat(context["started_at"])
    ]
    if not identities or not stopped(
        max(identities, key=lambda identity: identity["started_at"])
    ):
        raise ValueError("worker_stop_unconfirmed")
    result = rpc(root, "result", request_id=request.request_id)
    environment = rpc(root, "inspect")["environment"]
    if (
        result
        and result["attempt_id"] == attempt_id
        and result["environment_release"] == "quarantined"
        and result["termination"] == "unknown"
        and environment["owner"] != attempt_id
    ):
        if not await runner.stop_container(f"birbverify-{attempt_id}"):
            raise ValueError("container_stop_unconfirmed")
        if fence_only:
            return {
                "request_id": request.request_id,
                "attempt_id": attempt_id,
                "phase": environment["state"],
                "manifest_sha256": digest(result),
            }
        return completed_receipt(
            receipt_path, recovery_id, request.request_id, attempt_id, result
        )
    with (root / "activity-worker.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("worker_running") from None
        if not await runner.stop_container(f"birbverify-{attempt_id}"):
            raise ValueError("container_stop_unconfirmed")
        environment = rpc(root, "inspect")["environment"]
        result = rpc(root, "result", request_id=request.request_id)
        if environment["state"] != "free" and environment["owner"] != attempt_id:
            raise ValueError("different_environment_owner")
        if not result:
            if environment["owner"] != attempt_id:
                raise ValueError("missing_owned_attempt")
            result = runner.finalize(
                request,
                context,
                [],
                "inconclusive",
                termination="unknown",
                reason="worker_lost",
            ).model_dump(mode="json")
        if result["attempt_id"] != attempt_id:
            raise ValueError("terminal_attempt_conflict")
        if (
            result["environment_release"] != "quarantined"
            or result["termination"] != "unknown"
        ):
            raise ValueError("attempt_not_quarantined")
        if fence_only:
            return {
                "request_id": request.request_id,
                "attempt_id": attempt_id,
                "phase": rpc(root, "inspect")["environment"]["state"],
                "manifest_sha256": digest(result),
            }
        key = (root / "supervisor.key").read_text()
        environment = rpc(root, "inspect")["environment"]
        if environment["state"] == "quarantined":
            rpc(root, "recover", **owner, recovery_key=key)
        environment = rpc(root, "inspect")["environment"]
        if (
            environment["state"] == "revoked"
            and environment["stopped"]
            and not environment["cleanup"]
        ):
            rpc(root, "cleanup", **owner)
        environment = rpc(root, "inspect")["environment"]
        if (
            environment["state"] == "revoked"
            and environment["stopped"]
            and environment["cleanup"]
        ):
            rpc(root, "release", **owner, recovery_key=key)
        if rpc(root, "inspect")["environment"]["state"] != "free":
            raise ValueError("release_unconfirmed")
        return completed_receipt(
            receipt_path, recovery_id, request.request_id, attempt_id, result
        )


def completed_receipt(path, recovery_id, request_id, attempt_id, result):
    path.parent.mkdir(mode=0o700, exist_ok=True)
    with (path.parent / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for existing_path in path.parent.glob("*.json"):
            existing = json.loads(existing_path.read_text())
            if (
                existing["recovery_id"] == recovery_id
                and existing["attempt_id"] != attempt_id
            ):
                raise ValueError("recovery_identity_conflict")
        receipt = record_receipt(
            path,
            {
                "recovery_id": recovery_id,
                "request_id": request_id,
                "attempt_id": attempt_id,
                "manifest_sha256": digest(result),
                "completed_at": datetime.now(UTC).isoformat(),
                "worker_stopped": True,
                "container_absent": True,
            },
        )
    print(
        event_json(
            "cleanup_complete",
            request_id=request_id,
            attempt_id=attempt_id,
            source_id="supervisor",
            timestamp=receipt["completed_at"],
        ),
        file=sys.stderr,
    )
    return receipt


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(
        description="Reconcile one stopped fixture attempt through the target"
    )
    parser.add_argument("configuration")
    parser.add_argument("attempt_id")
    parser.add_argument("recovery_id")
    parser.add_argument(
        "mode", choices=["fence", "recover"], nargs="?", default="recover"
    )
    arguments = parser.parse_args()
    configuration = load_config(arguments.configuration)
    print(
        json.dumps(
            asyncio.run(
                supervise(
                    configuration.installation_root,
                    arguments.attempt_id,
                    arguments.recovery_id,
                    fence_only=arguments.mode == "fence",
                )
            )
        )
    )
