import copy
import ssl
import subprocess
import sys
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Thread

import pytest

producer = pytest.importorskip("birbverify.deployment_activity_contract")

from birbverify.contract import digest
from birbverify.deployment_http import server_context
from birbverify.deployment_journal import Journal
from birbverify.deployment_ownership import OwnershipJournal, OwnershipPolicy
from birbverify.deployment_ownership_server import OwnershipServer
from temporalio.exceptions import ApplicationError
from temporalio.testing import ActivityEnvironment

from verification.deployment_activities import DeploymentActivities
from verification.ownership_tls import OwnershipTLS


@pytest.fixture(scope="module")
def pki(tmp_path_factory):
    from os import environ

    source = Path(
        environ.get("BIRBVERIFY_SOURCE", Path(producer.__file__).resolve().parents[2])
    )
    fixture = source / "fixtures/deployment_audit_pki.py"
    if not fixture.is_file():
        pytest.skip(
            "set BIRBVERIFY_SOURCE to the producer checkout containing the test PKI"
        )
    directory = tmp_path_factory.mktemp("ownership-pki")
    subprocess.run(
        [sys.executable, str(fixture), str(directory), "localhost"],
        stdout=subprocess.DEVNULL,
        check=True,
    )
    return directory


def cert_digest(pki, name):
    return digest(ssl.PEM_cert_to_DER_cert((pki / (name + ".crt")).read_text()))


@pytest.fixture
def client(tmp_path, pki):
    sha = "0" * 64
    rev = "1" * 40
    policy = OwnershipPolicy(
        schema_version="birbverify.deployment.ownership.v1",
        cluster_uid="cluster",
        namespace="fixture",
        namespace_uid="ns",
        webhook_name="test.example",
        admission_client_sha256=cert_digest(pki, "apiserver"),
        closure_client_sha256=cert_digest(pki, "unassigned"),
        audit_client_sha256=sha,
        rules=[
            {
                "slot": "config",
                "kind": "ConfigMap",
                "name": "config",
                "principal_sha256": sha,
                "object_sha256": sha,
            }
        ],
    )
    journal_path = tmp_path / "ownership.db"
    policy_sha = digest(policy.model_dump(mode="json", exclude_none=True))
    Journal(
        journal_path, policy_sha, policy.webhook_name, policy.namespace
    ).bind_audit_source(policy.cluster_uid, policy.audit_client_sha256)
    journal = OwnershipJournal(journal_path, policy)
    pods = [
        {
            "workload": w,
            "name": w,
            "uid": w,
            "controller_uid": w + "-owner",
            "node_name": "node",
            "node_uid": "node-uid",
        }
        for w in ("api", "ui", "openfga", "application-postgres", "openfga-postgres")
    ]
    installation = producer.ActivityInstallation(
        schema_version="birbverify.deployment.account-auth.installation.v1",
        request={
            "schema_version": "birbverify.deployment.account-auth.request.v1",
            "request_id": "request",
            "workflow_id": "workflow",
            "repository": "birbparty/birbparty",
            "candidate_revision": rev,
            "authored_revision": rev,
            "beans_issue": "fixture-1",
            "producer_revision": rev,
            "policy_revision": rev,
            "plan_sha256": sha,
            "installation_sha256": policy_sha,
            "target": {
                "target_id": "fixture",
                "cluster_uid": policy.cluster_uid,
                "namespace": policy.namespace,
                "namespace_uid": policy.namespace_uid,
            },
            "artifacts": {
                "data_chart_sha256": sha,
                "application_chart_sha256": sha,
                "openfga_chart_sha256": sha,
                "render_sha256": sha,
            },
            "images": {
                role: {
                    "reference": f"{role}@sha256:{sha}",
                    "platform_manifest": f"sha256:{sha}",
                    "config_digest": f"sha256:{sha}",
                }
                for role in ("api", "ui", "openfga", "busybox", "postgres")
            },
            "deadline": datetime.now(UTC) + timedelta(hours=1),
        },
        profile={
            "verifier_identity": "verifier",
            "reviewer_identity": "reviewer",
            "verifier_revision": rev,
            "suite_sha256": sha,
            "worker_cert_sha256": sha,
            "temporal_server_ca_sha256": sha,
            "temporal_namespace": "private",
            "task_queue": "verifier",
        },
        pods=pods,
        api_port=3000,
        webhook_name=policy.webhook_name,
    )
    request = installation.request
    epoch = journal.begin(request.request_id, digest(request))["epoch"]
    context = server_context(pki / "ca.crt", pki / "server.crt", pki / "server.key")
    with OwnershipServer(
        ("localhost", 0), context, journal, request.request_id, digest(request)
    ) as server:
        thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        try:
            transport = OwnershipTLS(
                host="localhost",
                port=server.server_port,
                server_ca=pki / "ca.crt",
                server_cert_sha256=cert_digest(pki, "server"),
                client_cert=pki / "unassigned.crt",
                client_key=pki / "unassigned.key",
            )
            yield DeploymentActivities(installation, epoch, transport)
        finally:
            server.shutdown()
            thread.join()


