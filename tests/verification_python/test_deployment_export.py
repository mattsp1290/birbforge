import hashlib

import pytest

pytest.importorskip("birbverify.kubernetes_contract")
from kubernetes_helpers import config as queue_config

from verification import deployment_export, temporal_transport
from verification.kubernetes import KubernetesConfig


@pytest.fixture
def config(tmp_path):
    queue = queue_config().model_dump(mode="json")
    queue["deployment"] = {
        "request_id": "r1",
        "request_sha256": "2" * 64,
        "activity_installation_sha256": "3" * 64,
        "producer_package_sha256": "3" * 64,
        "ownership_server_cert_sha256": "3" * 64,
        "epoch": "epoch-1",
        "deadline": "2026-11-20T00:00:00Z",
        "verifier_task_queue": "verifier",
    }
    for name in ("ca.pem", "reader.pem", "reader.key"):
        (tmp_path / name).write_bytes(name.encode())
    return KubernetesConfig(
        queue=queue,
        temporal_address="127.0.0.1:7233",
        workflow_task_queue="owner",
        temporal_tls={
            "server_ca": tmp_path / "ca.pem",
            "server_ca_sha256": hashlib.sha256(b"ca.pem").hexdigest(),
            "server_name": "temporal.example",
            "client_cert": tmp_path / "reader.pem",
            "client_key": tmp_path / "reader.key",
        },
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["none", "pin", "no_tls", "address", "empty_key"])
async def test_deployment_transport(config, monkeypatch, change):
    calls = []

    async def connect(address, **options):
        calls.append((address, options))

    monkeypatch.setattr(temporal_transport.Client, "connect", connect)
    if change == "pin":
        config.temporal_tls.server_ca.write_text("changed")
    elif change == "no_tls":
        config = config.model_copy(update={"temporal_tls": None})
    elif change == "address":
        config = config.model_copy(update={"temporal_address": "http://localhost:7233"})
    elif change == "empty_key":
        config.temporal_tls.client_key.write_bytes(b"")
    if change != "none":
        with pytest.raises(ValueError):
            await temporal_transport.connect(config)
        assert not calls
        return
    await temporal_transport.connect(config)
    [(address, options)] = calls
    assert (address, options["namespace"]) == (
        config.temporal_address,
        config.namespace,
    )
    tls = options["tls"]
    assert tls.domain == tls.verification_server_name == config.temporal_tls.server_name
    assert tls.server_root_ca_cert == b"ca.pem"
    assert tls.client_cert == b"reader.pem"
    assert tls.client_private_key == b"reader.key"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [
        "none",
        "unadmitted",
        "other_installation",
        "other_epoch",
        "operation",
        "grant",
        "extra",
    ],
)
async def test_retrieve_deployment_status(config, monkeypatch, change):
    profile = config.queue.deployment
    status = {
        "schema_version": "birbforge.deployment.evidence-status.v1",
        "invocation": profile.invocation,
        "operation_id": profile.operation_id,
        "result_sha256": "4" * 64,
        "seal_observation_sha256": None,
        "eligible": False,
        "reason": "release_not_authorized",
    }
    if change == "other_epoch":
        status["invocation"]["epoch"] = "other"
    elif change == "operation":
        status["operation_id"] = "a" * 64
    elif change == "grant":
        status["eligible"] = True
    elif change == "extra":
        status["promotion"] = {"eligible": True}

    class Client:
        def get_workflow_handle(self, workflow_id):
            assert workflow_id == config.queue.authority.workflow_id
            return self

        async def query(self, name, *args, rpc_timeout):
            if name == "installation":
                return {
                    "config": config.queue.model_dump(mode="json"),
                    "workflow_task_queue": "other"
                    if change == "other_installation"
                    else "owner",
                }
            assert change != "other_installation"
            assert name == "deployment_evidence_v1"
            assert args == (profile.invocation,)
            return None if change == "unadmitted" else status

    async def connect(_config):
        return Client()

    monkeypatch.setattr(deployment_export, "connect", connect)
    if change == "none":
        result = await deployment_export.retrieve(config)
        assert result.model_dump(mode="json") == status
    else:
        with pytest.raises(ValueError):
            await deployment_export.retrieve(config)
