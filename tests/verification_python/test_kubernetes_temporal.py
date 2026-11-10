import asyncio
import copy
import shutil
import tempfile
import threading
from pathlib import Path

import pytest
from birbverify.contract import digest
from birbverify.kubernetes_contract import KubernetesInstallation
from birbverify.kubernetes_service import TargetService
from birbverify.kubernetes_target import KubernetesTarget
from birbverify.kubernetes_worker import KubernetesActivities
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from test_kubernetes import admission, cancellation, completion, config

from verification.kubernetes import validate_closure
from verification.kubernetes_workflow import KubernetesQueue


class Missing(Exception):
    status = 404


class KubernetesAPI:
    def __init__(self):
        self.objects = {
            "/apis/admissionregistration.k8s.io": {"versions": [{"version": "v1"}]},
            "/apis/admissionregistration.k8s.io/v1/mutatingwebhookconfigurations": {
                "items": []
            },
            "/api/v1/namespaces/kube-system": {"metadata": {"uid": "cluster"}},
            "/api/v1/namespaces/app": {"metadata": {"uid": "namespace"}},
            "/api/v1/nodes/node": {"metadata": {"uid": "node-uid"}},
            "/api/v1/namespaces/app/configmaps/revision": {
                "metadata": {"name": "revision", "uid": "cm", "resourceVersion": "1"},
                "data": {"baseline": "original"},
            },
        }
        self.acquisitions = []
        self.terminated = threading.Event()
        self.created = threading.Event()
        self.unblock_create = threading.Event()
        self.unblock_create.set()

    def request(self, method, path, body=None):
        if method == "GET":
            if path not in self.objects:
                raise Missing()
            obj = copy.deepcopy(self.objects[path])
            if "/pods/" in path and self.terminated.is_set():
                obj["status"] = {
                    "phase": "Failed",
                    "containerStatuses": [
                        {"name": "app", "state": {"terminated": {"exitCode": 143}}},
                    ],
                }
            return obj
        body = copy.deepcopy(body)
        if method == "POST":
            path += "/" + body["metadata"]["name"]
            self.acquisitions.append(
                body["metadata"]["labels"]["birbverify.dev/request"]
            )
            body["metadata"].update(
                uid="pod-" + str(len(self.acquisitions)), resourceVersion="1"
            )
            self.created.set()
            if not self.unblock_create.wait(20):
                raise TimeoutError("test did not release create")
        elif method == "DELETE":
            self.objects[path]["metadata"]["deletionTimestamp"] = "2026-01-01T00:00:00Z"
            return copy.deepcopy(self.objects[path])
        elif (
            method == "PUT"
            and body["metadata"]["resourceVersion"]
            != self.objects[path]["metadata"]["resourceVersion"]
        ):
            raise ValueError("conflict")
        body["metadata"]["resourceVersion"] = str(
            int(body["metadata"].get("resourceVersion", "0")) + 1
        )
        self.objects[path] = body
        if "/pods/" in path and not body["metadata"].get("finalizers"):
            del self.objects[path]
        return copy.deepcopy(body)


@pytest.fixture
def target(tmp_path):
    api = KubernetesAPI()
    queue_config = config()
    policies = {
        f"/apis/admissionregistration.k8s.io/v1/{resource}/birbverify-app{suffix}": {
            "spec_sha256": digest({"fixture": True}),
            "uid": resource + suffix,
            "generation": 1,
        }
        for resource in (
            "validatingadmissionpolicies",
            "validatingadmissionpolicybindings",
        )
        for suffix in ("", "-identity")
    }
    api.objects.update(
        {
            path: {
                "spec": {"fixture": True},
                "metadata": {"uid": pin["uid"], "generation": pin["generation"]},
            }
            for path, pin in policies.items()
        }
    )
    installed = KubernetesInstallation(
        admission_specs=policies,
        producer_revision="b" * 40,
        policy_revision="c" * 40,
        binding=queue_config.authority.target,
        pod_name="candidate",
        configmap_name="revision",
        node_name="node",
        node_uid="node-uid",
        pod_template={"spec": {"containers": [{"name": "app", "image": "old"}]}},
    )
    queue_config = queue_config.model_copy(
        update={
            "authority": queue_config.authority.model_copy(
                update={"installation_sha256": digest(installed)}
            )
        }
    )
    target = KubernetesTarget(tmp_path / "journal.db", api, installed)
    temporary = tempfile.TemporaryDirectory(prefix="bf-k-", dir="/tmp")
    private = Path(temporary.name)
    server = TargetService(private / "target.sock", target)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        yield queue_config, target, api, private / "target.sock"
    finally:
        api.unblock_create.set()
        server.shutdown()
        server.server_close()
        thread.join()
        temporary.cleanup()


