"""scripts/chat-agent.py answers from the model its caller names and from no other.

Run with the Python that has Crew installed. scripts/verify runs it with the pinned
development Crew. By hand: python -m pytest tests/test_chat_agent.py -q
"""

import importlib.util
import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from birbcrew import provider

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/chat-agent.py"
INSPECTION = "Gateway: online. Crew runtime: ready."
KEY = "fixture-token-not-a-credential"


def chat(**extra):
    return {
        "id": "00000000-0000-4000-8000-000000000001",
        "agent": {"id": "chief-of-staff", "name": "Chief of Staff", "instructions": "Answer."},
        "turns": [{"id": "turn-1", "text": "Status?", "answer": None}],
        "inspection": INSPECTION,
        **extra,
    }


def run(*arguments, payload):
    return subprocess.run(
        [sys.executable, "-I", str(SCRIPT), *arguments],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=60,
    )


def load():
    spec = importlib.util.spec_from_file_location("chat_agent", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def former_attestation(path, age=timedelta(hours=13)):
    """The dated owner statement the removed gate read, always past its 12-hour limit."""
    path.write_text(
        json.dumps(
            {
                "provider": "opencode-go",
                "account_path": "fixture account",
                "extra_usage_disabled": True,
                "eligible_coding_use": True,
                "checked_at": (datetime.now(UTC) - age).isoformat(),
                "evidence": "fixture statement",
            }
        )
    )
    return path


def test_local_mode_answers_from_the_inspection_without_a_credential():
    result = run("--local", payload=chat())
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == INSPECTION


@pytest.mark.parametrize(
    "arguments",
    [(), ("--mock",), ("--test",), ("live",), ("--LIVE",), ("",), ("--local", "--live")],
)
def test_an_absent_or_unknown_mode_is_an_error_and_never_a_local_answer(arguments):
    result = run(*arguments, payload=chat(providerKey=KEY))
    assert result.returncode != 0
    assert result.stdout == ""
    assert "usage: chat-agent.py --live|--local" in result.stderr
    assert KEY not in result.stderr


@pytest.mark.parametrize("age", [timedelta(hours=12, minutes=1), timedelta(days=30), None])
def test_an_attestation_path_no_longer_selects_live_mode(tmp_path, age):
    # Before the gate was removed, the gateway passed this path to mean "live".
    path = tmp_path / "opencode-go.json"
    if age is not None:
        former_attestation(path, age)
    result = run(str(path), payload=chat(providerKey=KEY))
    assert result.returncode != 0
    assert result.stdout == ""
    assert "usage: chat-agent.py --live|--local" in result.stderr


@pytest.mark.parametrize("payload", [chat(), chat(providerKey=""), chat(providerKey=" "), chat(providerKey=None)])
def test_live_mode_without_the_credential_fails_instead_of_answering_locally(payload):
    result = run("--live", payload=payload)
    assert result.returncode != 0
    assert result.stdout == ""
    assert "Live chat requires the provider credential." in result.stderr


@pytest.mark.parametrize("state", ["absent", "expired", "garbage"])
def test_live_mode_builds_the_provider_model_from_the_credential_alone(tmp_path, monkeypatch, state):
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai.models.openai import OpenAIChatModel

    statement = tmp_path / "opencode-go.json"
    if state == "expired":
        former_attestation(statement)
    elif state == "garbage":
        statement.write_text("renew me")

    def unexpected(*arguments, **options):
        raise AssertionError("the removed attestation check was called")

    # Crew before the removal still has this function. Either way the script must not call it.
    monkeypatch.setattr(provider, "check_evidence", unexpected, raising=False)
    module = load()
    payload = chat(providerKey=KEY)
    model = module.select_model("--live", payload)
    assert isinstance(model, OpenAIChatModel) and not isinstance(model, FunctionModel)
    assert model.model_name == provider.MODEL
    assert model._provider.client.api_key == KEY
    assert str(model._provider.client.base_url).rstrip("/") == provider.ENDPOINT
    assert "providerKey" not in payload
    assert isinstance(module.select_model("--local", chat()), FunctionModel)
    with pytest.raises(SystemExit):
        module.select_model("--mock", chat(providerKey=KEY))
    assert "check_evidence" not in SCRIPT.read_text()
