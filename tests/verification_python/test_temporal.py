import asyncio
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

import pytest
from birbverify.contract import Request, digest
from birbverify.fixture import ROOT, initialize, start_target, stop
from birbverify.fixture import spawn as spawn_producer
from birbverify.target import TargetError, rpc
from temporalio.common import WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.service import RPCError
from temporalio.testing import WorkflowEnvironment

from verification.adapter import execute
from verification.model import Config
from verification.producer import write_installation
from verification.supervisor import supervise
from verification.workflow import EnvironmentQueue


async def until(read, predicate, seconds=50):
    async with asyncio.timeout(seconds):
        while True:
            try:
                value = await read()
            except RPCError:
                await asyncio.sleep(0.15)
                continue
            if predicate(value):
                return value
            await asyncio.sleep(0.15)


@pytest.mark.asyncio
async def test_real_activity_queue_restarts_recovery_cancel_and_gate(
    monkeypatch, capsys
):
    identity = uuid4().hex[:12]
    root = Path(tempfile.mkdtemp(prefix=f"bfq-{identity}-", dir="/tmp"))
    installed = initialize(root)
    first_id = str(uuid4())
    installed["pause_after_effect"] = [first_id]
    write_installation(root, installed)
    target = start_target(root)
    processes = []
    source = str(Path(__file__).resolve().parents[2])
    process_env = {
        "PATH": "/usr/bin:/bin",
        "HOME": "/nonexistent",
        "PYTHONPATH": source,
        "PYTHONUNBUFFERED": "1",
        "OTEL_SDK_DISABLED": "true",
    }
    config_path = root / "queue.json"

    def spawn(mode):
        with (root / f"{mode}-{len(processes)}.log").open("ab") as log:
            process = subprocess.Popen(
                [sys.executable, "-m", "verification", mode, str(config_path)],
                env=process_env,
                cwd=source,
                stdout=log,
                stderr=log,
            )
        processes.append(process)
        return process

    try:
        async with await WorkflowEnvironment.start_local(
            namespace=f"bfq-{identity}",
            dev_server_existing_path=str(ROOT / ".proof/bin/temporal"),
            dev_server_database_filename=str(root / "temporal.sqlite"),
            dev_server_log_level="error",
        ) as env:
            config = Config(
                installation_root=root,
                temporal_address=env.client.service_client.config.target_host,
                namespace=f"bfq-{identity}",
                workflow_id=f"queue-{identity}",
                workflow_task_queue=f"control-{identity}",
                activity_task_queue=f"activity-{identity}",
                continue_threshold=4,
            )
            config_path.write_text(config.model_dump_json())
            coordinator = spawn("worker")
            handle = await env.client.start_workflow(
                EnvironmentQueue.run,
                {"config": config.model_dump(mode="json")},
                id=config.workflow_id,
                task_queue=config.workflow_task_queue,
                id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
            )
            conversation = str(uuid4())

            def command(request_id=None):
                return {
                    "op": "admit",
                    "principal": "owner",
                    "conversation_id": conversation,
                    "body": {
                        "request_id": request_id or str(uuid4()),
                        "idempotency_key": str(uuid4()),
                        "candidate_commit": installed["passing"],
                        "approved_plan_sha256": installed["plan_sha256"],
                    },
                }

            async def snapshot():
                result = await execute(
                    config,
                    {
                        "op": "snapshot",
                        "principal": "owner",
                        "conversation_id": conversation,
                        "body": {},
                    },
                )
                assert result["ok"], result
                return result["value"]

            never_started = {**command(), "conversation_id": str(uuid4())}
            assert (await execute(config, never_started))["ok"]

            async def never_started_state():
                state = await handle.query(EnvironmentQueue.snapshot)
                return state["requests"][0]

            pending = await until(
                never_started_state, lambda row: row["phase"] == "dispatching"
            )
            assert pending["attempt_id"] is None
            assert (
                await execute(
                    config,
                    {
                        "op": "cancel",
                        "principal": "owner",
                        "conversation_id": never_started["conversation_id"],
                        "body": {
                            "request_id": pending["payload"]["request_id"],
                            "command_id": str(uuid4()),
                            "expected_revision": pending["revision"],
                        },
                    },
                )
            )["ok"]
            cancelled = await until(
                never_started_state, lambda row: row["phase"] == "not_acquired"
            )
            assert cancelled["cancellation"] == "acknowledged"
            assert cancelled["manifest"] is None
            assert (
                rpc(
                    root, "current_attempt", request_id=pending["payload"]["request_id"]
                )
                is None
            )
            executor = spawn("activity-worker")
            a, b, c = command(first_id), command(), command()
            admitted = await execute(config, a)
            assert admitted["ok"], admitted
            assert (await execute(config, a))["value"]["request_sha256"] == admitted[
                "value"
            ]["request_sha256"]
            assert (await execute(config, b))["ok"]
            c_receipt = (await execute(config, c))["value"]
            await until(
                snapshot, lambda value: value["requests"][0]["attempt_id"] is not None
            )
            async with asyncio.timeout(40):
                while not list(root.glob(f"{first_id}-*.effect-committed")):
                    await asyncio.sleep(0.1)
            view = await snapshot()
            attempt = view["requests"][0]["attempt_id"]
            assert view["requests"][1]["phase"] == "queued"
            assert view["requests"][1]["attempt_id"] is None
            history = await handle.fetch_history()
            scheduled = [
                event.activity_task_scheduled_event_attributes.activity_id
                for event in history.events
                if event.HasField("activity_task_scheduled_event_attributes")
                and event.activity_task_scheduled_event_attributes.activity_type.name
                == "verify_candidate"
            ]
            assert scheduled == [never_started["body"]["request_id"], first_id]
            with pytest.raises(ValueError, match="worker_stop_unconfirmed"):
                await supervise(root, attempt, str(uuid4()))
            cancel = {
                "op": "cancel",
                "principal": "owner",
                "conversation_id": conversation,
                "body": {
                    "request_id": c["body"]["request_id"],
                    "command_id": str(uuid4()),
                    "expected_revision": c_receipt["revision"],
                },
            }
            assert (await execute(config, cancel))["ok"]
            stop(executor)
            stop(coordinator)
            assert executor.returncode == coordinator.returncode == -9
            coordinator = spawn("worker")
            recovery_id = str(uuid4())
            fenced = await supervise(root, attempt, recovery_id, fence_only=True)
            assert fenced["phase"] == "quarantined"
            manifest_before = rpc(root, "result", request_id=first_id)
            assert manifest_before["outcome"] == "inconclusive"
            assert manifest_before["environment_release"] == "quarantined"
            assert (
                rpc(root, "current_attempt", request_id=b["body"]["request_id"]) is None
            )
            assert rpc(root, "inspect")["environment"]["state"] == "quarantined"
            context = json.loads((root / f"{attempt}.context.json").read_text())
            operation = {
                **context["owner"],
                "operation_id": f"{first_id}.apply",
                "request_id": first_id,
                "candidate": installed["passing"],
                "payload_sha256": digest(
                    {
                        "request": admitted["value"]["request_sha256"],
                        "candidate": installed["passing"],
                    }
                ),
            }
            (root / "stale-operation.json").write_text(json.dumps(operation))
            stale = spawn_producer(root, "birbverify.stale_probe")
            processes.append(stale)
            (root / "stale-go").touch()
            async with asyncio.timeout(10):
                while stale.poll() is None:
                    await asyncio.sleep(0.05)
            assert (
                stale.returncode == 0
                and (root / "stale-result").read_text() == "fenced"
            )
            assert len(rpc(root, "inspect")["operations"]) == 1
            assert (await snapshot())["environment"]["state"] == "quarantined"
            assert (
                rpc(root, "current_attempt", request_id=b["body"]["request_id"]) is None
            )
            for recovery_operation, state_after in [
                ("recover", "revoked"),
                ("cleanup", "revoked"),
                ("release", "free"),
            ]:

                def lost_reply(root, method, _operation=recovery_operation, **data):
                    result = rpc(root, method, **data)
                    if method == _operation:
                        raise ConnectionError("test drops committed reply")
                    return result

                with monkeypatch.context() as patch:
                    patch.setattr("verification.supervisor.rpc", lost_reply)
                    with pytest.raises(ConnectionError):
                        await supervise(root, attempt, recovery_id)
                assert rpc(root, "inspect")["environment"]["state"] == state_after
            executor = spawn("activity-worker")
            view = await until(
                snapshot, lambda value: value["requests"][1]["outcome"] == "passed"
            )
            recovery = await supervise(root, attempt, recovery_id)
            cleanup_event = json.loads(capsys.readouterr().err.strip().splitlines()[-1])
            assert cleanup_event["message"] == "cleanup_complete"
            assert cleanup_event["request_id"] == first_id
            assert cleanup_event["attempt_id"] == attempt
            assert cleanup_event["source_id"] == "supervisor"
            assert await supervise(root, attempt, recovery_id) == recovery
            with pytest.raises(ValueError, match="attempt_already_recovered"):
                await supervise(root, attempt, str(uuid4()))
            assert rpc(root, "result", request_id=first_id) == manifest_before
            view = await snapshot()
            assert view["requests"][2]["phase"] == "cancelled_before_dispatch"
            assert view["requests"][2]["attempt_id"] is None
            assert view["requests"][1]["eligibility"]["eligible"]
            before_stale = rpc(root, "inspect")
            with pytest.raises(TargetError, match="stale_owner"):
                rpc(root, "apply", **operation)
            after_stale = rpc(root, "inspect")
            assert before_stale["operations"] == after_stale["operations"]
            assert (
                before_stale["environment"]["value"]
                == after_stale["environment"]["value"]
            )
            assert len(view["recoveries"]) == 1
            assert (await execute(config, cancel))["ok"]
            changed_cancel = {
                **cancel,
                "body": {**cancel["body"], "expected_revision": 999},
            }
            assert (await execute(config, changed_cancel))[
                "code"
            ] == "command_id_conflict"
            changed = {**a, "body": {**a["body"], "candidate_commit": "a" * 40}}
            assert (await execute(config, changed))["code"] == "idempotency_conflict"
            assert (await execute(config, {**a, "principal": "stranger"}))[
                "code"
            ] == "forbidden"
            state = await handle.query(EnvironmentQueue.snapshot)
            for row in state["requests"]:
                assert (
                    digest(Request.model_validate(row["payload"]))
                    == row["request_sha256"]
                )
            initial_run = (await handle.describe()).run_id
            await until(
                handle.describe, lambda value: value.run_id != initial_run, seconds=15
            )
            assert (await execute(config, a))["value"]["manifest"] == manifest_before
            assert (await execute(config, cancel))["ok"]
            artifact = view["requests"][1]["manifest"]["checks"][0]["artifacts"][0]
            artifact_path = root / "artifacts" / artifact["id"]
            original_bytes = artifact_path.read_bytes()
            artifact_path.write_bytes(b"corrupt")
            assert (await snapshot())["requests"][1]["eligibility"][
                "reason"
            ] == "evidence_unavailable_or_invalid"
            artifact_path.unlink()
            assert not (await snapshot())["requests"][1]["eligibility"]["eligible"]
            artifact_path.write_bytes(original_bytes)
            for field, value, reason in [
                ("current_candidate", "a" * 40, "candidate_changed"),
                ("plan_sha256", "f" * 64, "approval_changed"),
                ("policy_revision", "d" * 40, "policy_changed"),
            ]:
                write_installation(root, {**installed, field: value})
                assert (await snapshot())["requests"][1]["eligibility"][
                    "reason"
                ] == reason
                assert (await execute(config, a))["value"][
                    "request_sha256"
                ] == admitted["value"]["request_sha256"]
            installed["current_candidate"] = installed["slow"]
            write_installation(root, installed)
            running = command()
            running["body"]["candidate_commit"] = installed["slow"]
            assert (await execute(config, running))["ok"]
            view = await until(
                snapshot, lambda value: value["requests"][-1]["attempt_id"] is not None
            )
            running_cancel = {
                "op": "cancel",
                "principal": "owner",
                "conversation_id": conversation,
                "body": {
                    "request_id": running["body"]["request_id"],
                    "command_id": str(uuid4()),
                    "expected_revision": view["requests"][-1]["revision"],
                },
            }
            assert (await execute(config, running_cancel))["ok"]
            view = await until(
                snapshot,
                lambda value: value["requests"][-1]["cancellation"] == "acknowledged",
            )
            assert view["requests"][-1]["outcome"] == "cancelled"
            rejected = command()
            rejected["body"]["candidate_commit"] = installed["slow"]
            write_installation(root, {**installed, "policy_revision": "d" * 40})
            assert (await execute(config, rejected))["ok"]
            view = await until(
                snapshot, lambda value: value["requests"][-1]["phase"] == "not_acquired"
            )
            assert view["requests"][-1]["attempt_id"] is None
            assert view["requests"][-1]["manifest"] is None
            stop(executor)
            with pytest.raises(ValueError, match="attempt_not_quarantined"):
                await supervise(root, view["requests"][1]["attempt_id"], str(uuid4()))
            await handle.terminate("owned test complete")
            assert (await execute(config, a))["code"] == "verification_unavailable"
            with pytest.raises(WorkflowAlreadyStartedError):
                await env.client.start_workflow(
                    EnvironmentQueue.run,
                    {"config": config.model_dump(mode="json")},
                    id=config.workflow_id,
                    task_queue=config.workflow_task_queue,
                    id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
                )
            (root / "proof.json").write_text(
                json.dumps({"snapshot": view, "fixture_root": str(root)})
            )
            print(f"verified fixture {root}")
    finally:
        for process in reversed(processes):
            stop(process)
        stop(target)


