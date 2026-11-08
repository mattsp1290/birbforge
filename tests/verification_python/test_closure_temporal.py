import asyncio
import fcntl
import hashlib
import http.server
import json
import os
import socketserver
import sqlite3
import subprocess
import sys
import tempfile
import threading
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from birbverify.closure_supervisor import Supervisor
from birbverify.fixture import ROOT, initialize, start_target, stop
from birbverify.fixture_launcher import enable
from birbverify.lifecycle import Engine, container_path
from temporalio.testing import WorkflowEnvironment

from verification.adapter import execute
from verification.closure import PRODUCER_REVISION
from verification.model import Config
from verification.producer import write_installation
from verification.worker_group import launch, owned_worker_identities
from verification.workflow import EnvironmentQueue


async def until(read, predicate, seconds=45):
    async with asyncio.timeout(seconds):
        while True:
            value = await read()
            if predicate(value):
                return value
            await asyncio.sleep(0.1)


class Runtime:
    def __init__(self):
        self.root = Path(
            tempfile.mkdtemp(prefix="c-", dir=os.environ["BIRBFORGE_FIXTURE_ROOT"])
        )
        initialize(self.root)
        self.installed = enable(self.root, PRODUCER_REVISION)
        (self.root / "launch").mkdir()
        self.processes = []
        self.groups = []
        self.target = None
        self.config_path = self.root / "queue.json"
        self.conversation = str(uuid4())
        self.engine = Engine()
        self.source = Path(__file__).resolve().parents[2]

    def start_target(self):
        if self.target:
            stop(self.target)
            (self.root / "transport/target.sock").unlink(missing_ok=True)
        write_installation(self.root, self.installed)
        self.target = start_target(self.root)

    def coordinator(self):
        process = self.process(
            [sys.executable, "-m", "verification", "worker", str(self.config_path)]
        )
        return process

    def process(self, command):
        with (self.root / f"process-{len(self.processes)}.log").open("w") as output:
            process = subprocess.Popen(
                command,
                cwd=self.source,
                stdout=output,
                stderr=output,
                env={
                    "PATH": "/usr/bin:/bin",
                    "PYTHONPATH": str(self.source),
                    "PYTHONUNBUFFERED": "1",
                    "BIRBVERIFY_WORKER_IMAGE": os.environ["BIRBVERIFY_WORKER_IMAGE"],
                },
            )
        self.processes.append(process)
        return process

    async def boot(self, env):
        identity = uuid4().hex[:12]
        self.config = Config(
            installation_root=self.root,
            profile="closure-v2",
            closure_binding=self.installed["closure_binding"],
            temporal_address=env.client.service_client.config.target_host,
            namespace=env.client.namespace,
            workflow_id=f"queue-{identity}-closure-v2",
            workflow_task_queue=f"queue-{identity}",
            activity_task_queue=f"activity-{identity}",
            continue_threshold=4,
        )
        self.config_path.write_text(self.config.model_dump_json())
        self.queue = self.coordinator()
        self.handle = await env.client.start_workflow(
            EnvironmentQueue.run,
            {"config": self.config.model_dump(mode="json")},
            id=self.config.workflow_id,
            task_queue=self.config.workflow_task_queue,
        )

    def worker(self):
        group = launch(self.config)
        self.groups.append(group)
        return group

    async def admit(self):
        identity = str(uuid4())
        result = await execute(
            self.config,
            {
                "op": "admit",
                "principal": "owner",
                "conversation_id": self.conversation,
                "body": {
                    "request_id": identity,
                    "idempotency_key": str(uuid4()),
                    "candidate_commit": self.installed["passing"],
                    "approved_plan_sha256": self.installed["plan_sha256"],
                },
            },
        )
        assert result["ok"], result
        return identity

    async def state(self):
        return await self.handle.query(EnvironmentQueue.snapshot)

    async def snapshot(self):
        result = await execute(
            self.config,
            {
                "op": "snapshot",
                "principal": "owner",
                "conversation_id": self.conversation,
                "body": {},
            },
        )
        assert result["ok"], result
        return result["value"]

    def supervisor(self, identity, closure_id, mode="request"):
        return self.process(
            [
                sys.executable,
                "-m",
                "verification.supervisor",
                str(self.config_path),
                identity,
                closure_id,
                mode,
            ]
        )

    async def wait_process(self, process, success=True, error=None):
        code = await asyncio.to_thread(process.wait, 25)
        assert (code == 0) == success, f"supervisor exit {code}; inspect {self.root}"
        if error:
            output = (
                self.root / f"process-{self.processes.index(process)}.log"
            ).read_text()
            assert error in output, "expected supervisor rejection was not recorded"

    async def observation_marker(self):
        run_id = (await self.handle.describe()).run_id
        history = await self.handle.fetch_history()
        return run_id, max(event.event_id for event in history.events)

    async def observed_after(self, marker):
        async def completed():
            run_id = (await self.handle.describe()).run_id
            history = await self.handle.fetch_history()
            scheduled = {
                event.event_id
                for event in history.events
                if event.HasField("activity_task_scheduled_event_attributes")
                and event.activity_task_scheduled_event_attributes.activity_type.name
                == "inspect_verification"
                and (run_id != marker[0] or event.event_id > marker[1])
            }
            return any(
                event.HasField("activity_task_completed_event_attributes")
                and event.activity_task_completed_event_attributes.scheduled_event_id
                in scheduled
                for event in history.events
            )

        await until(completed, bool)

    def record(self, name, value):
        destination = Path(
            os.environ.get("BIRBFORGE_CLOSURE_EVIDENCE", str(self.root / "evidence"))
        )
        destination.mkdir(parents=True, exist_ok=True, mode=0o700)
        (destination / (name + ".json")).write_text(json.dumps(value, indent=2) + "\n")

    def close(self):
        failures = []

        def attempt(action):
            try:
                action()
            except (
                AssertionError,
                RuntimeError,
                ValueError,
                OSError,
                sqlite3.Error,
                subprocess.SubprocessError,
            ) as error:
                failures.append(error)

        def remove(identity):
            status, data = self.engine.raw("GET", container_path(identity) + "/json")
            assert status in {200, 404}, "container_inspection_unknown"
            if status == 200:
                identity = json.loads(data)["Id"]
                assert self.engine.raw(
                    "DELETE", container_path(identity) + "?force=true"
                )[0] in {204, 404}
                assert (
                    self.engine.raw("GET", container_path(identity) + "/json")[0] == 404
                )

        for group in self.groups:
            attempt(group.remove)

        def workers():
            for identity in owned_worker_identities(self.root):
                attempt(lambda identity=identity: remove(identity))

        attempt(workers)
        for process in self.processes:
            attempt(lambda process=process: stop(process))

        def candidates():
            with sqlite3.connect(self.root / "target.sqlite") as database:
                attempts = database.execute("SELECT id FROM attempts").fetchall()
            for (identity,) in attempts:
                attempt(lambda identity=identity: remove("birbverify-" + identity))

        attempt(candidates)
        if self.target:
            attempt(lambda: stop(self.target))
        if failures:
            raise ExceptionGroup("Owned fixture cleanup was not confirmed", failures)


