import asyncio
import copy
import tempfile
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

pytest.importorskip("birbverify.kubernetes_worker")

from birbverify.contract import digest
from birbverify.kubernetes_contract import KubernetesInstallation
from birbverify.kubernetes_service import TargetService
from birbverify.kubernetes_target import KubernetesTarget
from birbverify.kubernetes_worker import KubernetesActivities
from kubernetes_helpers import admission, cancellation, completion, config, until
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

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


@pytest.mark.asyncio
async def test_real_activities_fifo_restart_queued_cancel_and_receipt_integrity(
    target, temporal_cli
):
    queue_config, target, api, socket = target
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=temporal_cli
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
                    "oversized_proof",
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
                    elif mutation == "oversized_proof":
                        changed["terminal_proof"]["message"] = "x" * 8192
                        changed["receipt"]["terminal_proof"] = copy.deepcopy(
                            changed["terminal_proof"]
                        )
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
async def test_active_cancellation_waits_for_real_producer_closure(
    target, temporal_cli
):
    queue_config, target, api, socket = target
    api.unblock_create.clear()
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=temporal_cli
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
async def test_killed_activity_worker_cannot_release_or_repeat_acquisition(
    target, temporal_cli
):
    import sys

    queue_config, target, api, socket = target
    queue_config = queue_config.model_copy(update={"continue_threshold": 100})
    api.unblock_create.clear()
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=temporal_cli
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
                assert state["rows"]["r1"]["observation_error"] == "execution_unknown"
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
async def test_running_deadline_closes_without_completion(target, temporal_cli):
    queue_config, target, api, socket = target
    queue_config = queue_config.model_copy(
        update={"request_timeout_seconds": 10, "activity_timeout_seconds": 5}
    )
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=temporal_cli
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
                assert state["rows"]["r1"]["closure_trigger"] is None
                api.terminated.set()
                state = await until(
                    handle, lambda state: state["rows"]["r1"]["phase"] == "closed"
                )
                row = state["rows"]["r1"]
                assert row["closure_trigger"] == "deadline"
                assert row["closure"]["reason"] == "worker_lost"
                assert state["outstanding_request_id"] is None
            finally:
                await handle.terminate()


def queued_state(queue_config, monkeypatch):
    with monkeypatch.context() as patch:
        patch.setattr(
            "verification.kubernetes_workflow.workflow.now", lambda: datetime.now(UTC)
        )
        queue = KubernetesQueue({"config": queue_config.model_dump(mode="json")})
        assert queue.admit(admission())["ok"]
        return queue.snapshot()


@pytest.mark.asyncio
async def test_near_deadline_head_expires_without_scheduling_activity(
    target, temporal_cli, monkeypatch
):
    queue_config, _, api, _ = target
    queue_config = queue_config.model_copy(
        update={"request_timeout_seconds": 10, "activity_timeout_seconds": 5}
    )
    state = queued_state(queue_config, monkeypatch)
    state["rows"]["r1"]["payload"]["deadline"] = (
        datetime.now(UTC) + timedelta(seconds=3)
    ).isoformat()
    async with (
        await WorkflowEnvironment.start_local(
            dev_server_existing_path=temporal_cli
        ) as env,
        Worker(env.client, task_queue="consumer", workflows=[KubernetesQueue]),
    ):
        handle = await env.client.start_workflow(
            KubernetesQueue.run,
            {"config": queue_config.model_dump(mode="json"), "state": state},
            id=queue_config.authority.workflow_id,
            task_queue="consumer",
        )
        try:
            expired = await until(
                handle, lambda state: state["rows"]["r1"]["phase"] == "expired"
            )
            assert expired["outstanding_request_id"] is None
            assert api.acquisitions == []
            history = await handle.fetch_history()
            assert not any(
                event.HasField("activity_task_scheduled_event_attributes")
                for event in history.events
            )
        finally:
            await handle.terminate()


