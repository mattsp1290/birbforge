"""Run one installed deployment operation under the target queue's existing owner."""

import asyncio
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

with workflow.unsafe.imports_passed_through():
    from verification.kubernetes import closure_reason, digest


NO_RETRY = RetryPolicy(maximum_attempts=1)
LOOKUP_BACKOFF = (1, 5, 15, 30, 60)


async def ownership_activity(name: str, body: dict) -> dict | None:
    try:
        return await workflow.execute_activity(
            name,
            body,
            task_queue=workflow.info().task_queue,
            start_to_close_timeout=timedelta(seconds=15),
            schedule_to_close_timeout=timedelta(seconds=20),
            retry_policy=NO_RETRY,
        )
    except ActivityError:
        return None


async def recover_result(queue, row):
    record = row["deployment"]
    if record["result"] is not None:
        return
    invocation = queue.config.deployment.invocation
    reply = await ownership_activity("birbforge_deployment_result_v1", invocation)
    status = "unavailable"
    if isinstance(reply, dict):
        if reply == {"status": "absent"} or reply == {"status": "pending"}:
            status = reply["status"]
        elif reply.get("status") == "recorded":
            result = reply.get("result")
            if (
                isinstance(result, dict)
                and result.get("invocation") == invocation
                and result.get("operation_id") == record["operation_id"]
                and result.get("result_sha256")
                == digest(
                    {
                        key: value
                        for key, value in result.items()
                        if key != "result_sha256"
                    }
                )
            ):
                record["result"] = result
                status = "recorded"
    if record["lookup_status"] != status:
        record["lookup_status"] = status
        queue.touch(row)


async def dispatch_deployment(queue, row):
    profile = queue.config.deployment
    if row["closure_trigger"] is None and workflow.now() < profile.deadline:
        owner = await ownership_activity(
            "birbforge_deployment_observe_v1", profile.invocation
        )
    else:
        owner = None

    remaining = profile.deadline - workflow.now()
    if (
        row["closure_trigger"] is None
        and remaining > timedelta(0)
        and owner == {"state": "active"}
    ):
        timeout = timedelta(seconds=queue.config.activity_timeout_seconds)
        queue.active = workflow.start_activity(
            "birbverify_deployment_account_auth_v1",
            profile.invocation,
            activity_id=row["deployment"]["operation_id"],
            task_queue=profile.verifier_task_queue,
            schedule_to_close_timeout=min(remaining, timeout + timedelta(seconds=5)),
            start_to_close_timeout=min(remaining, timeout),
            heartbeat_timeout=min(remaining, timedelta(seconds=5)),
            cancellation_type=workflow.ActivityCancellationType.TRY_CANCEL,
            retry_policy=NO_RETRY,
        )
        try:
            await queue.active
        except (ActivityError, asyncio.CancelledError):
            pass
        finally:
            queue.active = None

    # Seal first on cancellation. Otherwise recover the journal even on reply loss.
    if row["closure_trigger"] is None and workflow.now() < profile.deadline:
        await recover_result(queue, row)
    if row["closure_trigger"] is None:
        if workflow.now() >= profile.deadline:
            row["closure_trigger"] = "deadline"
        elif owner == {"state": "active"} and row["deployment"]["result"] is not None:
            row["closure_trigger"] = "complete"
        else:
            row["closure_trigger"] = "execution_unknown"
    row["phase"] = "closing"
    queue.touch(row)


async def reconcile_deployment(queue, row):
    profile = queue.config.deployment
    record = row["deployment"]
    if record["seal_observation"] is None:
        command = {
            **profile.invocation,
            "reason": closure_reason(row["closure_trigger"]),
        }
        progress = await ownership_activity("birbforge_deployment_close_v1", command)
        target = queue.config.authority.target
        expected = {
            **command,
            "schema_version": "birbverify.deployment.closure.progress.v1",
            "installation_sha256": queue.config.authority.installation_sha256,
            "cluster_uid": target.cluster_uid,
            "namespace_uid": target.namespace_uid,
        }
        if (
            isinstance(progress, dict)
            and all(progress.get(key) == value for key, value in expected.items())
            and progress.get("release_authorized") is False
            and progress.get("state") in ("sealed", "quarantined")
        ):
            record["seal_observation"] = progress
            row["phase"] = "retained"
            row["observation_error"] = None
            queue.touch(row)
        elif row["observation_error"] != "deployment_closure_unconfirmed":
            row["observation_error"] = "deployment_closure_unconfirmed"
            queue.touch(row)

    await recover_result(queue, row)
    if record["seal_observation"] is not None and (
        record["lookup_status"] == "recorded"
        or (
            record["seal_observation"]["account_activity_state"] == "absent"
            and record["lookup_status"] == "absent"
        )
    ):
        await queue.wait_for_change()
    else:
        delay = LOOKUP_BACKOFF[row["close_attempts"]]
        row["close_attempts"] = min(row["close_attempts"] + 1, len(LOOKUP_BACKOFF) - 1)
        await workflow.sleep(delay)