@pytest.mark.asyncio
async def test_never_acquired_lost_reply_restart_evidence_and_successor():
    runtime = Runtime()
    runtime.installed["fixture_drop_reply"] = ["begin_closure"]
    runtime.start_target()
    try:
        async with await WorkflowEnvironment.start_local(
            dev_server_startup_timeout=timedelta(seconds=30),
            dev_server_existing_path=str(ROOT / ".proof/bin/temporal"),
            dev_server_database_filename=str(runtime.root / "temporal.sqlite"),
        ) as env:
            await runtime.boot(env)
            first = await runtime.admit()
            second = await runtime.admit()
            state = await until(
                runtime.state, lambda state: state["outstanding_request_id"] == first
            )
            await runtime.wait_process(
                runtime.supervisor(second, str(uuid4())),
                success=False,
                error="request_not_dispatched",
            )
            assert not (runtime.root / "closure-commands" / f"{second}.json").exists()
            row = state["requests"][0]
            response = await execute(
                runtime.config,
                {
                    "op": "cancel",
                    "principal": "owner",
                    "conversation_id": runtime.conversation,
                    "body": {
                        "request_id": first,
                        "command_id": str(uuid4()),
                        "expected_revision": row["revision"],
                    },
                },
            )
            assert response["ok"]
            await until(
                runtime.state,
                lambda state: state["requests"][0]["phase"] == "uncertain",
            )
            closure_id = str(uuid4())
            await runtime.wait_process(
                runtime.supervisor(first, closure_id), success=False
            )
            command_path = runtime.root / "closure-commands" / f"{first}.json"
            original = command_path.read_bytes()
            assert json.loads(original)["expected_attempt_id"] is None
            assert json.loads(original)["expected_execution_epoch"] is None
            assert (runtime.root / "launch/begin_closure.reply-dropped").exists()
            stop(runtime.queue)
            runtime.installed["fixture_drop_reply"] = []
            runtime.start_target()
            view = Supervisor(runtime.root).reconcile(closure_id)
            receipt = view["progress"]["receipt"]
            assert receipt["acquisition"]["kind"] == "never_acquired"
            runtime.queue = runtime.coordinator()
            command_path.unlink()
            await runtime.wait_process(
                runtime.supervisor(first, str(uuid4())),
                success=False,
                error="request_has_other_closure",
            )
            assert not command_path.exists()
            await runtime.wait_process(runtime.supervisor(first, closure_id))
            assert json.loads(command_path.read_bytes()) == json.loads(original)
            from birbverify.fixture_launcher import WorkerGroup

            payload = (await runtime.state())["requests"][0]["payload"]
            (runtime.root / "launch/late-request.json").write_text(json.dumps(payload))
            late = WorkerGroup(
                runtime.root,
                [
                    sys.executable,
                    str(ROOT / "tests/closure_worker.py"),
                    str(runtime.root),
                    "normal",
                    "late-request.json",
                    first + ".late",
                ],
            )
            runtime.groups.append(late)

            async def late_ended():
                return (runtime.root / "launch/worker-ended").exists()

            await until(late_ended, bool)
            late_error = json.loads(
                (runtime.root / "launch/worker-error.json").read_text()
            )
            assert late_error["error"] == "request_closed"
            owner = runtime.process(
                [
                    sys.executable,
                    "-m",
                    "verification.worker_group",
                    str(runtime.config_path),
                ]
            )

            async def registered():
                return list((runtime.root / "owned-worker-groups").glob("*.json"))

            group_records = await until(registered, bool)
            group_record = json.loads(group_records[0].read_text())
            owned_id = group_record["container_id"]
            assert (
                group_record["entry_sha256"]
                == hashlib.sha256(
                    (runtime.root / "launch/birbforge_activity.py").read_bytes()
                ).hexdigest()
            )
            assert (
                group_record["entry_sha256"]
                == hashlib.sha256(
                    (runtime.source / "verification/activity_entry.py").read_bytes()
                ).hexdigest()
            )
            state = await until(
                runtime.state, lambda state: state["requests"][1]["phase"] == "terminal"
            )
            assert state["requests"][0]["phase"] == "closed"
            assert state["requests"][0]["manifest"] is None
            assert state["requests"][1]["manifest"]["outcome"] == "passed"
            before = Supervisor(runtime.root).call(
                "observe_closure_state", request_ids=[first, second]
            )
            await runtime.wait_process(runtime.supervisor(first, closure_id))
            after = Supervisor(runtime.root).call(
                "observe_closure_state", request_ids=[first, second]
            )
            assert before == after
            owner.terminate()
            assert await asyncio.to_thread(owner.wait, 15) == 0
            runtime.installed["fixture_pause_before_context"] = True
            runtime.start_target()
            owner = runtime.process(
                [
                    sys.executable,
                    "-m",
                    "verification.worker_group",
                    str(runtime.config_path),
                ]
            )
            third = await runtime.admit()

            async def third_reserved():
                return (runtime.root / "launch/reserved.ready").exists()

            await until(third_reserved, bool)
            active = Supervisor(runtime.root).call(
                "observe_closure_state", request_ids=[second, third]
            )
            assert active["environment"]["owner"]["request_id"] == third
            await runtime.wait_process(
                runtime.supervisor(second, str(uuid4())),
                success=False,
                error="request_not_outstanding",
            )
            assert not (runtime.root / "closure-commands" / f"{second}.json").exists()
            unchanged = Supervisor(runtime.root).call(
                "observe_closure_state", request_ids=[second, third]
            )
            assert unchanged == active and unchanged["requests"][0]["closure"] is None
            owned_id = json.loads(
                max(
                    (runtime.root / "owned-worker-groups").glob("*.json"),
                    key=lambda path: path.stat().st_mtime_ns,
                ).read_text()
            )["container_id"]
            owner.kill()
            await asyncio.to_thread(owner.wait, 5)
            status, inspection = runtime.engine.raw(
                "GET", container_path(owned_id) + "/json"
            )
            assert status == 200 and json.loads(inspection)["State"]["Running"]
            removal = runtime.process(
                [sys.executable, "-m", "verification.worker_group", "remove", owned_id]
            )
            await runtime.wait_process(removal)
            assert (
                runtime.engine.raw("GET", container_path(owned_id) + "/json")[0] == 404
            )
            await runtime.wait_process(
                runtime.supervisor(first, str(uuid4())),
                success=False,
                error="closure_command_conflict",
            )
            changed_reason = runtime.process(
                [
                    sys.executable,
                    "-m",
                    "verification.supervisor",
                    str(runtime.config_path),
                    first,
                    closure_id,
                    "request",
                    "--reason",
                    "dispatch_unknown",
                ]
            )
            await runtime.wait_process(
                changed_reason, success=False, error="closure_command_conflict"
            )
            assert json.loads(command_path.read_bytes()) == json.loads(original)
            runtime.record(
                "never-acquired",
                {
                    "first": first,
                    "second": second,
                    "receipt": receipt,
                    "state": state,
                    "immutable_command_sha256": hashlib.sha256(original).hexdigest(),
                },
            )
    finally:
        runtime.close()