@pytest.mark.asyncio
async def test_idle_queue_does_not_schedule_timers_or_continue_as_new(temporal_cli):
    queue_config = config().model_copy(update={"continue_threshold": 2})
    async with (
        await WorkflowEnvironment.start_local(
            dev_server_existing_path=temporal_cli
        ) as env,
        Worker(env.client, task_queue="consumer", workflows=[KubernetesQueue]),
    ):
        handle = await env.client.start_workflow(
            KubernetesQueue.run,
            {"config": queue_config.model_dump(mode="json")},
            id=queue_config.authority.workflow_id,
            task_queue="consumer",
        )
        try:
            await handle.query(KubernetesQueue.snapshot)
            initial_run = (await handle.describe()).run_id
            await asyncio.sleep(3)
            assert (await handle.describe()).run_id == initial_run
            history = await handle.fetch_history()
            assert not any(
                event.HasField("timer_started_event_attributes")
                for event in history.events
            )
            assert not any(
                event.HasField("workflow_execution_continued_as_new_event_attributes")
                for event in history.events
            )
        finally:
            await handle.terminate()


@pytest.mark.parametrize("producer_state", ["sealed_unadmitted", "quarantined"])
@pytest.mark.asyncio
async def test_terminal_retention_stops_closure_polling(
    target, temporal_cli, monkeypatch, producer_state
):
    from birbverify.kubernetes_contract import KubernetesRequest

    queue_config, target, api, socket = target
    queue_config = queue_config.model_copy(update={"continue_threshold": 100})
    state = queued_state(queue_config, monkeypatch)
    row = state["rows"]["r1"]
    request = KubernetesRequest.model_validate(row["payload"])
    if producer_state == "sealed_unadmitted":
        observed = target.close(request, "worker_lost")
    else:
        target.begin(request)
        api.objects["/api/v1/namespaces/app"]["metadata"]["uid"] = "replacement"
        observed = target.execute(request)
    assert observed["state"] == producer_state
    row.update(
        phase="closing",
        activity_outcome="unknown",
        closure_trigger="execution_unknown",
    )
    state["outstanding_request_id"] = "r1"
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=temporal_cli
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
                {"config": queue_config.model_dump(mode="json"), "state": state},
                id=queue_config.authority.workflow_id,
                task_queue="consumer",
            )
            try:
                retained = await until(
                    handle, lambda state: state["rows"]["r1"]["phase"] == "retained"
                )
                assert (
                    retained["rows"]["r1"]["observation_error"]
                    == "producer_" + producer_state
                )
                await handle.execute_update(KubernetesQueue.admit, admission("r2"))
                await asyncio.sleep(3)
                parked = await handle.query(KubernetesQueue.snapshot)
                assert parked["outstanding_request_id"] == "r1"
                assert parked["rows"]["r2"]["phase"] == "queued"
                history = await handle.fetch_history()
                activities = [
                    event.activity_task_scheduled_event_attributes.activity_type.name
                    for event in history.events
                    if event.HasField("activity_task_scheduled_event_attributes")
                ]
                assert activities == ["birbverify_kubernetes_close"]
                assert api.acquisitions == []
            finally:
                await handle.terminate()


@pytest.mark.asyncio
async def test_quarantined_execute_never_projects_running(
    target, temporal_cli, monkeypatch
):
    queue_config, target, api, socket = target
    request = api.request

    def changed_admitted_image(method, path, body=None):
        response = request(method, path, body)
        if method == "POST":
            response["spec"]["containers"][0]["image"] = "unapproved/image"
        return response

    monkeypatch.setattr(api, "request", changed_admitted_image)
    async with await WorkflowEnvironment.start_local(
        dev_server_existing_path=temporal_cli
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
                async with asyncio.timeout(10):
                    while True:
                        state = await handle.query(KubernetesQueue.snapshot)
                        row = state["rows"]["r1"]
                        assert row["phase"] != "running"
                        if row["phase"] == "retained":
                            break
                        await asyncio.sleep(0.05)
                assert row["observation_error"] == "producer_quarantined"
                assert state["outstanding_request_id"] == "r1"
                assert state["rows"]["r2"]["phase"] == "queued"
                assert api.acquisitions == ["r1"]
                assert (
                    await handle.execute_update(
                        KubernetesQueue.complete, completion("r1", row["revision"])
                    )
                )["code"] == "request_not_running"
            finally:
                await handle.terminate()
