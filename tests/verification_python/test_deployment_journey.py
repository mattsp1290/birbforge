"""Exercise the producer journal and Birbforge processes on a disposable Temporal server."""

import asyncio
import json
import os
import runpy
import ssl
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Thread

import pytest

pytest.importorskip("birbverify.kubernetes_contract")

from birbverify.contract import digest
from kubernetes_helpers import admission
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from verification.deployment_runtime import producer_package_sha256
from verification.kubernetes import KubernetesAuthority, KubernetesConfig
from verification.kubernetes_workflow import KubernetesQueue
from verification.temporal_transport import connect


@asynccontextmanager
async def tls_frontend(address, pki):
    # The local Temporal CLI serves plaintext gRPC. Terminate mutual TLS on loopback.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.set_alpn_protocols(["h2"])
    context.load_cert_chain(pki / "server.crt", pki / "server.key")
    context.load_verify_locations(pki / "ca.crt")
    context.verify_mode = ssl.CERT_REQUIRED

    async def pipe(reader, writer):
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()

    connections = set()

    async def forward(reader, writer):
        connections.add(writer)
        host, port = address.rsplit(":", 1)
        remote, upstream = await asyncio.open_connection(host, int(port))
        try:
            tasks = [
                asyncio.create_task(pipe(reader, upstream)),
                asyncio.create_task(pipe(remote, writer)),
            ]
            done, pending = await asyncio.wait(
                tasks, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*done, *pending, return_exceptions=True)
        finally:
            upstream.close()
            writer.close()
            connections.discard(writer)

    async with await asyncio.start_server(
        forward, "127.0.0.1", 0, ssl=context
    ) as server:
        try:
            yield f"127.0.0.1:{server.sockets[0].getsockname()[1]}"
        finally:
            for writer in connections:
                writer.close()


async def cli(module, path):
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", module, str(path), stdout=asyncio.subprocess.PIPE
    )
    stdout, _ = await proc.communicate()
    return proc.returncode, json.loads(stdout)