@pytest.mark.asyncio
async def test_registered_worker_loss_missing_context_and_competing_supervisors():
    runtime = Runtime()
    runtime.installed["fixture_pause_before_context"] = True
    runtime.installed["fixture_drop_reply"] = ["begin_closure"]
    runtime.start_target()
    try:
        async with await WorkflowEnvironment.start_local(
            dev_server_startup_timeout=timedelta(seconds=30),
            dev_server_existing_path=str(ROOT / ".proof/bin/temporal"),
            dev_server_database_filename=str(runtime.root / "temporal.sqlite"),
        ) as env:
            await runtime.boot(env)
            group = runtime.worker()
            first = await runtime.admit()
            second = await runtime.admit()

            async def reserved():
                return (runtime.root / "launch/reserved.ready").exists()

            await until(reserved, bool)
            assert not list((runtime.root / "contexts").glob("*.json"))
            group.remove()
            state = await until(
                runtime.state,
                lambda state: (
                    state["requests"][0]["phase"] == "uncertain"
                    and state["requests"][0]["attempt_id"] is not None
                ),
                seconds=45,
            )
            assert (
                state["outstanding_request_id"] == first
                and state["requests"][1]["phase"] == "queued"
            )
            attempt = state["requests"][0]["attempt_id"]
            assert attempt
            closure_id = str(uuid4())
            await runtime.wait_process(
                runtime.supervisor(first, closure_id), success=False
            )
            stop(runtime.queue)
            runtime.installed["fixture_drop_reply"] = []
            runtime.start_target()
            receipt = Supervisor(runtime.root).reconcile(closure_id)["progress"][
                "receipt"
            ]
            evidence = (
                runtime.root
                / "lifecycle-evidence"
                / (receipt["stop"]["evidence_refs"][0]["id"] + ".json")
            )
            retained = evidence.read_bytes()
            evidence.unlink()
            runtime.queue = runtime.coordinator()
            marker = await runtime.observation_marker()
            await runtime.observed_after(marker)
            state = await runtime.state()
            assert (
                state["outstanding_request_id"] == first
                and state["requests"][1]["phase"] == "queued"
            )
            missing = await runtime.snapshot()
            assert missing["requests"][0]["closure"]["proof"] == "invalid"
            marker = await runtime.observation_marker()
            evidence.write_bytes(b"corrupt")
            await runtime.observed_after(marker)
            assert (await runtime.state())["outstanding_request_id"] == first
            invalid = await runtime.snapshot()
            assert invalid["requests"][0]["closure"]["proof"] == "invalid"
            lock_path = runtime.root / "closure-commands" / f"{first}.lock"
            with lock_path.open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                request_route = runtime.supervisor(first, closure_id)
                attempt_route = runtime.supervisor(attempt, str(uuid4()), "attempt")

                async def both_opened_lock():
                    return all(
                        any(
                            descriptor.resolve() == lock_path
                            for descriptor in Path(f"/proc/{process.pid}/fd").glob("*")
                        )
                        for process in (request_route, attempt_route)
                    )

                await until(both_opened_lock, bool)
                assert request_route.poll() is None and attempt_route.poll() is None
                fcntl.flock(lock, fcntl.LOCK_UN)
            await runtime.wait_process(request_route)
            await runtime.wait_process(
                attempt_route, success=False, error="closure_command_conflict"
            )
            view = Supervisor(runtime.root).read(closure_id)
            assert view["progress"]["receipt"]["acquisition"]["attempt_id"] == attempt
            assert (
                view["progress"]["receipt"]["history"]["manifest_status"]
                == "unavailable"
            )
            assert not (
                runtime.root / "contexts" / (attempt + ".context.json")
            ).exists()
            stop(runtime.queue)
            runtime.queue = runtime.coordinator()
            (runtime.root / "launch/reserved.ready").unlink()
            evidence.write_bytes(retained)
            runtime.worker()
            await until(reserved, bool)
            active = Supervisor(runtime.root).call(
                "observe_closure_state", request_ids=[first, second]
            )
            assert active["environment"]["owner"]["request_id"] == second
            await runtime.wait_process(runtime.supervisor(first, closure_id))
            replayed = Supervisor(runtime.root).call(
                "observe_closure_state", request_ids=[first, second]
            )
            assert replayed == active
            (runtime.root / "launch/reserved.continue").touch()
            state = await until(
                runtime.state, lambda state: state["requests"][1]["phase"] == "terminal"
            )
            assert state["requests"][0]["manifest"] is None
            assert state["requests"][1]["manifest"]["outcome"] == "passed"
            runtime.record(
                "acquired-contextless",
                {
                    "receipt": view["progress"]["receipt"],
                    "state": state,
                    "successor": second,
                    "worker_container": group.container_id,
                },
            )
    finally:
        runtime.close()


