import asyncio
import importlib.util
import os
import sys
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from temporalio import activity
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Replayer, UnsandboxedWorkflowRunner, Worker
from test_workflow import offer, review

from delivery.workflow import DeliveryWorkflow


def test_legacy_inconclusive_workflow_upgrades_and_retries_without_author():
    path = Path(__file__).parent / "fixtures/workflow_before_review_retry.py"
    spec = importlib.util.spec_from_file_location("legacy_delivery_workflow", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    legacy = module.DeliveryWorkflow

    async def exercise():
        authors = []
        reviews = []
        publications = []

        @activity.defn(name="birbcrew.author_goal.v1")
        async def author(value: dict):
            authors.append(value)
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
            reviews.append(value)
            receipt = review()
            if value.get("review_attempt", 0) == 0:
                receipt["disposition"] = "inconclusive"
            else:
                receipt["review_attempt"] = value["review_attempt"]
            return receipt

        @activity.defn(name="birbcrew.publish_draft.v1")
        async def publish(value: dict):
            publications.append(value)
            return {
                "status": "draft_ready",
                "repository_id": value["candidate"]["repository_id"],
                "head_commit": value["candidate"]["head_commit"],
                "base_branch": "main",
                "provider": "github",
                "number": 42,
                "url": "https://github.com/mattsp1290/birbforge/pull/42",
                "draft": True,
            }

        async with await WorkflowEnvironment.start_local(
            dev_server_existing_path=os.environ.get(
                "TEMPORAL_TEST_SERVER", "/opt/homebrew/bin/temporal"
            ),
            dev_server_log_level="error",
        ) as environment:
            queue = "review-upgrade-" + str(uuid4())
            options = {
                "workflow_runner": UnsandboxedWorkflowRunner(),
                "sticky_queue_schedule_to_start_timeout": timedelta(seconds=1),
            }
            async with Worker(
                environment.client,
                task_queue=queue + "-activities",
                activities=[author, independent_review, publish],
            ):
                async with Worker(
                    environment.client, task_queue=queue, workflows=[legacy], **options
                ):
                    handle = await environment.client.start_workflow(
                        legacy.run,
                        {
                            "offer": offer().model_dump(mode="json"),
                            "owner_principal": "owner",
                            "activity_task_queue": queue + "-activities",
                            "workflow_id": queue,
                        },
                        id=queue,
                        task_queue=queue,
                    )
                    state = await handle.query("snapshot")
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
                        "command", command("approve", state)
                    ) == {"ok": True}
                    for _ in range(100):
                        state = await handle.query("snapshot")
                        if state["stage"]["kind"] == "uncertain":
                            break
                        await asyncio.sleep(0.05)
                    assert state["stage"] == {
                        "kind": "uncertain",
                        "reason": "review_inconclusive",
                    }
                    history = await handle.fetch_history()
                await Replayer(
                    workflows=[DeliveryWorkflow],
                    workflow_runner=UnsandboxedWorkflowRunner(),
                ).replay_workflow(history)
                retry = command("retry_review", state)
                async with Worker(
                    environment.client,
                    task_queue=queue,
                    workflows=[DeliveryWorkflow],
                    **options,
                ):
                    assert await handle.execute_update("command", retry) == {"ok": True}
                    assert await handle.execute_update("command", retry) == {"ok": True}
                    for _ in range(100):
                        state = await handle.query("snapshot")
                        if state["stage"]["kind"] == "draft_ready":
                            break
                        await asyncio.sleep(0.05)
                    assert state["stage"]["kind"] == "draft_ready", state
                async with Worker(
                    environment.client,
                    task_queue=queue,
                    workflows=[DeliveryWorkflow],
                    **options,
                ):
                    assert await handle.execute_update("command", retry) == {"ok": True}
                    state = await handle.query("snapshot")
                    assert state["stage"]["kind"] == "draft_ready"
                    assert len(authors) == 1
                    assert [item.get("review_attempt", 0) for item in reviews] == [0, 1]
                    assert len(publications) == 1
                    assert (
                        publications[0]["review_attempt"]
                        == publications[0]["review"]["review_attempt"]
                        == 1
                    )
                    assert (
                        reviews[0]["candidate"]
                        == reviews[1]["candidate"]
                        == publications[0]["candidate"]
                    )
                    assert reviews[0]["approved_goal"] == reviews[1]["approved_goal"]
                    await handle.terminate("Owned review-upgrade fixture cleanup")

    asyncio.run(exercise())
