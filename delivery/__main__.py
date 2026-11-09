import asyncio
import sys

from birbcrew.execution.contract import digest
from temporalio.common import WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.worker import Worker

from delivery.model import connect, load
from delivery.workflow import DeliveryWorkflow


async def main():
    mode, path = sys.argv[1:]
    config = load(path)
    client = await connect(config)
    if mode == "install":
        installation = config.model_dump(
            mode="json", exclude={"tls", "temporal_address", "namespace"}
        )
        try:
            await client.start_workflow(
                DeliveryWorkflow.run,
                installation,
                id=config.workflow_id,
                task_queue=config.workflow_task_queue,
                id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
            )
        except WorkflowAlreadyStartedError:
            handle = client.get_workflow_handle(config.workflow_id)
            async for event in handle.fetch_history_events(page_size=1):
                attributes = event.workflow_execution_started_event_attributes
                [installed] = await client.data_converter.decode(
                    attributes.input.payloads
                )
                if digest(installed) != digest(installation):
                    raise ValueError("installed_delivery_conflict")
                break
            else:
                raise ValueError("installed_delivery_missing_history")

    elif mode == "health":
        await asyncio.wait_for(
            client.get_workflow_handle(config.workflow_id).query(
                DeliveryWorkflow.snapshot
            ),
            timeout=5,
        )
    elif mode == "worker":
        await Worker(
            client, task_queue=config.workflow_task_queue, workflows=[DeliveryWorkflow]
        ).run()
    else:
        raise ValueError("expected_install_worker_or_health")


if __name__ == "__main__":
    asyncio.run(main())