@pytest.fixture
def compose_app(monkeypatch, mode):
    repository = os.environ.get("BIRBPARTY_SOURCE")
    if not repository:
        yield None
        return
    if not os.environ.get("BIRBVERIFY_SOURCE") or not os.environ.get("TEMPORAL_CLI"):
        pytest.fail("BIRBPARTY_SOURCE requires BIRBVERIFY_SOURCE and TEMPORAL_CLI")
    from deployment_compose import start_app

    monkeypatch.syspath_prepend(str(Path(os.environ["BIRBVERIFY_SOURCE"]) / "fixtures"))
    with start_app(Path(repository), expected_sessions=int(mode == "normal")) as app:
        yield app


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode",
    ["normal", "reply_loss"] if os.environ.get("BIRBPARTY_SOURCE") else ["normal"],
)
async def test_producer_result_through_coordinator_and_reader(
    tmp_path, monkeypatch, compose_app, mode
):
    source_path = os.environ.get("BIRBVERIFY_SOURCE")
    temporal = os.environ.get("TEMPORAL_CLI")
    if not source_path or not temporal:
        pytest.skip(
            "set BIRBVERIFY_SOURCE to the aftl checkout and TEMPORAL_CLI to the local server binary"
        )
    source = Path(source_path)
    from birbverify import deployment_activity
    from birbverify.deployment_activity import AccountActivity
    from birbverify.deployment_activity_contract import ActivityInstallation
    from birbverify.deployment_http import server_context
    from birbverify.deployment_ownership_server import OwnershipServer

    assert Path(deployment_activity.__file__).resolve().is_relative_to(source.resolve())
    monkeypatch.syspath_prepend(str(source / "tests"))
    ownership = runpy.run_path(str(source / "tests/test_deployment_ownership.py"))
    fixture = runpy.run_path(str(source / "tests/test_deployment_activity.py"))
    pki = tmp_path / "tls"
    runpy.run_path(str(source / "fixtures/deployment_audit_pki.py"))["create"](
        pki, "localhost"
    )

    def cert_pin(leaf):
        return digest(ssl.PEM_cert_to_DER_cert((pki / (leaf + ".crt")).read_text()))

    install = fixture["installation"]().model_dump(mode="json")
    request = install["request"]
    revision = (
        await asyncio.to_thread(
            subprocess.check_output,
            ["git", "-C", source, "rev-parse", "HEAD"],
            text=True,
        )
    ).strip()
    request["producer_revision"] = install["profile"]["verifier_revision"] = revision
    if compose_app:
        request["candidate_revision"] = compose_app.revision
    pod_requests = []
    for pod in install["pods"]:
        req = ownership["request"]("review-" + pod["workload"])
        req["kind"]["kind"] = "Pod"
        req["resource"]["resource"] = "pods"
        req["name"] = pod["name"]
        req["object"] = {
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {"name": pod["name"], "namespace": "app"},
            "spec": {
                "containers": [
                    {"name": "app", "image": request["images"]["api"]["reference"]}
                ]
            },
        }
        pod["uid"] = "uid-" + req["name"]
        pod_requests.append(req)
    journal = ownership["install"](
        tmp_path / "journal.sqlite",
        [ownership["slot"](r["name"], r) for r in pod_requests],
        closure_client_sha256=cert_pin("unassigned"),
        admission_client_sha256=cert_pin("apiserver"),
    )
    request["installation_sha256"] = journal.installation_sha256
    request["target"].update(namespace="app", namespace_uid="ns-uid")
    authority = KubernetesAuthority(
        **{
            k: request[k]
            for k in (
                "target",
                "candidate_revision",
                "authored_revision",
                "producer_revision",
                "policy_revision",
                "plan_sha256",
                "installation_sha256",
                "beans_issue",
            )
        },
        image=request["images"]["api"]["reference"],
    )
    request["workflow_id"] = authority.workflow_id
    ca_sha = digest((pki / "ca.crt").read_bytes())
    install["profile"].update(
        temporal_server_ca_sha256=ca_sha,
        temporal_namespace="default",
        worker_cert_sha256=cert_pin("apiserver"),
    )
    install["webhook_name"] = journal.webhook_name
    installed = ActivityInstallation.model_validate(install)
    sha = digest(installed.request)
    identity = installed.request.request_id
    epoch = journal.begin(identity, sha)["epoch"]
    for req in pod_requests:
        assert journal.admit(epoch, req)["allowed"]
        ownership["batch"](journal, epoch, req)
    target = fixture["Target"](installed)
    if compose_app:
        from birbverify.deployment_activity_runtime import LocalPodConnection

        connection = LocalPodConnection(compose_app.port)

        def app_request(method, path, *args, **kwargs):
            status, response = connection.request(method, path, *args, **kwargs)
            if mode == "reply_loss" and (method, path, status) == (
                "POST",
                "/users",
                201,
            ):
                raise TimeoutError("registration committed before the reply was lost")
            return status, response

        target.request = app_request
    read_fixture = target.api.request

    def read_namespace(method, path):
        if path == "/api/v1/namespaces/app":
            return {"metadata": {"uid": journal.policy.namespace_uid}}
        return read_fixture(method, path)

    target.api.request = read_namespace
    for pod in target.api.pods:
        pod["metadata"]["namespace"] = "app"
        for statuses in ("containerStatuses", "initContainerStatuses"):
            for status in pod["status"][statuses]:
                status["containerID"] = "containerd://" + digest(
                    (pod["metadata"]["uid"] + "/" + status["name"]).encode()
                )
    service = AccountActivity(installed, journal, target)
    (tmp_path / "activity.json").write_text(installed.model_dump_json())
    tls = server_context(pki / "ca.crt", pki / "server.crt", pki / "server.key")
    with OwnershipServer(("localhost", 0), tls, journal, identity, sha) as owner:
        thread = Thread(target=owner.serve_forever)
        thread.start()
        try:
            async with (
                await WorkflowEnvironment.start_local(
                    dev_server_existing_path=temporal
                ) as env,
                tls_frontend(
                    env.client.service_client.config.target_host, pki
                ) as address,
            ):
                cfg = KubernetesConfig.model_validate(
                    {
                        "queue": {
                            "authority": authority,
                            "activity_task_queue": "unused",
                            "deployment": {
                                "request_id": identity,
                                "request_sha256": sha,
                                "epoch": epoch,
                                "deadline": request["deadline"],
                                "activity_installation_sha256": digest(installed),
                                "producer_package_sha256": producer_package_sha256(),
                                "ownership_server_cert_sha256": cert_pin("server"),
                                "verifier_task_queue": installed.profile.task_queue,
                            },
                        },
                        "workflow_task_queue": "coordinator",
                        "temporal_address": address,
                        "temporal_tls": {
                            "server_name": "localhost",
                            "server_ca": pki / "ca.crt",
                            "server_ca_sha256": ca_sha,
                            "client_key": pki / "unassigned.key",
                            "client_cert": pki / "unassigned.crt",
                        },
                        "deployment_runtime": {
                            "activity_installation": tmp_path / "activity.json",
                            "ownership": {
                                "host": "localhost",
                                "port": owner.server_port,
                                "server_ca": pki / "ca.crt",
                                "server_cert_sha256": cert_pin("server"),
                                "client_cert": pki / "unassigned.crt",
                                "client_key": pki / "unassigned.key",
                            },
                        },
                    }
                )
                receipt = await drive(
                    cfg,
                    service,
                    tmp_path,
                    expected_outcome="unknown" if mode == "reply_loss" else "passed",
                )
                if compose_app:
                    receipt.update(
                        app_source_revision=compose_app.revision,
                        compose_images=compose_app.images,
                        scenario=mode,
                        workload_observation="synthetic Kubernetes API",
                    )
                    (tmp_path / "deployment-receipt.json").write_text(
                        json.dumps(receipt, indent=2, sort_keys=True) + "\n"
                    )
                else:
                    assert len(target.created) == 1
        finally:
            owner.shutdown()
            thread.join()


