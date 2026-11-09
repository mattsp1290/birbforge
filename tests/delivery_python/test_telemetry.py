import asyncio
import json
import logging
import os
from uuid import uuid4

from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Replayer, Worker
from test_temporal import (
    test_cancellation_waits_for_activity_confirmed_stop as cancellation_journey,
)
from test_temporal import (
    test_delivery_survives_workflow_worker_restart_without_second_author as delivery_journey,
)
from test_workflow import offer

from delivery.__main__ import DeliveryLogFormatter, configure_workflow_logging
from delivery.workflow import DeliveryWorkflow


def transitions(caplog):
    formatter = DeliveryLogFormatter()
    return [
        json.loads(formatter.format(record))
        for record in caplog.records
        if hasattr(record, "delivery_transition")
    ]


def test_worker_logging_preserves_root_handlers_and_does_not_duplicate(capsys):
    logger = logging.getLogger("temporalio.workflow")
    previous = (logger.handlers, logger.level, logger.propagate)
    root_handlers = list(logging.getLogger().handlers)
    root_level = logging.getLogger().level
    event = {"event": "delivery_transition", "revision": 1}
    try:
        configure_workflow_logging()
        configure_workflow_logging()
        logger.info("delivery_transition", extra={"delivery_transition": event})
        assert capsys.readouterr().err.splitlines() == [
            json.dumps(event, separators=(",", ":"))
        ]
        assert logging.getLogger().handlers == root_handlers
        assert logging.getLogger().level == root_level
    finally:
        logger.handlers, logger.level, logger.propagate = previous


def test_delivery_logs_are_correlated_and_not_repeated_after_restart(caplog):
    caplog.set_level(logging.INFO, logger="temporalio.workflow")
    delivery_journey()
    events = transitions(caplog)
    assert [event["stage"] for event in events] == [
        "authoring",
        "reviewing",
        "publishing",
        "draft_ready",
    ]
    assert [event["revision"] for event in events] == [1, 2, 3, 4]
    assert len({event["workflow_id"] for event in events}) == 1
    assert len({event["delivery_id"] for event in events}) == 1
    assert len({event["conversation_id"] for event in events}) == 1
    for event in events:
        assert set(event) == {
            "event",
            "workflow_id",
            "delivery_id",
            "conversation_id",
            "goal_record_id",
            "revision",
            "stage",
            "cancellation",
        }
        assert event["event"] == "delivery_transition"
        assert event["goal_record_id"] == "goal-one"
        assert event["delivery_id"] and event["conversation_id"]
        assert event["cancellation"] == "none"


def test_cancel_requested_and_acknowledged_are_separate_logs(caplog):
    caplog.set_level(logging.INFO, logger="temporalio.workflow")
    cancellation_journey()
    events = transitions(caplog)
    assert [(event["stage"], event["cancellation"]) for event in events] == [
        ("authoring", "none"),
        ("authoring", "requested"),
        ("cancelled", "acknowledged"),
    ]
    assert [event["revision"] for event in events] == [1, 2, 3]


def test_queries_and_replay_emit_no_transition_logs(caplog):
    caplog.set_level(logging.INFO, logger="temporalio.workflow")

    async def exercise():
        async with await WorkflowEnvironment.start_local(
            dev_server_existing_path=os.environ.get(
                "TEMPORAL_TEST_SERVER", "/opt/homebrew/bin/temporal"
            ),
            dev_server_log_level="error",
        ) as environment:
            identity = "telemetry-" + str(uuid4())
            async with Worker(
                environment.client, task_queue=identity, workflows=[DeliveryWorkflow]
            ):
                handle = await environment.client.start_workflow(
                    DeliveryWorkflow.run,
                    {
                        "offer": offer().model_dump(mode="json"),
                        "owner_principal": "owner",
                        "activity_task_queue": identity,
                        "workflow_id": identity,
                    },
                    id=identity,
                    task_queue=identity,
                )
                state = await handle.query(DeliveryWorkflow.snapshot)
                intent = {
                    "op": "command",
                    "principal": "owner",
                    "conversation_id": str(uuid4()),
                    "body": {
                        "command_id": str(uuid4()),
                        "action": "reject",
                        "expected_revision": state["revision"],
                        "offer_sha256": state["offer_sha256"],
                    },
                }
                assert await handle.execute_update(
                    DeliveryWorkflow.command, intent
                ) == {"ok": True}
                assert await handle.execute_update(
                    DeliveryWorkflow.command, intent
                ) == {"ok": True}
                for _ in range(3):
                    assert (await handle.query(DeliveryWorkflow.snapshot))["stage"][
                        "kind"
                    ] == "rejected"
                events = transitions(caplog)
                assert len(events) == 1
                assert events[0]["delivery_id"] is None
                assert events[0]["conversation_id"] == intent["conversation_id"]
                assert events[0]["workflow_id"] == identity
                await handle.terminate("Owned telemetry test cleanup")
                history = await handle.fetch_history()
            caplog.clear()
            await Replayer(workflows=[DeliveryWorkflow]).replay_workflow(history)
            assert transitions(caplog) == []

    asyncio.run(exercise())
