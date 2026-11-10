import argparse
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
from verification.kubernetes_runtime import check_producer
from verification.kubernetes_workflow import KubernetesQueue

MAX_INPUT = 16384


async def execute(config: KubernetesConfig, raw: dict) -> dict:
    command = KubernetesCommand.model_validate(raw).normalized()
    authority = config.queue.authority
    try:
        check_producer(authority.producer_revision)
    except (ValueError, OSError) as error:
        return failure(
            str(error)
            if isinstance(error, ValueError)
            else "producer_source_unavailable",
            409,
        )
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
    try:
        check_installation(config, installed)
    except ValueError:
        return failure("running_installation_mismatch", 409)
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
    row = next(
        (
            row
            for row in snapshot["requests"]
            if row["request_id"] == command["body"]["request_id"]
        ),
        None,
    )
    if row is None:
        return failure("request_projection_unavailable", 503)
    return {"ok": True, "receipt": receipt, "value": row}


def main():
    parser = argparse.ArgumentParser(
        description="Submit a command to the installed Kubernetes queue."
    )
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
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
                config = KubernetesConfig.model_validate_json(args.config.read_text())
            except (ValueError, OSError):
                response = failure("invalid_configuration", 409)
            else:
                try:
                    response = asyncio.run(
                        asyncio.wait_for(execute(config, command), timeout=25)
                    )
                except (TimeoutError, RPCError, TemporalError):
                    response = failure("verification_unavailable", 503)
    print(json.dumps(response, separators=(",", ":")))


if __name__ == "__main__":
    main()
