import asyncio
import sys
from datetime import timedelta
from pathlib import Path

from temporalio.client import Client
from temporalio.common import WorkflowIDConflictPolicy, WorkflowIDReusePolicy
from temporalio.worker import Worker

from verification.kubernetes import KubernetesConfig, check_installation
from verification.kubernetes_workflow import KubernetesQueue


async def run(config: KubernetesConfig):
    client = await Client.connect(config.temporal_address, namespace=config.namespace)
    async with Worker(
        client,
        task_queue=config.workflow_task_queue,
        workflows=[KubernetesQueue],
        sticky_queue_schedule_to_start_timeout=timedelta(seconds=2),
    ):
        handle = await client.start_workflow(
            KubernetesQueue.run,
            {"config": config.queue.model_dump(mode="json")},
            id=config.queue.authority.workflow_id,
            task_queue=config.workflow_task_queue,
            id_conflict_policy=WorkflowIDConflictPolicy.USE_EXISTING,
            id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
        )
        installed = await handle.query(
            KubernetesQueue.installation, rpc_timeout=timedelta(seconds=10)
        )
        check_installation(config, installed)
        await asyncio.Event().wait()


def main():
    config = KubernetesConfig.model_validate_json(Path(sys.argv[1]).read_text())
    asyncio.run(run(config))


if __name__ == "__main__":
    main()