@pytest.mark.asyncio
async def test_timeout_without_attempt_stays_blocked_and_expires_all_queued():
    from datetime import UTC, datetime, timedelta

    from temporalio.client import WorkflowUpdateFailedError
    from temporalio.worker import Worker
    from test_queue import intent

    from verification.model import BindingInstallation, bind
    from verification.producer import Observations

    identity = uuid4().hex[:12]
    root = Path(tempfile.mkdtemp(prefix=f"bfq-timeout-{identity}-", dir="/tmp"))
    installed = initialize(root)
    target = start_target(root)
    try:
        async with await WorkflowEnvironment.start_local(
            namespace=f"bfq-{identity}",
            dev_server_existing_path=str(ROOT / ".proof/bin/temporal"),
            dev_server_log_level="error",
        ) as env:
            config = Config(
                installation_root=root,
                temporal_address=env.client.service_client.config.target_host,
                namespace=f"bfq-{identity}",
                workflow_id=f"queue-{identity}",
                workflow_task_queue=f"control-{identity}",
                activity_task_queue=f"unavailable-{identity}",
                continue_threshold=100,
            )
            rows = []
            now = datetime.now(UTC)
            for seconds in [3, 2, 2]:
                command = intent(installed)
                payload = bind(
                    command, BindingInstallation.from_installed(installed), now
                )
                payload["resources"]["deadline"] = (
                    now + timedelta(seconds=seconds)
                ).isoformat()
                rows.append(
                    {
                        "intent": command,
                        "payload": payload,
                        "request_sha256": digest(payload),
                        "revision": 1,
                        "phase": "queued",
                        "cancellation": "none",
                        "cancellation_command_ids": [],
                        "attempt_id": None,
                        "manifest": None,
                        "activity_outcome": None,
                    }
                )
            async with Worker(
                env.client,
                task_queue=config.workflow_task_queue,
                workflows=[EnvironmentQueue],
                activities=[Observations(root).inspect],
            ):
                handle = await env.client.start_workflow(
                    EnvironmentQueue.run,
                    {
                        "config": config.model_dump(mode="json"),
                        "state": {"revision": 3, "requests": rows, "commands": {}},
                    },
                    id=config.workflow_id,
                    task_queue=config.workflow_task_queue,
                )
                with pytest.raises(WorkflowUpdateFailedError):
                    await handle.execute_update(
                        EnvironmentQueue.admit,
                        {
                            "intent": intent(installed),
                            "installation": {},
                        },
                    )

                async def state():
                    return await handle.query(EnvironmentQueue.snapshot)

                observed = await until(
                    state, lambda value: value["requests"][0]["phase"] == "uncertain"
                )
                observed = await until(
                    state,
                    lambda value: all(
                        row["phase"] == "expired" for row in value["requests"][1:]
                    ),
                )
                assert observed["requests"][0]["activity_outcome"] == "unknown"
                await asyncio.sleep(2)
                assert (await state())["requests"][0]["phase"] == "uncertain"
                for row in rows:
                    assert (
                        rpc(
                            root,
                            "current_attempt",
                            request_id=row["payload"]["request_id"],
                        )
                        is None
                    )
                history = await handle.fetch_history()
                dispatches = [
                    event
                    for event in history.events
                    if event.HasField("activity_task_scheduled_event_attributes")
                    and event.activity_task_scheduled_event_attributes.activity_type.name
                    == "verify_candidate"
                ]
                assert len(dispatches) == 1
                await handle.terminate("owned timeout proof complete")
    finally:
        stop(target)
