import asyncio
import json
import sys
from datetime import timedelta
from pathlib import Path

from temporalio.client import Client
from temporalio.exceptions import TemporalError
from temporalio.service import RPCError

from verification.kubernetes import (
    KubernetesCommand,
    KubernetesConfig,
    check_installation,
    digest,
    failure,
    projection,
)
from verification.kubernetes_workflow import KubernetesQueue

MAX_INPUT = 16384


async def execute(config: KubernetesConfig, raw: dict) -> dict:
    command = KubernetesCommand.model_validate(raw).normalized()
    authority = config.queue.authority
    try:
        client = await Client.connect(
            config.temporal_address, namespace=config.namespace
        )
    except RuntimeError:
        return failure("verification_unavailable", 503)
    handle = client.get_workflow_handle(authority.workflow_id)
    installed = await handle.query(
        KubernetesQueue.installation, rpc_timeout=timedelta(seconds=10)
    )
    check_installation(config, installed)
    message = {"command": command, "principal": authority.owner_principal}
    if command["op"] != "snapshot":
        receipt = await handle.execute_update(
            {
                "admit": KubernetesQueue.admit,
                "cancel": KubernetesQueue.cancel,
                "complete": KubernetesQueue.complete,
            }[command["op"]],
            message,
            id=command["op"] + ":" + digest(message),
            rpc_timeout=timedelta(seconds=10),
        )
        if not receipt["ok"]:
            return receipt
    state = await handle.query(
        KubernetesQueue.snapshot, rpc_timeout=timedelta(seconds=10)
    )
    snapshot = projection(state, authority.owner_principal, command["conversation_id"])
    if command["op"] == "snapshot":
        return {"ok": True, "value": snapshot}
    return {
        "ok": True,
        "receipt": receipt,
        "value": next(
            row
            for row in snapshot["requests"]
            if row["request_id"] == command["body"]["request_id"]
        ),
    }


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        response = failure("input_too_large", 413)
    else:
        try:
            command = KubernetesCommand.model_validate_json(raw).normalized()
        except (ValueError, TypeError):
            response = failure("invalid_request", 400)
        else:
            try:
                config = KubernetesConfig.model_validate_json(
                    Path(sys.argv[1]).read_text()
                )
                response = asyncio.run(
                    asyncio.wait_for(execute(config, command), timeout=25)
                )
            except (ValueError, OSError, TimeoutError, RPCError, TemporalError):
                response = failure("verification_unavailable", 503)
    print(json.dumps(response, separators=(",", ":")))


if __name__ == "__main__":
    main()
