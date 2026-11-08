import json
import socket
import sys
from pathlib import Path

import httpx
import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
from verification_runtime import VerificationRuntime, free_port  # noqa: E402


@pytest.fixture
def runtime(monkeypatch):
    monkeypatch.delenv("BIRBFORGE_PROXY_CONFIG", raising=False)
    value = VerificationRuntime(REPO)
    (value.root / "clients.json").write_text(json.dumps({
        "url": "http://127.0.0.1:1", "tokens": value.crew.tokens,
    }))
    (value.root / "clients.json").chmod(0o600)
    try:
        yield value
    finally:
        for name in list(value.processes):
            value.stop(name)
        value.crew.client.close()


def configure(runtime, monkeypatch, **overrides):
    configuration = {"port": free_port(), "origin": "https://phone.example.invalid"} | overrides
    path = runtime.root / "proxy.json"
    path.write_text(json.dumps(configuration))
    path.chmod(0o600)
    monkeypatch.setenv("BIRBFORGE_PROXY_CONFIG", str(path))
    return path, configuration


def test_proxy_ready_on_start_and_restart(runtime, monkeypatch):
    _, config = configure(runtime, monkeypatch)
    for _ in range(2):
        runtime.start_gateway()
        url = f"http://127.0.0.1:{config['port']}"
        response = httpx.get(url + "/api/conversations", headers={"Host": "phone.example.invalid"})
        assert response.status_code == 401
        assert response.json()["code"] == "authentication_required"
        assert runtime.proxy_origin == config["origin"]
        assert httpx.get(url).status_code == 403
        assert httpx.get(runtime.url, headers={"Host": "phone.example.invalid"}).status_code == 403
        response = httpx.get(url + "/api/conversations", headers={
            "Host": "phone.example.invalid", "Origin": "https://wrong.example.invalid",
            "Authorization": "Bearer " + runtime.crew.tokens["owner"],
        })
        assert response.status_code == 403
        assert response.json()["code"] == "origin_rejected"
        runtime.stop("gateway")


def test_default_listener_without_proxy(runtime):
    runtime.start_gateway()
    assert httpx.get(runtime.url).status_code == 200
    assert runtime.proxy_origin is None


@pytest.mark.parametrize("invalid", ["permissions", "origin", "missing", "occupied"])
def test_invalid_proxy_never_publishes_readiness(runtime, monkeypatch, invalid):
    path, config = configure(runtime, monkeypatch)
    reserved = socket.socket()
    try:
        if invalid == "permissions":
            path.chmod(0o644)
        elif invalid == "origin":
            path.write_text(json.dumps(config | {"origin": "http://phone.example.invalid"}))
        elif invalid == "missing":
            path.unlink()
        else:
            reserved.bind(("127.0.0.1", config["port"]))
            reserved.listen()
        with pytest.raises(RuntimeError, match="fixture process exited"):
            runtime.start_gateway()
        assert not list(runtime.root.glob("gateway-ready-*.json"))
    finally:
        reserved.close()


@pytest.mark.parametrize("invalid", ["permissions", "occupied"])
def test_failed_restart_does_not_reuse_ready_receipt(runtime, monkeypatch, invalid):
    path, config = configure(runtime, monkeypatch)
    runtime.start_gateway()
    runtime.stop("gateway")
    receipts = list(runtime.root.glob("gateway-ready-*.json"))
    assert len(receipts) == 1
    with socket.socket() as reserved:
        if invalid == "permissions":
            path.chmod(0o644)
        else:
            reserved.bind(("127.0.0.1", config["port"]))
            reserved.listen()
        with pytest.raises(RuntimeError, match="fixture process exited"):
            runtime.start_gateway()
    assert list(runtime.root.glob("gateway-ready-*.json")) == receipts
