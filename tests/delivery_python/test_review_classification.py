import asyncio
import importlib.util
import os
import sys
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from birbcrew.execution.contract import digest
from temporalio import activity
from temporalio.exceptions import ApplicationError
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Replayer, UnsandboxedWorkflowRunner, Worker
from test_workflow import offer, review

from delivery.workflow import DeliveryWorkflow


@pytest.mark.parametrize(
    "outcome",
    [
        "approved",
        "changes_requested",
        "denied",
        "check_failed",
        "dispatch_failed",
        "publication_failed",
        "wrong_binding",
    ],
)
def test_legacy_classification_survives_race_lost_reply_and_worker_restart(outcome):
    path = Path(__file__).parent / "fixtures/workflow_before_classification.py"
    spec = importlib.util.spec_from_file_location("before_classification", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    legacy = module.DeliveryWorkflow

    async def exercise():
        authors, reviews, checks, publications = [], [], [], []
        checking = asyncio.Event()
        release = asyncio.Event()

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
            attempt = value.get("review_attempt", 0)
            if attempt and outcome == "dispatch_failed":
                raise ApplicationError(
                    "evidence changed before dispatch", non_retryable=True
                )
            receipt = review()
            receipt["disposition"] = (
                "changes_requested"
                if not attempt
                else "approved"
                if outcome == "publication_failed"
                else outcome
            )
            if attempt:
                receipt["review_attempt"] = attempt
            return receipt

        @activity.defn(name="birbcrew.check_review_recovery.v1")
        async def check(value: dict):
            checks.append(value)
            checking.set()
            await release.wait()
            if outcome == "check_failed":
                raise ApplicationError("evidence unavailable", non_retryable=True)
            if outcome == "denied":
                return {"kind": "not_eligible"}
            previous = value["previous"]
            return {
                "kind": "legacy_approval_misclassified",
                "operation_id": previous["operation_id"],
                "candidate_commit": "f" * 40
                if outcome == "wrong_binding"
                else previous["candidate"]["head_commit"],
                "review_attempt": previous.get("review_attempt", 0),
                "receipt_sha256": digest(value["receipt"]),
                "evidence_sha256": value["receipt"]["findings_digest"],
            }

        @activity.defn(name="birbcrew.publish_draft.v1")
        async def publish(value: dict):
            publications.append(value)
            if outcome == "publication_failed":
                raise ApplicationError("publication reply lost", non_retryable=True)
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
            queue = "classification-" + str(uuid4())
            options = {
                "workflow_runner": UnsandboxedWorkflowRunner(),
                "sticky_queue_schedule_to_start_timeout": timedelta(seconds=1),
            }
            async with Worker(
                environment.client,
                task_queue=queue + "-activities",
                activities=[author, independent_review, check, publish],
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

                    async def wait_for(predicate):
                        for _ in range(200):
                            state = await handle.query("snapshot")
                            if predicate(state):
                                return state
                            await asyncio.sleep(0.025)
                        raise AssertionError(state)

                    state = await handle.query("snapshot")
                    assert await handle.execute_update(
                        "command", command("approve", state)
                    ) == {"ok": True}
                    state = await wait_for(
                        lambda s: s["stage"]["kind"] == "changes_requested"
                    )
                    original = state["stage"]["review"]
                    history = await handle.fetch_history()
                await Replayer(
                    workflows=[DeliveryWorkflow],
                    workflow_runner=UnsandboxedWorkflowRunner(),
                ).replay_workflow(history)
                first, second = (
                    command("retry_review", state),
                    command("retry_review", state),
                )
                async with Worker(
                    environment.client,
                    task_queue=queue,
                    workflows=[DeliveryWorkflow],
                    **options,
                ):
                    responses = await asyncio.gather(
                        handle.execute_update("command", first),
                        handle.execute_update("command", second),
                    )
                    assert sorted(r["ok"] for r in responses) == [False, True]
                    accepted = first if responses[0]["ok"] else second
                    await asyncio.wait_for(checking.wait(), 10)
                    assert await handle.execute_update("command", accepted) == {
                        "ok": True
                    }
                    pending = await handle.query("snapshot")
                    assert pending["stage"]["classification_check"] == "checking"
                    assert pending["stage"]["review"] == original
                    assert not (
                        await handle.execute_update(
                            "command", command("cancel", pending)
                        )
                    )["ok"]
                    assert not (
                        await handle.execute_update(
                            "command", command("retry_review", pending)
                        )
                    )["ok"]
                async with Worker(
                    environment.client,
                    task_queue=queue,
                    workflows=[DeliveryWorkflow],
                    **options,
                ):
                    assert await handle.execute_update("command", accepted) == {
                        "ok": True
                    }
                    release.set()
                    final = await wait_for(
                        lambda s: (
                            s["stage"].get("classification_check") != "checking"
                            and s["stage"]["kind"] not in {"reviewing", "publishing"}
                        )
                    )
                    if outcome == "approved":
                        assert final["stage"]["kind"] == "draft_ready"
                        assert (
                            publications[0]["review_attempt"]
                            == publications[0]["review"]["review_attempt"]
                            == 1
                        )
                    elif outcome == "changes_requested":
                        assert final["stage"]["kind"] == "changes_requested"
                        assert final["stage"]["review"]["review_attempt"] == 1
                    elif outcome in {"dispatch_failed", "publication_failed"}:
                        assert final["stage"] == {
                            "kind": "uncertain",
                            "reason": "review_recovery_requires_confirmation",
                        }
                        assert not (
                            await handle.execute_update(
                                "command", command("retry_review", final)
                            )
                        )["ok"]
                    else:
                        assert final["stage"]["review"] == original
                        assert final["stage"]["kind"] == "changes_requested"
                        assert final["stage"]["classification_check"] == (
                            "not_eligible"
                            if outcome == "denied"
                            else "evidence_unconfirmed"
                        )
                    assert len(authors) == 1 and len(checks) == 1
                    assert len(reviews) == (
                        2
                        if outcome
                        in {
                            "approved",
                            "changes_requested",
                            "dispatch_failed",
                            "publication_failed",
                        }
                        else 1
                    )
                    assert len(publications) == (
                        1 if outcome in {"approved", "publication_failed"} else 0
                    )
                    assert checks[0]["receipt"] == original
                    assert checks[0]["previous"]["candidate"] == reviews[0]["candidate"]
                    final_history = await handle.fetch_history()
                    await Replayer(
                        workflows=[DeliveryWorkflow],
                        workflow_runner=UnsandboxedWorkflowRunner(),
                    ).replay_workflow(final_history)
                    await handle.terminate("Owned classification fixture cleanup")

    asyncio.run(exercise())
