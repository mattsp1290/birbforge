import asyncio
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from birbverify.contract import digest
from birbverify.kubernetes_service import TargetService
from birbverify.kubernetes_target import KubernetesTarget
from temporalio.service import RPCError
from temporalio.testing import WorkflowEnvironment

from verification.kubernetes import (
    KubernetesAuthority,
    KubernetesConfig,
    KubernetesQueueConfig,
)
from verification.kubernetes_adapter import execute
from verification.kubernetes_workflow import KubernetesQueue

if not os.environ.get("BIRBVERIFY_SOURCE_ROOT"):
    pytest.skip("requires pinned Kubernetes producer fixture", allow_module_level=True)

PRODUCER = Path(os.environ["BIRBVERIFY_SOURCE_ROOT"]).resolve()
SPEC = importlib.util.spec_from_file_location(
    "producer_kubernetes_fixture", PRODUCER / "tests/test_kubernetes_journeys.py"
)
producer_fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(producer_fixture)
installation = producer_fixture.installation
ROOT = Path(__file__).resolve().parents[2]


async def until(read, predicate=bool, seconds=120):
    async with asyncio.timeout(seconds):
        while True:
            value = await read()
            if predicate(value):
                return value
            await asyncio.sleep(0.2)


class HeldResponseAPI:
    def __init__(self, api, hold_first):
        self.api = api
        self.hold_first = hold_first
        self.created = []
        self.releases = []

    def request(self, method, path, body=None):
        result = self.api.request(method, path, body)
        if method == "POST" and path.endswith("/pods"):
            release = threading.Event()
            self.releases.append(release)
            self.created.append(result)
            if not self.hold_first or len(self.created) > 1:
                release.set()
            if not release.wait(120):
                raise TimeoutError("fixture response gate timed out")
        return result


class Runtime:
    def __init__(self, root, installed, clients, *, hold_first=False):
        self.root = root
        self.api = HeldResponseAPI(clients["target"], hold_first)
        self.target = KubernetesTarget(root / "target.sqlite", self.api, installed)
        self.server = TargetService(root / "target.sock", self.target)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.processes = []
        self.installed = installed
        self.conversation = "account-auth-fixture"
        self.worker = None
        self.coordinator = None

    def process(self, module, args):
        log = (self.root / f"process-{len(self.processes)}.log").open("w")
        env = {
            **os.environ,
            "PYTHONPATH": str(ROOT) + os.pathsep + str(PRODUCER / "src"),
        }
        process = subprocess.Popen(
            [sys.executable, "-m", module, *args],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=log,
        )
        log.close()
        self.processes.append(process)
        return process

    def start_coordinator(self):
        self.coordinator = self.process(
            "verification.kubernetes_worker", [str(self.root / "queue.json")]
        )

    def start_worker(self):
        self.worker = self.process(
            "birbverify.kubernetes_worker",
            [
                "--address",
                self.config.temporal_address,
                "--namespace",
                self.config.namespace,
                "--queue",
                self.config.queue.activity_task_queue,
                "--socket",
                str(self.root / "target.sock"),
            ],
        )

    async def boot(self, env):
        authority = KubernetesAuthority(
            target=self.installed.binding,
            installation_sha256=digest(self.installed),
            candidate_revision=os.environ["BIRBVERIFY_SOURCE_REVISION"],
            authored_revision=os.environ["BIRBFORGE_AUTHORED_REVISION"],
            beans_issue="birbforge-yrnb",
            producer_revision=os.environ["BIRBVERIFY_SOURCE_REVISION"],
            policy_revision=self.installed.policy_revision,
            plan_sha256=digest(self.installed.pod_template),
            image=producer_fixture.IMAGE,
        )
        identity = uuid4().hex
        self.config = KubernetesConfig(
            queue=KubernetesQueueConfig(
                authority=authority,
                activity_task_queue="target-" + identity,
                request_timeout_seconds=600,
                activity_timeout_seconds=180,
                continue_threshold=4,
            ),
            temporal_address=env.client.service_client.config.target_host,
            namespace=env.client.namespace,
            workflow_task_queue="queue-" + identity,
        )
        (self.root / "queue.json").write_text(self.config.model_dump_json())
        self.start_coordinator()
        self.handle = env.client.get_workflow_handle(authority.workflow_id)

        async def available():
            try:
                return await self.handle.query(KubernetesQueue.snapshot)
            except RPCError:
                return None

        await until(available)
        description = await self.handle.describe()
        self.first_run_id = (
            description.raw_description.workflow_execution_info.first_run_id
            or description.run_id
        )
        self.client = env.client
        self.start_worker()

    async def command(self, op, body):
        return await execute(
            self.config, {"op": op, "conversation_id": self.conversation, "body": body}
        )

    async def admit(self, identity):
        authority = self.config.queue.authority
        body = {
            "request_id": identity,
            "idempotency_key": identity,
            "candidate_revision": authority.candidate_revision,
            "authored_revision": authority.authored_revision,
            "beans_issue": authority.beans_issue,
            "approved_plan_sha256": authority.plan_sha256,
        }
        result = await self.command("admit", body)
        assert result["ok"], result
        replay = await self.command("admit", body)
        assert replay["ok"], replay
        return result

    async def complete(self, identity):
        state = await until(
            self.state, lambda value: value["rows"][identity]["phase"] == "running"
        )
        body = {
            "request_id": identity,
            "command_id": str(uuid4()),
            "expected_revision": state["rows"][identity]["revision"],
        }
        result = await self.command("complete", body)
        assert result["ok"], result
        replay = await self.command("complete", body)
        assert replay["ok"] and replay["receipt"] == result["receipt"], replay

    async def histories(self):
        histories = []
        run_id = self.first_run_id
        while run_id:
            history = await self.client.get_workflow_handle(
                self.handle.id, run_id=run_id
            ).fetch_history()
            histories.append(history)
            run_id = next(
                (
                    event.workflow_execution_continued_as_new_event_attributes.new_execution_run_id
                    for event in history.events
                    if event.HasField(
                        "workflow_execution_continued_as_new_event_attributes"
                    )
                ),
                None,
            )
        return histories

    async def state(self):
        return await self.handle.query(KubernetesQueue.snapshot)

    async def created(self, index):
        async def read():
            if len(self.api.created) > index:
                return self.api.created[index]
            state = await self.state()
            for row in state["rows"].values():
                if row["activity_outcome"] == "unknown" and not self.api.created:
                    raise AssertionError("producer execute failed before Pod creation")
            return None

        return await until(read)

    def stop(self, process, kill=False):
        if process is not None and process.poll() is None:
            process.kill() if kill else process.terminate()
            process.wait(timeout=15)

    def close(self):
        for release in self.api.releases:
            release.set()
        for process in reversed(self.processes):
            self.stop(process, kill=True)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=15)


