import asyncio
import json
import sys
from pathlib import Path

from birbverify.temporal_worker import Activities
from temporalio.client import Client
from temporalio.worker import Worker


async def main():
    root, configuration = map(Path, sys.argv[1:3])
    config = json.loads(configuration.read_text())
    client = await Client.connect(
        config["temporal_address"], namespace=config["namespace"]
    )
    await Worker(
        client,
        task_queue=config["activity_task_queue"],
        activities=[Activities(root).verify],
    ).run()


if __name__ == "__main__":
    asyncio.run(main())