@pytest.mark.asyncio
async def test_unknown_mutating_delivery_retains_original_manifest_and_blocks_successor():
    runtime = Runtime()
    runtime.installed["fixture_drop_reply"] = ["lifecycle_intent"]
    runtime.start_target()
    try:
        async with await WorkflowEnvironment.start_local(
            dev_server_startup_timeout=timedelta(seconds=30),
            dev_server_existing_path=str(ROOT / ".proof/bin/temporal"),
            dev_server_database_filename=str(runtime.root / "temporal.sqlite"),
        ) as env:
            await runtime.boot(env)
            runtime.worker()
            first = await runtime.admit()
            second = await runtime.admit()
            state = await until(
                runtime.state, lambda state: state["requests"][0]["phase"] == "terminal"
            )
            original = state["requests"][0]["manifest"]
            assert (
                original["outcome"] == "inconclusive"
                and original["environment_release"] == "quarantined"
            )
            assert state["outstanding_request_id"] == first
            closure_id = str(uuid4())
            await runtime.wait_process(runtime.supervisor(first, closure_id))
            closure = Supervisor(runtime.root).read(closure_id)
            assert closure["progress"]["receipt"] is None
            assert closure["progress"]["phase"] == "fenced_stop_unknown"
            assert (
                runtime.engine.raw(
                    "GET",
                    container_path("birbverify-" + original["attempt_id"]) + "/json",
                )[0]
                == 404
            )
            stop(runtime.queue)
            runtime.queue = runtime.coordinator()
            (runtime.root / "recoveries").mkdir()
            marker = await runtime.observation_marker()
            (runtime.root / "recoveries/forged.json").write_text(
                json.dumps(
                    {
                        "request_id": first,
                        "attempt_id": original["attempt_id"],
                        "worker_stopped": True,
                        "container_absent": True,
                    }
                )
            )
            await runtime.observed_after(marker)
            await runtime.wait_process(runtime.supervisor(first, closure_id))
            replay = Supervisor(runtime.root).read(closure_id)
            assert replay["command"] == closure["command"]
            assert replay["progress"]["phase"] == "fenced_stop_unknown"
            assert replay["progress"]["receipt"] is None
            after = await runtime.state()
            assert after["requests"][0]["manifest"] == original
            assert (
                after["outstanding_request_id"] == first
                and after["requests"][1]["phase"] == "queued"
            )
            snapshot = await runtime.snapshot()
            assert snapshot["requests"][0]["outcome"] == "inconclusive"
            assert snapshot["requests"][0]["closure"]["kind"] == "pending"
            assert snapshot["recoveries"] == []
            runtime.record(
                "unknown-mutation",
                {
                    "first": first,
                    "second": second,
                    "original_manifest": original,
                    "state": after,
                    "snapshot": snapshot,
                },
            )
    finally:
        runtime.close()


