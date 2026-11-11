import asyncio
from datetime import UTC, datetime, timedelta

import pytest

pytest.importorskip("birbverify.kubernetes_worker")

from birbverify.contract import digest
from kubernetes_helpers import admission, cancellation, config, until
from temporalio import activity
from temporalio.exceptions import ApplicationError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from verification.kubernetes import (
    DeploymentQueueProfile,
    KubernetesConfig,
    check_installation,
)
from verification.kubernetes_workflow import KubernetesQueue


def queue_config():
    return config().model_copy(
        update={
            "deployment": DeploymentQueueProfile(
                request_id="r1",
                request_sha256="d" * 64,
                activity_installation_sha256="e" * 64,
                producer_package_sha256="e" * 64,
                ownership_server_cert_sha256="e" * 64,
                epoch="e1",
                deadline=datetime.now(UTC) + timedelta(minutes=5),
                verifier_task_queue="verifier",
            ),
            "continue_threshold": 2,
        }
    )


class Producer:
    def __init__(self, config, mode):
        self.config = config
        self.profile = config.deployment
        self.mode = mode
        self.dispatched = []
        self.sealed = []
        self.persisted = None
        self.release_lookup = False
        self.observe_started = asyncio.Event()
        self.allow_observe = asyncio.Event()
        self.cancel_delay = asyncio.Event()

    @activity.defn(name="birbforge_deployment_observe_v1")
    async def observe(self, invocation: dict) -> dict:
        assert invocation == self.profile.invocation
        self.observe_started.set()
        if self.mode == "cancel_before_dispatch":
            await self.allow_observe.wait()
        return {"state": "active"}

    @activity.defn(name="birbverify_deployment_account_auth_v1")
    async def execute(self, invocation: dict) -> dict:
        assert invocation == self.profile.invocation
        self.dispatched.append(activity.info().activity_id)
        body = {
            "invocation": invocation,
            "operation_id": self.profile.operation_id,
            "outcome": "passed",
        }
        self.persisted = dict(body, result_sha256=digest(body))
        if self.mode == "cancel_in_flight":
            while not self.cancel_delay.is_set():
                activity.heartbeat()
                await asyncio.sleep(0.1)
        if self.mode in ("reply_lost", "pending_after_loss"):
            raise ApplicationError("reply_lost", non_retryable=True)
        return {"caller_supplied_pass": True}

    @activity.defn(name="birbforge_deployment_result_v1")
    async def result(self, invocation: dict) -> dict:
        assert invocation == self.profile.invocation
        if self.mode == "pending_after_loss" and not self.release_lookup:
            return {"status": "pending"}
        if self.persisted is None:
            return {"status": "absent"}
        return {"status": "recorded", "result": self.persisted}

    @activity.defn(name="birbforge_deployment_close_v1")
    async def close(self, command: dict) -> dict:
        self.sealed.append(command)
        return {
            **command,
            "schema_version": "birbverify.deployment.closure.progress.v1",
            "installation_sha256": self.config.authority.installation_sha256,
            "cluster_uid": self.config.authority.target.cluster_uid,
            "namespace_uid": self.config.authority.target.namespace_uid,
            "state": "sealed",
            "release_authorized": self.mode == "invalid_closure",
            "account_activity_state": "passed" if self.persisted else "absent",
        }

    def coordinator(self, env):
        return Worker(
            env.client,
            task_queue="consumer",
            workflows=[KubernetesQueue],
            activities=[self.observe, self.result, self.close],
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode",
    [
        "reply_lost",
        "cancel_before_dispatch",
        "cancel_in_flight",
        "invalid_closure",
        "pending_after_loss",
        "normal",
    ],
)
async def test_durable_result_under_one_fifo_owner(temporal_cli, mode):
    installed = queue_config()
    profile = installed.deployment
    producer = Producer(installed, mode)
    async with (
        await WorkflowEnvironment.start_local(
            dev_server_existing_path=temporal_cli
        ) as env,
        Worker(env.client, task_queue="verifier", activities=[producer.execute]),
    ):
        async with producer.coordinator(env):
            handle = await env.client.start_workflow(
                KubernetesQueue.run,
                {"config": installed.model_dump(mode="json")},
                id=installed.authority.workflow_id,
                task_queue="consumer",
            )
            first_run = (await handle.describe()).run_id
            query = KubernetesQueue.deployment_evidence_v1
            assert await handle.query(query, profile.invocation) is None
            assert (await handle.execute_update(KubernetesQueue.admit, admission()))[
                "ok"
            ]
            await asyncio.wait_for(producer.observe_started.wait(), 20)
            if mode in ("cancel_before_dispatch", "cancel_in_flight"):
                if mode == "cancel_in_flight":
                    async with asyncio.timeout(20):
                        while not producer.dispatched:
                            await asyncio.sleep(0.05)
                state = await handle.query(KubernetesQueue.snapshot)
                revision = state["rows"]["r1"]["revision"]
                assert (
                    await handle.execute_update(
                        KubernetesQueue.cancel, cancellation("r1", revision)
                    )
                )["ok"]
                producer.allow_observe.set()
                producer.cancel_delay.set()
            invalid_closure = mode == "invalid_closure"
            state = await until(
                handle,
                lambda state: (
                    state["rows"]["r1"]["observation_error"]
                    == "deployment_closure_unconfirmed"
                    if invalid_closure
                    else state["rows"]["r1"]["phase"] == "retained"
                ),
            )
            assert state["outstanding_request_id"] == "r1"
            assert (await handle.describe()).run_id != first_run
            assert (
                await handle.execute_update(KubernetesQueue.admit, admission("r2"))
            )["code"] == "request_not_installed"
            if mode == "pending_after_loss":
                assert state["rows"]["r1"]["deployment"]["result"] is None
            receipt = await handle.query(query, profile.invocation)
            assert receipt["eligible"] is False
            assert (receipt["seal_observation_sha256"] is None) == invalid_closure
            assert (
                await handle.query(query, dict(profile.invocation, epoch="e2")) is None
            )

        producer.release_lookup = True
        async with producer.coordinator(env):
            if mode == "pending_after_loss":
                await until(
                    handle,
                    lambda state: (
                        state["rows"]["r1"]["deployment"]["result"] is not None
                    ),
                )
            recovered = await handle.query(query, profile.invocation)
            if mode == "cancel_before_dispatch":
                assert producer.dispatched == []
                assert recovered["result_sha256"] is None
            else:
                assert producer.dispatched == [profile.operation_id]
                assert recovered["result_sha256"] == producer.persisted["result_sha256"]
            assert recovered["operation_id"] == profile.operation_id
            assert (
                recovered["seal_observation_sha256"]
                == receipt["seal_observation_sha256"]
            )
            reason = "completed"
            if mode.startswith("cancel_"):
                reason = "cancelled"
            if mode == "pending_after_loss":
                reason = "worker_lost"
            assert producer.sealed[0] == dict(profile.invocation, reason=reason)
            await handle.terminate()


def test_deployment_installation_transition_rejected():
    queue = queue_config()
    installed = {
        "config": queue.model_dump(mode="json"),
        "workflow_task_queue": "consumer",
    }
    changed = queue.model_copy(
        update={"deployment": queue.deployment.model_copy(update={"epoch": "e2"})}
    )
    config = KubernetesConfig(
        queue=changed, workflow_task_queue="consumer", temporal_address="localhost"
    )
    with pytest.raises(ValueError, match="running_installation_mismatch"):
        check_installation(config, installed)