async def until(handle, predicate):
    async with asyncio.timeout(30):
        while True:
            state = await handle.query(KubernetesQueue.snapshot)
            if predicate(state):
                return state
            await asyncio.sleep(0.1)


@pytest.mark.asyncio
async def test_real_activities_fifo_restart_queued_cancel_and_receipt_integrity(target):
    queue_config, target, api, socket = target
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=shutil.which("temporal")
    ) as env:
        producer = KubernetesActivities(socket)
        async with Worker(
            env.client,
            task_queue="producer",
            activities=[producer.execute, producer.close],
        ):
            worker = Worker(
                env.client, task_queue="consumer", workflows=[KubernetesQueue]
            )
            await worker.__aenter__()
            handle = await env.client.start_workflow(
                KubernetesQueue.run,
                {"config": queue_config.model_dump(mode="json")},
                id=queue_config.authority.workflow_id,
                task_queue="consumer",
            )
            try:
                original = await handle.execute_update(
                    KubernetesQueue.admit, admission()
                )
                await handle.execute_update(KubernetesQueue.admit, admission("r2"))
                await handle.execute_update(KubernetesQueue.admit, admission("r3"))
                assert (
                    await handle.execute_update(KubernetesQueue.admit, admission())
                    == original
                )
                cancelled = await handle.execute_update(
                    KubernetesQueue.cancel, cancellation("r3", 1)
                )
                assert (
                    await handle.execute_update(
                        KubernetesQueue.cancel, cancellation("r3", 1)
                    )
                    == cancelled
                )
                state = await until(
                    handle, lambda state: state["rows"]["r1"]["phase"] == "running"
                )
                assert state["rows"]["r2"]["phase"] == "queued"
                assert api.acquisitions == ["r1"]
                await worker.__aexit__(None, None, None)
                worker = Worker(
                    env.client, task_queue="consumer", workflows=[KubernetesQueue]
                )
                await worker.__aenter__()
                await asyncio.sleep(1.2)
                state = await handle.query(KubernetesQueue.snapshot)
                assert state["outstanding_request_id"] == "r1"
                assert api.acquisitions == ["r1"]
                assert (
                    "deletionTimestamp"
                    not in api.objects["/api/v1/namespaces/app/pods/candidate"][
                        "metadata"
                    ]
                )
                revision = state["rows"]["r1"]["revision"]
                assert (
                    await handle.execute_update(
                        KubernetesQueue.complete, completion("r1", revision - 1)
                    )
                )["code"] == "stale_revision"
                message = completion("r1", revision)
                completed = await handle.execute_update(
                    KubernetesQueue.complete, message
                )
                assert (
                    await handle.execute_update(KubernetesQueue.complete, message)
                    == completed
                )
                api.terminated.set()
                second = await until(
                    handle, lambda state: state["rows"]["r2"]["phase"] == "running"
                )
                await handle.execute_update(
                    KubernetesQueue.complete,
                    completion("r2", second["rows"]["r2"]["revision"], "complete-2"),
                )
                state = await until(
                    handle, lambda state: state["rows"]["r2"]["phase"] == "closed"
                )
                assert (
                    await handle.execute_update(KubernetesQueue.complete, message)
                    == completed
                )
                assert api.acquisitions == ["r1", "r2"]
                assert state["rows"]["r3"]["phase"] == "cancelled_before_dispatch"
                assert state["outstanding_request_id"] is None
                payload = state["rows"]["r1"]["payload"]
                from birbverify.kubernetes_contract import KubernetesRequest

                observed = target.inspect(KubernetesRequest.model_validate(payload))
                assert (
                    validate_closure(payload, observed, digest(target.installation))
                    == state["rows"]["r1"]["closure"]
                )
                assert api.objects["/api/v1/namespaces/app/configmaps/revision"][
                    "data"
                ] == {"baseline": "original"}
                for mutation in (
                    "restore",
                    "finalizer",
                    "proof",
                    "uid",
                    "null_operations",
                    "null_response",
                ):
                    changed = copy.deepcopy(observed)
                    if mutation in {"restore", "finalizer"}:
                        operation = (
                            "restore-revision"
                            if mutation == "restore"
                            else "remove-finalizer"
                        )
                        del changed["operations"][operation]
                        del changed["receipt"]["effects"][operation]
                    elif mutation == "proof":
                        changed["terminal_proof"] = changed["receipt"][
                            "terminal_proof"
                        ] = None
                    elif mutation == "uid":
                        changed["pod_uid"] = changed["receipt"]["pod_uid"] = "wrong"
                    elif mutation == "null_operations":
                        changed["operations"] = None
                    else:
                        changed["operations"]["restore-revision"]["response"] = None
                    changed["receipt"]["operations_sha256"] = digest(
                        changed["operations"]
                    )
                    changed["receipt"]["receipt_sha256"] = digest(
                        {
                            key: value
                            for key, value in changed["receipt"].items()
                            if key != "receipt_sha256"
                        }
                    )
                    with pytest.raises((ValueError, TypeError)):
                        validate_closure(payload, changed, digest(target.installation))
                for field in (
                    "candidate_revision",
                    "producer_revision",
                    "policy_revision",
                    "plan_sha256",
                    "target",
                    "request_sha256",
                ):
                    changed = copy.deepcopy(observed)
                    changed["receipt"][field] = "wrong"
                    unsigned = {
                        key: value
                        for key, value in changed["receipt"].items()
                        if key != "receipt_sha256"
                    }
                    changed["receipt"]["receipt_sha256"] = digest(unsigned)
                    with pytest.raises(ValueError):
                        validate_closure(payload, changed, digest(target.installation))
            finally:
                await handle.terminate()
                await worker.__aexit__(None, None, None)


