import asyncio
import json
import sys
from datetime import timedelta

from birbcrew.execution.contract import digest

from delivery.model import Intent, connect, load
from delivery.workflow import DeliveryWorkflow


async def execute(config, intent):
    if intent.principal != config.owner_principal:
        return {"ok": False, "status": 403, "code": "forbidden"}
    client = await connect(config)
    handle = client.get_workflow_handle(config.workflow_id)
    if intent.op == "command":
        if intent.body is None:
            return {"ok": False, "status": 400, "code": "invalid_command"}
        result = await handle.execute_update(
            DeliveryWorkflow.command,
            intent.model_dump(mode="json"),
            id=f"{intent.body.command_id}:{digest(intent)}",
            rpc_timeout=timedelta(seconds=10),
        )
        if not result["ok"]:
            return result
    state = await handle.query(
        DeliveryWorkflow.snapshot, rpc_timeout=timedelta(seconds=10)
    )
    return {"ok": True, "value": state}


def main():
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise ValueError("too_large")
        intent = Intent.model_validate_json(raw)
    except ValueError:
        result = {"ok": False, "status": 400, "code": "invalid_command"}
    else:
        try:
            result = asyncio.run(
                asyncio.wait_for(execute(load(sys.argv[1]), intent), 17)
            )
        except Exception:  # noqa: BLE001
            result = {
                "ok": False,
                "status": 503,
                "code": "delivery_acknowledgement_unknown",
            }
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