@pytest.mark.asyncio
async def test_present_quarantined_manifest_closes_and_successor_runs():
    runtime = Runtime()
    dropped = threading.Event()
    removed = threading.Event()

    class Gate(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def handle_command(self):
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else None
            if (
                self.command == "GET"
                and self.path.endswith("/json")
                and removed.is_set()
                and not dropped.is_set()
            ):
                dropped.set()
                self.close_connection = True
                return
            status, response = Engine().raw(self.command, self.path, body)
            if self.command == "DELETE" and status == 204:
                removed.set()
            self.send_response(status)
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        do_GET = handle_command
        do_POST = handle_command
        do_DELETE = handle_command

    socket = runtime.root / "launch/read-loss.sock"
    server = Gate(str(socket), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    runtime.installed["fixture_daemon_socket"] = str(socket)
    runtime.start_target()
    try:
        async with await WorkflowEnvironment.start_local(
            dev_server_startup_timeout=timedelta(seconds=30),
            dev_server_existing_path=str(ROOT / ".proof/bin/temporal"),
            dev_server_database_filename=str(runtime.root / "temporal.sqlite"),
        ) as env:
            await runtime.boot(env)
            runtime.worker()
            first = await runtime.admit()
            second = await runtime.admit()
            state = await until(
                runtime.state,
                lambda value: value["requests"][0]["manifest"] is not None,
            )
            original = state["requests"][0]["manifest"]
            original_bytes = json.dumps(original, sort_keys=True).encode()
            assert dropped.is_set()
            assert original["environment_release"] == "quarantined"
            assert state["outstanding_request_id"] == first
            assert state["requests"][1]["phase"] == "queued"
            supervisor = Supervisor(runtime.root)
            records = supervisor.call(
                "lifecycle_records", request_id=first, recovery_key=supervisor.key
            )
            assert any(
                row["settlement"] == "unknown" and row["intent"]["verb"] == "inspect"
                for row in records
            )
            assert all(
                row["settlement"] != "unknown"
                for row in records
                if row["intent"]["verb"] in {"create", "start", "remove"}
            )
            closure_ids = [str(uuid4()), str(uuid4())]
            lock_path = runtime.root / "closure-commands" / f"{first}.lock"
            lock_path.parent.mkdir(exist_ok=True)
            with lock_path.open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                contenders = [
                    runtime.supervisor(first, closure_ids[0]),
                    runtime.supervisor(
                        original["attempt_id"], closure_ids[1], "attempt"
                    ),
                ]

                async def both_opened_lock():
                    return all(
                        any(
                            path.resolve() == lock_path
                            for path in Path(f"/proc/{process.pid}/fd").glob("*")
                        )
                        for process in contenders
                    )

                await until(both_opened_lock, bool)
                assert all(process.poll() is None for process in contenders)
                fcntl.flock(lock, fcntl.LOCK_UN)
            codes = await asyncio.gather(
                *(asyncio.to_thread(process.wait, 25) for process in contenders)
            )
            assert sorted(codes) == [0, 1]
            winner = codes.index(0)
            await runtime.wait_process(
                contenders[1 - winner], success=False, error="closure_command_conflict"
            )
            paths = list((runtime.root / "closure-commands").glob("*.json"))
            assert len(paths) == 1
            assert json.loads(paths[0].read_text())["closure_id"] == closure_ids[winner]
            receipt = supervisor.read(closure_ids[winner])["progress"]["receipt"]
            assert (
                receipt is not None
                and receipt["history"]["manifest_status"] == "present"
            )
            from birbverify.contract import digest

            assert receipt["history"]["manifest_sha256"] == digest(original)
            runtime.worker()
            state = await until(
                runtime.state, lambda value: value["requests"][1]["phase"] == "terminal"
            )
            assert state["requests"][1]["manifest"]["outcome"] == "passed"
            assert (
                json.dumps(state["requests"][0]["manifest"], sort_keys=True).encode()
                == original_bytes
            )
            target = supervisor.call(
                "observe_closure_state", request_ids=[first, second]
            )
            assert target["requests"][0]["closure"]["closure_id"] == closure_ids[winner]
            assert target["requests"][1]["closure"] is None
            projection = await runtime.snapshot()
            assert (
                projection["requests"][0]["closure"]["history"]["manifest_status"]
                == "present"
            )
            runtime.record(
                "present-history",
                {
                    "receipt": receipt,
                    "state": state,
                    "target": target,
                    "original_manifest_sha256": digest(original),
                    "contender_exit_codes": codes,
                },
            )
    finally:
        runtime.close()
        server.shutdown()
        server.server_close()


@pytest.mark.asyncio
async def test_launch_crash_before_registration_retains_exact_cleanup_identity():
    runtime = Runtime()
    runtime.start_target()
    runtime.config = Config(
        installation_root=runtime.root,
        profile="closure-v2",
        closure_binding=runtime.installed["closure_binding"],
        temporal_address="127.0.0.1:1",
        workflow_id="launch-crash-closure-v2",
        workflow_task_queue="launch-crash",
        activity_task_queue="launch-crash",
    )
    runtime.config_path.write_text(runtime.config.model_dump_json())
    try:
        script = """
import os, signal, sys
from birbverify.lifecycle import Engine
from verification.adapter import load_config
from verification.worker_group import launch
original = Engine.raw
def crash(self, method, path, body=None):
    result = original(self, method, path, body)
    if method == 'POST' and path.startswith('/containers/create?name=worker-'):
        assert result[0] == 201
        os.kill(os.getpid(), signal.SIGKILL)
    return result
Engine.raw = crash
launch(load_config(sys.argv[1]))
"""
        process = runtime.process(
            [sys.executable, "-c", script, str(runtime.config_path)]
        )
        assert await asyncio.to_thread(process.wait, 20) == -9
        assert not list((runtime.root / "owned-worker-groups").glob("*.json"))
        with sqlite3.connect(runtime.root / "target.sqlite") as database:
            assert (
                database.execute(
                    "SELECT count(*) FROM worker_registrations"
                ).fetchone()[0]
                == 0
            )
        identities = owned_worker_identities(runtime.root)
        assert len(identities) == 1
        assert (
            runtime.engine.raw("GET", container_path(identities[0]) + "/json")[0] == 200
        )
        runtime.close()
        assert (
            runtime.engine.raw("GET", container_path(identities[0]) + "/json")[0] == 404
        )
        runtime.record(
            "launcher-crash",
            {
                "identity": identities[0],
                "exit_code": process.returncode,
                "confirmed_absent": True,
            },
        )
    finally:
        runtime.close()