@pytest.mark.asyncio
async def test_active_cancellation_waits_for_real_producer_closure(target):
    queue_config, target, api, socket = target
    api.unblock_create.clear()
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=shutil.which("temporal")
    ) as env:
        producer = KubernetesActivities(socket)
        async with (
            Worker(
                env.client,
                task_queue="producer",
                activities=[producer.execute, producer.close],
            ),
            Worker(
                env.client,
                task_queue="consumer",
                workflows=[KubernetesQueue],
            ),
        ):
            handle = await env.client.start_workflow(
                KubernetesQueue.run,
                {"config": queue_config.model_dump(mode="json")},
                id=queue_config.authority.workflow_id,
                task_queue="consumer",
            )
            try:
                await handle.execute_update(KubernetesQueue.admit, admission())
                await handle.execute_update(KubernetesQueue.admit, admission("r2"))
                assert await asyncio.to_thread(api.created.wait, 10)
                state = await handle.query(KubernetesQueue.snapshot)
                revision = state["rows"]["r1"]["revision"]
                assert (
                    await handle.execute_update(
                        KubernetesQueue.cancel, cancellation("r1", revision - 1)
                    )
                )["code"] == "stale_revision"
                message = cancellation("r1", revision)
                receipt = await handle.execute_update(KubernetesQueue.cancel, message)
                assert (
                    await handle.execute_update(KubernetesQueue.cancel, message)
                    == receipt
                )
                api.unblock_create.set()
                await until(
                    handle, lambda state: state["rows"]["r1"]["phase"] == "closing"
                )
                assert api.acquisitions == ["r1"]
                api.terminated.set()
                second = await until(
                    handle, lambda state: state["rows"]["r2"]["phase"] == "running"
                )
                await handle.execute_update(
                    KubernetesQueue.complete,
                    completion("r2", second["rows"]["r2"]["revision"], "complete-2"),
                )
                state = await until(
                    handle, lambda state: state["rows"]["r2"]["phase"] == "closed"
                )
                assert state["rows"]["r1"]["cancellation"] == "acknowledged"
                assert state["rows"]["r1"]["closure"]["reason"] == "cancelled"
                assert api.acquisitions == ["r1", "r2"]
            finally:
                api.unblock_create.set()
                await handle.terminate()


