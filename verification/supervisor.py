import argparse
import asyncio
import fcntl
import json
import os
import sys
import tempfile
from datetime import UTC, datetime, timedelta
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
    if json.loads((root / "installation.json").read_text()).get("closure_binding"):
        raise ValueError("legacy_supervisor_cannot_access_closure_target")
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


async def queue_state(config):
    from temporalio.client import Client

    from verification.workflow import EnvironmentQueue

    client = await Client.connect(config.temporal_address, namespace=config.namespace)
    return await client.get_workflow_handle(config.workflow_id).query(
        EnvironmentQueue.snapshot, rpc_timeout=timedelta(seconds=10)
    )


def save_command(path, command):
    path.parent.mkdir(mode=0o700, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(json.dumps(command, sort_keys=True).encode())
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    try:
        os.link(temporary_path, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary_path.unlink()


async def close_request(
    config, request_id, closure_id, reason="context_lost", *, expected_attempt_id=None
):
    from birbverify.closure import BeginClosure, Snapshot
    from birbverify.closure_supervisor import Supervisor

    from verification.adapter import check_profile
    from verification.closure import command_path

    request_id, closure_id = str(UUID(request_id)), str(UUID(closure_id))
    if config.profile != "closure-v2":
        raise ValueError("closure_profile_required")
    root = config.installation_root
    locks = root / "closure-commands"
    locks.mkdir(mode=0o700, exist_ok=True)
    with (locks / f"{request_id}.lock").open("a") as lock:
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                await asyncio.sleep(0.05)
        check_profile(config)
        state = await queue_state(config)
        row = next(
            (
                row
                for row in state["requests"]
                if row["payload"]["request_id"] == request_id
            ),
            None,
        )
        if row is None:
            raise ValueError("request_not_found")
        if state.get("outstanding_request_id") != request_id and row["phase"] not in {
            "dispatching",
            "running",
            "uncertain",
            "terminal",
            "closed",
        }:
            raise ValueError("request_not_dispatched")
        binding = config.closure_binding.model_dump(mode="json")
        if row["admission_binding"] != binding:
            raise ValueError("admission_target_changed")
        if expected_attempt_id is not None and row["attempt_id"] != expected_attempt_id:
            raise ValueError("attempt_request_mismatch")
        supervisor = Supervisor(root, binding)
        path = command_path(root, request_id)
        installed = json.loads((root / "installation.json").read_text())
        common = {
            "contract_version": "birbverify.closure.v1",
            "closure_id": closure_id,
            "target_id": binding["target_id"],
            "target_incarnation": binding["target_incarnation"],
            "request": row["payload"],
            "request_sha256": row["request_sha256"],
            "authorization": {
                **{
                    key: row["payload"]["authority"][key]
                    for key in ["principal", "workflow", "policy_revision"]
                },
                "admission_target_incarnation": binding["target_incarnation"],
                "closure_actor": installed["closure_actor"],
                "grant_reference": installed["closure_grant"],
            },
            "reason": reason,
        }
        if path.exists():
            command = BeginClosure.model_validate_json(path.read_text()).model_dump(
                mode="json"
            )
        else:
            from birbverify.target import TargetError

            try:
                command = BeginClosure.model_validate(
                    supervisor.read(closure_id)["command"]
                ).model_dump(mode="json")
            except TargetError as error:
                if str(error) != "closure_unknown":
                    raise
                observed = Snapshot.model_validate(
                    supervisor.call("observe_closure_state", request_ids=[request_id])
                )
                if (
                    observed.target_id != binding["target_id"]
                    or str(observed.target_incarnation) != binding["target_incarnation"]
                ) or [fact.request_id for fact in observed.requests] != [request_id]:
                    raise ValueError("closure_snapshot_identity_conflict")
                fact = observed.requests[0]
                if fact.request_sha256 not in {None, row["request_sha256"]}:
                    raise ValueError("closure_snapshot_request_conflict")
                if fact.closure is not None:
                    raise ValueError("request_has_other_closure")
                if state.get("outstanding_request_id") != request_id:
                    raise ValueError("request_not_outstanding")
                attempt = row["attempt_id"]
                if fact.manifest is not None:
                    historical_attempt = fact.manifest.attempt_id
                    if attempt is not None and attempt != historical_attempt:
                        raise ValueError("closure_snapshot_attempt_conflict")
                    attempt = historical_attempt
                owner = observed.environment.owner
                if owner.kind == "attempt" and owner.request_id == request_id:
                    if attempt is not None and attempt != owner.attempt_id:
                        raise ValueError("closure_snapshot_attempt_conflict")
                    attempt = owner.attempt_id
                command = BeginClosure.model_validate(
                    {
                        **common,
                        "expected_attempt_id": attempt,
                        "expected_execution_epoch": fact.execution_epoch,
                    }
                ).model_dump(mode="json")
            if any(command[key] != value for key, value in common.items()):
                raise ValueError("closure_command_conflict")
            save_command(path, command)
        if any(command[key] != value for key, value in common.items()):
            raise ValueError("closure_command_conflict")
        result = supervisor.begin(command)
        if result.get("status") == "already_released":
            return result
        return supervisor.reconcile(closure_id)


async def recover_attempt(config, attempt_id, closure_id, reason="context_lost"):
    TypeAdapter(Id).validate_python(attempt_id)
    state = await queue_state(config)
    matches = [row for row in state["requests"] if row["attempt_id"] == attempt_id]
    if len(matches) != 1:
        raise ValueError("attempt_request_not_found")
    return await close_request(
        config,
        matches[0]["payload"]["request_id"],
        closure_id,
        reason,
        expected_attempt_id=attempt_id,
    )


if __name__ == "__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(
        description="Close one fixture request through the producer target"
    )
    parser.add_argument("configuration")
    parser.add_argument("identity")
    parser.add_argument("closure_id")
    parser.add_argument(
        "mode",
        choices=["request", "attempt", "fence", "recover"],
        nargs="?",
        default="request",
    )
    parser.add_argument(
        "--reason",
        choices=["dispatch_unknown", "reservation_reply_lost", "context_lost"],
        default="context_lost",
    )
    arguments = parser.parse_args()
    configuration = load_config(arguments.configuration)
    if arguments.mode in {"fence", "recover"}:
        operation = supervise(
            configuration.installation_root,
            arguments.identity,
            arguments.closure_id,
            fence_only=arguments.mode == "fence",
        )
    elif arguments.mode == "attempt":
        operation = recover_attempt(
            configuration, arguments.identity, arguments.closure_id, arguments.reason
        )
    else:
        operation = close_request(
            configuration, arguments.identity, arguments.closure_id, arguments.reason
        )
    print(json.dumps(asyncio.run(operation)))
