import asyncio
import os
from datetime import timedelta
from uuid import uuid4

from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker
from test_workflow import offer, review

from delivery.workflow import DeliveryWorkflow


def test_delivery_survives_workflow_worker_restart_without_second_author():
    async def exercise():
        entered = asyncio.Event()
        finish = asyncio.Event()
        authors = []
        reviews = []
        publications = []

        @activity.defn(name="birbcrew.author_goal.v1")
        async def author(value: dict):
            authors.append(value["operation_id"])
            entered.set()
            while not finish.is_set():
                activity.heartbeat()
                await asyncio.sleep(0.05)
            installed = value["approved_goal"]["offer"]
            return {
                "status": "candidate",
                "candidate": {
                    "repository_id": installed["repository_id"],
                    "base_commit": installed["base_commit"],
                    "head_commit": "c" * 40,
                    "branch": "birbforge/pilot/" + value["operation_id"],
                    "changed_paths": ["docs/operator.md"],
                    "acceptance": {
                        "acceptance_id": installed["acceptance_id"],
                        "outcome": "passed",
                        "evidence_digest": "d" * 64,
                        "evidence_ref": "evidence/one",
                    },
                },
            }

        @activity.defn(name="birbcrew.review_candidate.v1")
        async def independent_review(value: dict):
            reviews.append(value["candidate"]["head_commit"])
            return review()

        @activity.defn(name="birbcrew.publish_draft.v1")
        async def publish(value: dict):
            publications.append(value["candidate"]["head_commit"])
            return {
                "status": "draft_ready",
                "repository_id": value["candidate"]["repository_id"],
                "head_commit": value["candidate"]["head_commit"],
                "base_branch": "main",
                "provider": "github",
                "number": 42,
                "url": "https://github.com/mattsp1290/forge/pull/42",
                "draft": True,
            }

        async with await WorkflowEnvironment.start_local(
            dev_server_existing_path=os.environ.get(
                "TEMPORAL_TEST_SERVER", "/opt/homebrew/bin/temporal"
            ),
            dev_server_log_level="error",
        ) as environment:
            queue = "delivery-" + str(uuid4())
            worker = Worker(
                environment.client,
                task_queue=queue,
                workflows=[DeliveryWorkflow],
                sticky_queue_schedule_to_start_timeout=timedelta(seconds=1),
            )
            async with Worker(
                environment.client,
                task_queue=queue + "-activities",
                activities=[author, independent_review, publish],
            ):
                await worker.__aenter__()
                try:
                    handle = await environment.client.start_workflow(
                        DeliveryWorkflow.run,
                        {
                            "offer": offer().model_dump(mode="json"),
                            "owner_principal": "owner",
                            "activity_task_queue": queue + "-activities",
                            "workflow_id": queue,
                        },
                        id=queue,
                        task_queue=queue,
                    )
                    state = await handle.query(DeliveryWorkflow.snapshot)
                    command = {
                        "op": "command",
                        "principal": "owner",
                        "conversation_id": str(uuid4()),
                        "body": {
                            "command_id": str(uuid4()),
                            "action": "approve",
                            "expected_revision": state["revision"],
                            "offer_sha256": state["offer_sha256"],
                        },
                    }
                    assert await handle.execute_update(
                        DeliveryWorkflow.command, command
                    ) == {"ok": True}
                    await asyncio.wait_for(entered.wait(), 10)
                finally:
                    await worker.__aexit__(None, None, None)
                async with Worker(
                    environment.client, task_queue=queue, workflows=[DeliveryWorkflow]
                ):
                    state = await handle.query(DeliveryWorkflow.snapshot)
                    assert state["stage"]["kind"] == "authoring"
                    assert await handle.execute_update(
                        DeliveryWorkflow.command, command
                    ) == {"ok": True}
                    finish.set()
                    for _ in range(100):
                        state = await handle.query(DeliveryWorkflow.snapshot)
                        if state["stage"]["kind"] == "draft_ready":
                            break
                        await asyncio.sleep(0.05)
                    assert state["stage"]["kind"] == "draft_ready", state
                    assert len(authors) == 1
                    assert reviews == publications == ["c" * 40]
                    assert state["command_ids"] == [command["body"]["command_id"]]
                    await handle.terminate("Owned integration test cleanup")

    asyncio.run(exercise())


def test_cancellation_waits_for_activity_confirmed_stop():
    async def exercise():
        entered = asyncio.Event()
        stopping = asyncio.Event()
        stopped = asyncio.Event()

        @activity.defn(name="birbcrew.author_goal.v1")
        async def author(value: dict):
            entered.set()
            try:
                while True:
                    activity.heartbeat()
                    await asyncio.sleep(0.05)
            except asyncio.CancelledError:
                stopping.set()
                await stopped.wait()
                return {"status": "cancelled", "reason": "confirmed_fixture_stop"}

        async with await WorkflowEnvironment.start_local(
            dev_server_existing_path=os.environ.get(
                "TEMPORAL_TEST_SERVER", "/opt/homebrew/bin/temporal"
            ),
            dev_server_log_level="error",
        ) as environment:
            queue = "cancel-" + str(uuid4())
            async with Worker(
                environment.client,
                task_queue=queue,
                workflows=[DeliveryWorkflow],
                activities=[author],
                max_heartbeat_throttle_interval=timedelta(milliseconds=50),
                default_heartbeat_throttle_interval=timedelta(milliseconds=50),
            ):
                handle = await environment.client.start_workflow(
                    DeliveryWorkflow.run,
                    {
                        "offer": offer().model_dump(mode="json"),
                        "owner_principal": "owner",
                        "activity_task_queue": queue,
                        "workflow_id": queue,
                    },
                    id=queue,
                    task_queue=queue,
                )
                state = await handle.query(DeliveryWorkflow.snapshot)
                conversation = str(uuid4())

                def command(action, state):
                    return {
                        "op": "command",
                        "principal": "owner",
                        "conversation_id": conversation,
                        "body": {
                            "command_id": str(uuid4()),
                            "action": action,
                            "expected_revision": state["revision"],
                            "offer_sha256": state["offer_sha256"],
                        },
                    }

                assert await handle.execute_update(
                    DeliveryWorkflow.command, command("approve", state)
                ) == {"ok": True}
                await asyncio.wait_for(entered.wait(), 10)
                state = await handle.query(DeliveryWorkflow.snapshot)
                assert await handle.execute_update(
                    DeliveryWorkflow.command, command("cancel", state)
                ) == {"ok": True}
                await asyncio.wait_for(stopping.wait(), 10)
                state = await handle.query(DeliveryWorkflow.snapshot)
                assert state["cancellation"] == "requested"
                assert state["stage"]["kind"] == "authoring"
                stopped.set()
                for _ in range(100):
                    state = await handle.query(DeliveryWorkflow.snapshot)
                    if state["stage"]["kind"] != "authoring":
                        break
                    await asyncio.sleep(0.05)
                assert state["stage"]["kind"] == "cancelled", state
                assert state["cancellation"] == "acknowledged"
                await handle.terminate("Owned integration test cleanup")

    asyncio.run(exercise())
