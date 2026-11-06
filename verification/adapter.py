import asyncio
import json
import sys
from datetime import timedelta
from pathlib import Path

from birbverify.contract import digest
from temporalio.client import Client, WorkflowExecutionStatus

from verification.model import BindingInstallation, Command, Config, failure
from verification.producer import installation, projection
from verification.workflow import EnvironmentQueue

MAX_INPUT = 16384


async def execute(config: Config, raw: dict):
    intent = Command.model_validate(raw).normalized()
    if intent["principal"] != config.owner_principal:
        return failure("forbidden", 403)
    client = await Client.connect(config.temporal_address, namespace=config.namespace)
    handle = client.get_workflow_handle(config.workflow_id)
    if (
        await handle.describe(rpc_timeout=timedelta(seconds=10))
    ).status != WorkflowExecutionStatus.RUNNING:
        return failure("verification_unavailable", 503)
    if intent["op"] != "snapshot":
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
    snapshot = projection(
        config.installation_root, state, intent["principal"], intent["conversation_id"]
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


def load_config(path):
    return Config.model_validate_json(Path(path).read_text())


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        response = failure("input_too_large", 413)
    else:
        try:
            intent = Command.model_validate(json.loads(raw)).normalized()
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