@pytest.mark.asyncio
async def test_killed_activity_worker_cannot_release_or_repeat_acquisition(target):
    import sys

    queue_config, target, api, socket = target
    queue_config = queue_config.model_copy(update={"continue_threshold": 100})
    api.unblock_create.clear()
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=shutil.which("temporal")
    ) as env:
        process = await asyncio.create_subprocess_exec(
            *[
                sys.executable,
                "-m",
                "birbverify.kubernetes_worker",
                "--address",
                env.client.service_client.config.target_host,
                "--queue",
                "producer",
                "--socket",
                str(socket),
            ],
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        async with Worker(
            env.client, task_queue="consumer", workflows=[KubernetesQueue]
        ):
            handle = await env.client.start_workflow(
                KubernetesQueue.run,
                {"config": queue_config.model_dump(mode="json")},
                id=queue_config.authority.workflow_id,
                task_queue="consumer",
            )
            try:
                await handle.execute_update(KubernetesQueue.admit, admission())
                await handle.execute_update(KubernetesQueue.admit, admission("r2"))
                assert await asyncio.to_thread(api.created.wait, 10)
                process.kill()
                await asyncio.wait_for(process.wait(), 10)
                state = await until(
                    handle, lambda state: state["rows"]["r1"]["phase"] == "closing"
                )
                assert state["outstanding_request_id"] == "r1"
                assert state["rows"]["r2"]["phase"] == "queued"
                assert api.acquisitions == ["r1"]
                api.unblock_create.set()
                producer = KubernetesActivities(socket)
                async with Worker(
                    env.client,
                    task_queue="producer",
                    activities=[producer.execute, producer.close],
                ):
                    await asyncio.sleep(1)
                    assert api.acquisitions == ["r1"]
                    api.terminated.set()
                    second = await until(
                        handle, lambda state: state["rows"]["r2"]["phase"] == "running"
                    )
                    await handle.execute_update(
                        KubernetesQueue.complete,
                        completion(
                            "r2", second["rows"]["r2"]["revision"], "complete-2"
                        ),
                    )
                    state = await until(
                        handle, lambda state: state["rows"]["r2"]["phase"] == "closed"
                    )
                    assert state["rows"]["r1"]["closure"]["reason"] == "worker_lost"
                    assert api.acquisitions == ["r1", "r2"]
                    history = await handle.fetch_history()
                    scheduled = [
                        event.activity_task_scheduled_event_attributes.activity_id
                        for event in history.events
                        if event.HasField("activity_task_scheduled_event_attributes")
                    ]
                    assert scheduled.count("r1") == 1
            finally:
                api.unblock_create.set()
                if process.returncode is None:
                    process.kill()
                    await asyncio.wait_for(process.wait(), 10)
                await handle.terminate()


@pytest.mark.asyncio
async def test_running_deadline_closes_without_completion(target):
    queue_config, target, api, socket = target
    queue_config = queue_config.model_copy(update={"request_timeout_seconds": 10})
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=shutil.which("temporal")
    ) as env:
        producer = KubernetesActivities(socket)
        async with (
            Worker(
                env.client,
                task_queue="producer",
                activities=[producer.execute, producer.close],
            ),
            Worker(env.client, task_queue="consumer", workflows=[KubernetesQueue]),
        ):
            handle = await env.client.start_workflow(
                KubernetesQueue.run,
                {"config": queue_config.model_dump(mode="json")},
                id=queue_config.authority.workflow_id,
                task_queue="consumer",
            )
            try:
                await handle.execute_update(KubernetesQueue.admit, admission())
                state = await until(
                    handle, lambda state: state["rows"]["r1"]["phase"] == "running"
                )
                assert state["rows"]["r1"]["closure_reason"] is None
                api.terminated.set()
                state = await until(
                    handle, lambda state: state["rows"]["r1"]["phase"] == "closed"
                )
                row = state["rows"]["r1"]
                assert row["closure_trigger"] == "deadline"
                assert (
                    row["closure_reason"] == row["closure"]["reason"] == "worker_lost"
                )
                assert state["outstanding_request_id"] is None
            finally:
                await handle.terminate()
