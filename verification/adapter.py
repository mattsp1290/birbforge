import asyncio
import json
import sys
from datetime import timedelta
from pathlib import Path
from typing import Annotated, Literal

from birbverify.contract import digest
from pydantic import Field
from temporalio.client import Client, WorkflowExecutionStatus

from verification.model import BindingInstallation, Command, Config, Record, failure
from verification.producer import installation, observe, projection
from verification.workflow import EnvironmentQueue

MAX_INPUT = 16384


class FactoryQuery(Record):
    op: Literal["factory"]
    principal: Annotated[str, Field(min_length=1, max_length=96)]


def parse_intent(raw):
    if isinstance(raw, dict) and raw.get("op") == "factory":
        return FactoryQuery.model_validate(raw).model_dump()
    return Command.model_validate(raw).normalized()


def factory_summary(config, state, principal):
    rows = [row for row in state["requests"] if row["intent"]["principal"] == principal]
    if config.profile == "closure-v2":
        from verification.closure import observe as observe_closure

        observation = observe_closure(
            config.installation_root, [], config.closure_binding.model_dump(mode="json")
        )
    else:
        observation = observe(config.installation_root, [])
    waiting = sum(row["phase"] == "queued" for row in rows)
    running = sum(row["phase"] in {"dispatching", "running"} for row in rows)
    uncertain = sum(row["phase"] == "uncertain" for row in rows)
    return {
        "conversationId": rows[-1]["intent"]["conversation_id"] if rows else None,
        "environment": observation["environment"]["state"],
        "queued": waiting,
        "running": running,
        "uncertain": uncertain,
        "finished": len(rows) - waiting - running - uncertain,
    }


async def execute(config: Config, raw: dict):
    check_profile(config)
    intent = parse_intent(raw)
    if intent["principal"] != config.owner_principal:
        return failure("forbidden", 403)
    client = await Client.connect(config.temporal_address, namespace=config.namespace)
    handle = client.get_workflow_handle(config.workflow_id)
    if (
        await handle.describe(rpc_timeout=timedelta(seconds=10))
    ).status != WorkflowExecutionStatus.RUNNING:
        return failure("verification_unavailable", 503)
    if intent["op"] in {"admit", "cancel"}:
        identity = intent["body"][
            "idempotency_key" if intent["op"] == "admit" else "command_id"
        ]
        update_id = f"{intent['op']}:{intent['principal']}:{identity}:{digest(intent)}"
        argument = (
            {
                "intent": intent,
                "installation": BindingInstallation.from_installed(
                    installation(config.installation_root)
                ),
            }
            if intent["op"] == "admit"
            else intent
        )
        receipt = await handle.execute_update(
            EnvironmentQueue.admit
            if intent["op"] == "admit"
            else EnvironmentQueue.cancel,
            argument,
            id=update_id,
            rpc_timeout=timedelta(seconds=10),
        )
        if not receipt["ok"]:
            return receipt
    state = await handle.query(
        EnvironmentQueue.snapshot, rpc_timeout=timedelta(seconds=10)
    )
    if intent["op"] == "factory":
        return {
            "ok": True,
            "value": factory_summary(config, state, intent["principal"]),
        }
    snapshot = projection(
        config.installation_root,
        state,
        intent["principal"],
        intent["conversation_id"],
        config=config,
    )
    value = (
        snapshot
        if intent["op"] == "snapshot"
        else next(
            row
            for row in snapshot["requests"]
            if row["request_id"] == intent["body"]["request_id"]
        )
    )
    return {"ok": True, "value": value}


def check_profile(config):
    installed = installation(config.installation_root)
    if config.profile == "closure-v2":
        from verification.closure import installed_binding

        installed_binding(
            config.installation_root, config.closure_binding.model_dump(mode="json")
        )
    elif installed.get("closure_binding"):
        raise ValueError("legacy_profile_cannot_access_closure_target")


def load_config(path):
    return Config.model_validate_json(Path(path).read_text())


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        response = failure("input_too_large", 413)
    else:
        try:
            intent = parse_intent(json.loads(raw))
        except (ValueError, TypeError):
            response = failure("invalid_request", 400)
        else:
            try:
                config = load_config(sys.argv[1])
                response = asyncio.run(
                    asyncio.wait_for(execute(config, intent), timeout=17)
                )
            except Exception:  # noqa: BLE001
                response = failure("verification_unavailable", 503)
    sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