async def drive(cfg, service, root, expected_outcome):
    config_path = root / "coordinator.json"
    config_path.write_text(cfg.model_dump_json())
    reader = root / "reader.json"
    reader.write_text(cfg.model_dump_json(exclude={"deployment_runtime"}))
    client = await connect(cfg)
    handle = client.get_workflow_handle(cfg.queue.authority.workflow_id)
    profile = cfg.queue.deployment
    verifier_tls = cfg.temporal_tls.model_copy(
        update={
            "client_key": root / "tls/apiserver.key",
            "client_cert": root / "tls/apiserver.crt",
        }
    )
    verifier = await connect(cfg.model_copy(update={"temporal_tls": verifier_tls}))
    async with Worker(
        verifier, task_queue=profile.verifier_task_queue, activities=[service.run]
    ):
        proc = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "verification.kubernetes_worker", str(config_path)
        )
        try:
            async with asyncio.timeout(45):
                from temporalio.service import RPCError, RPCStatusCode

                while True:
                    try:
                        await handle.describe()
                        break
                    except RPCError as exc:
                        if (
                            exc.status != RPCStatusCode.NOT_FOUND
                            or proc.returncode is not None
                        ):
                            raise
                        await asyncio.sleep(0.1)
                command = admission(
                    profile.request_id,
                    beans_issue=cfg.queue.authority.beans_issue,
                    authored_revision=cfg.queue.authority.authored_revision,
                    candidate_revision=cfg.queue.authority.candidate_revision,
                    approved_plan_sha256=cfg.queue.authority.plan_sha256,
                )
                admitted = await handle.execute_update(KubernetesQueue.admit, command)
                assert admitted["ok"]
                while True:
                    state = await handle.query(KubernetesQueue.snapshot)
                    row = state["rows"][profile.request_id]
                    if row["phase"] == "retained":
                        break
                    await asyncio.sleep(0.1)
                result = row["deployment"]["result"]
                progress = row["deployment"]["seal_observation"]
                assert state["outstanding_request_id"] == profile.request_id
                assert (
                    result["outcome"]
                    == progress["account_activity_state"]
                    == expected_outcome
                )
                assert set(result["assertions"].values()) == {expected_outcome}
                assert progress["release_authorized"] is False
                code, exported = await cli("verification.deployment_export", reader)
                assert code == 1 and exported["eligible"] is False
                assert exported["operation_id"] == profile.operation_id
                assert exported["result_sha256"] == result["result_sha256"]
                assert exported["seal_observation_sha256"] == digest(progress)
                assert (
                    await handle.execute_update(KubernetesQueue.admit, command)
                    == admitted
                )
                assert await cli("verification.deployment_export", reader) == (
                    code,
                    exported,
                )
                return {
                    "request": service.installation.request.model_dump(mode="json"),
                    "activity_installation_sha256": profile.activity_installation_sha256,
                    "producer_package_sha256": profile.producer_package_sha256,
                    "result": result,
                    "seal_observation": progress,
                    "export": exported,
                }
        finally:
            if proc.returncode is None:
                proc.terminate()
            await proc.wait()