@pytest.mark.asyncio
async def test_authenticated_owner_and_result_lookup_before_and_after_seal(client, pki):
    env = ActivityEnvironment()
    env.info = replace(env.info, workflow_id=client.installation.request.workflow_id)
    invocation = client.invocation
    command = invocation | {"reason": "cancelled"}
    assert await env.run(client.observe, invocation) == {"state": "active"}
    assert await env.run(client.result, invocation) == {"status": "absent"}

    for change in (
        {"server_cert_sha256": "0" * 64},
        {"host": "127.0.0.1"},
        {"client_cert": pki / "apiserver.crt", "client_key": pki / "apiserver.key"},
    ):
        invalid = DeploymentActivities(
            client.installation,
            invocation["epoch"],
            client.transport.model_copy(update=change),
        )
        with pytest.raises(
            ApplicationError, match="deployment_observation_unavailable"
        ):
            await env.run(invalid.close, command)

    with pytest.raises(ApplicationError):
        await env.run(client.close, command | {"epoch": "other"})
    other = ActivityEnvironment()
    with pytest.raises(ApplicationError):
        await other.run(client.close, command)
    assert await env.run(client.observe, invocation) == {"state": "active"}
    progress = await env.run(client.close, command)
    assert (progress["release_authorized"], progress["reason"]) == (False, "cancelled")
    reopened = DeploymentActivities(
        client.installation, invocation["epoch"], client.transport
    )
    assert await env.run(reopened.result, invocation) == {"status": "absent"}
    assert await env.run(reopened.observe, invocation) == {"state": "sealed"}
    assert await env.run(reopened.close, command) == progress
    with pytest.raises(ApplicationError):
        await env.run(reopened.close, invocation | {"reason": "completed"})


@pytest.fixture
def passed(client):
    names = {
        "api": {"authz-state-init": "busybox", "authz-bootstrap": "api", "api": "api"},
        "ui": {"ui": "ui"},
        "openfga": {"migrate-database": "openfga", "openfga": "openfga"},
        "application-postgres": {
            "volume-permissions": "busybox",
            "postgresql": "postgres",
        },
        "openfga-postgres": {"volume-permissions": "busybox", "postgresql": "postgres"},
    }
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    result = {
        "schema_version": "birbverify.deployment.account-auth.result.v1",
        "invocation": client.invocation,
        "operation_id": client.operation_id,
        "profile": client.installation.profile.model_dump(mode="json"),
        "workloads": [
            pod.model_dump()
            | {
                "containers": [
                    {
                        "role": role,
                        "name": name,
                        "runtime_image_digest": client.installation.request.images[
                            role
                        ].config_digest,
                        "container_id": "containerd://"
                        + digest({"pod": pod.uid, "container": name}),
                    }
                    for name, role in names[pod.workload].items()
                ]
            }
            for pod in client.installation.pods
        ],
        "outcome": "passed",
        "started_at": now,
        "completed_at": now,
        "assertions": dict.fromkeys(producer.Assertions.model_fields, "passed"),
    }
    return result | {"result_sha256": digest(result)}


def test_recovered_result_validates_each_pinned_identity(client, passed, monkeypatch):
    reply = {"status": "recorded", "result": passed}
    monkeypatch.setattr(client, "_post", lambda *_: reply)
    assert client._result(client.invocation) == reply
    for path, value in (
        (("invocation", "epoch"), "replayed"),
        (("operation_id",), "f" * 64),
        (("profile", "suite_sha256"), "f" * 64),
        (("workloads", 0, "node_uid"), "different"),
        (("workloads", 0, "controller_uid"), "different"),
        (("workloads", 1, "containers", 0, "name"), "other"),
        (("workloads", 1, "containers", 0, "role"), "busybox"),
        (
            ("workloads", 1, "containers", 0, "runtime_image_digest"),
            "sha256:" + "f" * 64,
        ),
        (
            ("workloads", 1, "containers", 0, "container_id"),
            passed["workloads"][0]["containers"][0]["container_id"],
        ),
        (("assertions", "account_create"), "unknown"),
        (("started_at",), "2099-01-01T00:00:00Z"),
    ):
        forged = copy.deepcopy(passed)
        where = forged
        for key in path[:-1]:
            where = where[key]
        where[path[-1]] = value
        del forged["result_sha256"]
        forged["result_sha256"] = digest(forged)
        reply["result"] = forged
        with pytest.raises(ValueError):
            client._result(client.invocation)


def test_denied_closure_cannot_masquerade_as_release(client, monkeypatch):
    command = client.invocation | {"reason": "worker_lost"}
    progress = client._close(command)
    for field, value in (
        ("release_authorized", True),
        ("release_authorized", 0),
        ("installation_sha256", "1" * 64),
        ("cluster_uid", "other"),
        ("namespace_uid", "other"),
        ("reason", "completed"),
        ("installation_obligations", ["unexpected-private-data"]),
    ):
        monkeypatch.setattr(
            client, "_post", lambda *_, reply=progress | {field: value}: reply
        )
        with pytest.raises(ValueError):
            client._close(command)
