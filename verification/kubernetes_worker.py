import asyncio
import signal
import sys
from datetime import timedelta
from pathlib import Path

from temporalio.common import WorkflowIDConflictPolicy, WorkflowIDReusePolicy
from temporalio.worker import Worker

from verification.deployment_runtime import coordinator_activities
from verification.kubernetes import (
    KubernetesConfig,
    KubernetesQueueConfig,
    check_installation,
)
from verification.kubernetes_workflow import KubernetesQueue
from verification.temporal_transport import connect


async def run(config: KubernetesConfig):
    activities = coordinator_activities(config)
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, stopped.set)
    client = await connect(config)
    handle = await client.start_workflow(
        KubernetesQueue.run,
        {"config": config.queue.model_dump(mode="json")},
        id=config.queue.authority.workflow_id,
        task_queue=config.workflow_task_queue,
        id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
        id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
    )
    # A replacement worker can receive pending tasks as soon as it starts polling.
    events = handle.fetch_history_events(page_size=1, rpc_timeout=timedelta(seconds=10))
    start = (await anext(events)).workflow_execution_started_event_attributes
    if start.workflow_type.name != "KubernetesQueue":
        raise ValueError("running_workflow_type_mismatch")
    (initial,) = await client.data_converter.decode(start.input.payloads)
    check_installation(
        config,
        {
            "config": KubernetesQueueConfig.model_validate(
                initial["config"]
            ).model_dump(mode="json"),
            "workflow_task_queue": start.task_queue.name,
        },
    )
    async with Worker(
        client,
        task_queue=config.workflow_task_queue,
        workflows=[KubernetesQueue],
        activities=activities,
        sticky_queue_schedule_to_start_timeout=timedelta(seconds=2),
    ):
        installed = await handle.query(
            KubernetesQueue.installation, rpc_timeout=timedelta(seconds=10)
        )
        check_installation(config, installed)
        await stopped.wait()


def main():
    config = KubernetesConfig.model_validate_json(Path(sys.argv[1]).read_text())
    asyncio.run(run(config))


if __name__ == "__main__":
    main()