async def exercise_account(installed, admin):
    path = f"/api/v1/namespaces/{installed.binding.namespace}/pods/account-auth"

    async def ready():
        pod = await asyncio.to_thread(admin.request, "GET", path)
        return (
            pod
            if any(
                item["type"] == "Ready" and item["status"] == "True"
                for item in pod.get("status", {}).get("conditions", [])
            )
            else None
        )

    pod = await until(ready)
    url = f"http://{pod['status']['podIP']}:8080"

    async def http(path, body=None, token=None):
        args = [
            "docker",
            "exec",
            installed.node_name,
            "curl",
            "--fail",
            "-sS",
            url + path,
        ]
        if body is not None:
            args += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
        if token:
            args += ["-H", "Authorization: " + token]
        return json.loads(await asyncio.to_thread(producer_fixture.command, args))

    account = {"name": "fixture-user", "password": "disposable-fixture-only"}
    assert await http("/accounts", account) == {"account": "fixture-user"}
    token = (await http("/login", account))["token"]
    assert await http("/me", token=token) == {"account": "fixture-user"}
    return {"pod_uid": pod["metadata"]["uid"], "account_auth": "passed"}


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario", ["restart", "worker_lost", "cancelled"])
async def test_real_queue_target_lifecycle(installation, scenario):
    installed, clients, admin, denial = installation
    installed = installed.model_copy(
        update={"producer_revision": os.environ["BIRBVERIFY_SOURCE_REVISION"]}
    )
    with tempfile.TemporaryDirectory(prefix="bfk-", dir="/tmp") as directory:
        root = Path(directory)
        assert denial
        runtime = Runtime(
            root, installed, clients, hold_first=scenario == "worker_lost"
        )
        try:
            async with await WorkflowEnvironment.start_local(
                dev_server_existing_path=os.environ.get(
                    "TEMPORAL_CLI", "/opt/homebrew/bin/temporal"
                ),
                dev_server_database_filename=str(root / "temporal.sqlite"),
                dev_server_startup_timeout=timedelta(seconds=30),
            ) as env:
                await runtime.boot(env)
                first, queued, successor = [str(uuid4()) for _ in range(3)]
                await runtime.admit(first)
                await runtime.created(0)
                await runtime.admit(queued)
                await runtime.admit(successor)
                state = await runtime.state()
                assert state["order"] == [first, queued, successor]
                cancel = {
                    "request_id": queued,
                    "command_id": str(uuid4()),
                    "expected_revision": state["rows"][queued]["revision"],
                }
                assert (await runtime.command("cancel", cancel))["ok"]
                assert (await runtime.command("cancel", cancel))["ok"]
                if scenario != "worker_lost":
                    await until(
                        runtime.state,
                        lambda value: value["rows"][first]["phase"] == "running",
                    )
                app = await exercise_account(installed, admin)
                runtime.stop(runtime.coordinator, kill=True)
                runtime.start_coordinator()
                state = await until(
                    runtime.state,
                    lambda value: value["outstanding_request_id"] == first,
                )
                assert state["rows"][successor]["phase"] == "queued"
                if scenario == "worker_lost":
                    runtime.stop(runtime.worker, kill=True)
                    await until(
                        runtime.state,
                        lambda value: (
                            value["rows"][first]["activity_outcome"] == "unknown"
                        ),
                        seconds=45,
                    )
                    assert (await runtime.state())["rows"][successor][
                        "phase"
                    ] == "queued"
                    runtime.api.releases[0].set()
                    runtime.start_worker()
                elif scenario == "cancelled":
                    cancel = {
                        "request_id": first,
                        "command_id": str(uuid4()),
                        "expected_revision": state["rows"][first]["revision"],
                    }
                    assert (await runtime.command("cancel", cancel))["ok"]
                    assert (await runtime.command("cancel", cancel))["ok"]
                    runtime.api.releases[0].set()
                else:
                    await runtime.complete(first)
                await runtime.created(1)
                state = await runtime.state()
                assert state["rows"][first]["phase"] == "closed"
                assert state["rows"][first]["closure"]["reason"] == (
                    "completed" if scenario == "restart" else scenario
                )
                assert state["rows"][queued]["phase"] == "cancelled_before_dispatch"
                await exercise_account(installed, admin)
                await runtime.complete(successor)
                state = await until(
                    runtime.state,
                    lambda value: value["rows"][successor]["phase"] == "closed",
                )
                assert state["outstanding_request_id"] is None
                snapshot = await runtime.command("snapshot", {})
                assert snapshot["ok"], snapshot
                assert all(
                    not row["eligibility"]["eligible"]
                    for row in snapshot["value"]["requests"]
                )
                histories = await runtime.histories()
                assert len(histories) > 1
                scheduled = [
                    event.activity_task_scheduled_event_attributes
                    for history in histories
                    for event in history.events
                    if event.HasField("activity_task_scheduled_event_attributes")
                ]
                executions = [
                    entry.activity_id
                    for entry in scheduled
                    if entry.activity_type.name == "birbverify_kubernetes_execute"
                ]
                assert executions == [first, successor]
                marker = clients["target"].request(
                    "GET",
                    f"/api/v1/namespaces/{installed.binding.namespace}/configmaps/revision",
                )
                assert marker["data"] == {"baseline": "clean"}
                output = Path(os.environ["BIRBFORGE_KUBE_EVIDENCE"])
                output.mkdir(parents=True, exist_ok=True)
                (output / (scenario + "-history.json")).write_text(
                    json.dumps(
                        {
                            "runs": [
                                json.loads(history.to_json()) for history in histories
                            ]
                        },
                        indent=2,
                    )
                    + "\n"
                )
                (output / (scenario + ".json")).write_text(
                    json.dumps(
                        {
                            "scenario": scenario,
                            "birbforge_revision": os.environ[
                                "BIRBFORGE_SOURCE_REVISION"
                            ],
                            "birbverify_revision": os.environ[
                                "BIRBVERIFY_SOURCE_REVISION"
                            ],
                            "workflow_id": runtime.handle.id,
                            "history_run_count": len(histories),
                            "state": state,
                            "projection": snapshot,
                            "account_auth": app,
                            "admission_denial_observed": bool(denial),
                            "scheduled_execute_activity_ids": executions,
                        },
                        indent=2,
                        sort_keys=True,
                    )
                    + "\n"
                )
        finally:
            runtime.close()
            logs = Path(os.environ["BIRBFORGE_KUBE_EVIDENCE"]) / (scenario + "-logs")
            logs.mkdir(parents=True, exist_ok=True)
            for path in root.glob("process-*.log"):
                shutil.copyfile(path, logs / path.name)
