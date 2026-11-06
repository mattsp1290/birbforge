import asyncio
import fcntl
import json
import logging
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from temporalio import workflow
from temporalio.client import Client
from temporalio.common import WorkflowIDReusePolicy
from temporalio.worker import Worker

from verification.adapter import load_config
from verification.producer import Observations
from verification.workflow import EnvironmentQueue


def process_identity():
    stat = Path(f"/proc/{os.getpid()}/stat").read_text().rsplit(")", 1)[1].split()
    return {
        "pid": os.getpid(),
        "start_ticks": stat[19],
        "boot_id": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
        "started_at": datetime.now(UTC).isoformat(),
    }


async def main():
    os.umask(0o077)
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    logging.getLogger("temporalio.workflow").setLevel(logging.INFO)
    workflow.logger.workflow_info_on_message = False
    workflow.logger.workflow_info_on_extra = False
    mode, path = sys.argv[1:3]
    config = load_config(path)
    client = await Client.connect(config.temporal_address, namespace=config.namespace)
    if mode == "install":
        await client.start_workflow(
            EnvironmentQueue.run,
            {"config": config.model_dump(mode="json")},
            id=config.workflow_id,
            task_queue=config.workflow_task_queue,
            id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
            rpc_timeout=timedelta(seconds=10),
        )
    elif mode == "worker":
        await Worker(
            client,
            task_queue=config.workflow_task_queue,
            workflows=[EnvironmentQueue],
            sticky_queue_schedule_to_start_timeout=timedelta(seconds=2),
            activities=[Observations(config.installation_root).inspect],
        ).run()
    elif mode == "activity-worker":
        from birbverify.temporal_worker import Activities

        with (config.installation_root / "activity-worker.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            directory = config.installation_root / "worker-identities"
            directory.mkdir(exist_ok=True, mode=0o700)
            identity = process_identity()
            identity["installation_root"] = str(config.installation_root.resolve())
            (directory / f"{uuid4()}.json").write_text(json.dumps(identity))
            await Worker(
                client,
                task_queue=config.activity_task_queue,
                activities=[Activities(config.installation_root).verify],
            ).run()
    else:
        raise ValueError("expected install, worker, or activity-worker")


if __name__ == "__main__":
    asyncio.run(main())
