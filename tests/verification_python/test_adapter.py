import io
import json
import sys
from types import SimpleNamespace

import pytest

from verification import adapter


@pytest.mark.parametrize(
    "error",
    [ValueError("invalid_manifest"), KeyError("passing"), IndexError("missing")],
)
def test_post_commit_projection_failure_is_unavailable(monkeypatch, capsys, error):
    from test_queue import fixture_installation, intent

    command = intent(fixture_installation())
    committed = []

    class Handle:
        async def describe(self, **options):
            return SimpleNamespace(status=adapter.WorkflowExecutionStatus.RUNNING)

        async def execute_update(self, update, argument, **options):
            committed.append(argument["intent"])
            return {"ok": True}

        async def query(self, query, **options):
            return {"requests": []}

    async def connect(*args, **options):
        return SimpleNamespace(get_workflow_handle=lambda identity: Handle())

    def projection(*args, **kwargs):
        raise error

    config = SimpleNamespace(
        profile="legacy-v1",
        owner_principal="owner",
        temporal_address="fixture",
        namespace="default",
        workflow_id="queue",
        installation_root="fixture",
    )
    monkeypatch.setattr(
        sys, "stdin", SimpleNamespace(buffer=io.BytesIO(json.dumps(command).encode()))
    )
    monkeypatch.setattr(sys, "argv", ["adapter", "fixture-config"])
    monkeypatch.setattr(adapter, "load_config", lambda path: config)
    monkeypatch.setattr(adapter.Client, "connect", connect)
    monkeypatch.setattr(adapter, "installation", lambda root: fixture_installation())
    monkeypatch.setattr(adapter, "projection", projection)
    adapter.main()
    assert committed == [command]
    assert json.loads(capsys.readouterr().out) == {
        "ok": False,
        "status": 503,
        "code": "verification_unavailable",
    }


def test_invalid_command_rejected_before_loading_configuration(monkeypatch, capsys):
    monkeypatch.setattr(
        sys, "stdin", SimpleNamespace(buffer=io.BytesIO(b'{"op":"release"}'))
    )
    monkeypatch.setattr(
        adapter,
        "load_config",
        lambda path: pytest.fail("invalid command reached runtime"),
    )
    adapter.main()
    assert json.loads(capsys.readouterr().out)["status"] == 400
