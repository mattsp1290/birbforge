import asyncio

from birbverify.contract import digest

from verification.kubernetes import KubernetesAuthority, KubernetesQueueConfig


def config():
    return KubernetesQueueConfig(
        authority=KubernetesAuthority(
            target={
                "target_id": "target",
                "cluster_uid": "cluster",
                "namespace": "app",
                "namespace_uid": "namespace",
            },
            candidate_revision="a" * 40,
            authored_revision="a" * 40,
            beans_issue="birbforge-yrnb",
            producer_revision="b" * 40,
            installation_sha256="f" * 64,
            policy_revision="c" * 40,
            plan_sha256=digest(
                {"spec": {"containers": [{"name": "app", "image": "old"}]}}
            ),
            image="example/app@sha256:" + "e" * 64,
        ),
        activity_task_queue="producer",
        continue_threshold=4,
    )


def admission(identity="r1", **changes):
    body = {
        "request_id": identity,
        "idempotency_key": identity,
        "candidate_revision": "a" * 40,
        "authored_revision": "a" * 40,
        "beans_issue": "birbforge-yrnb",
        "approved_plan_sha256": digest(
            {"spec": {"containers": [{"name": "app", "image": "old"}]}}
        ),
    }
    body.update(changes)
    return {
        "principal": "owner",
        "command": {"op": "admit", "conversation_id": "chat", "body": body},
    }


def _revision_command(op, identity, revision, command_id):
    return {
        "principal": "owner",
        "command": {
            "op": op,
            "conversation_id": "chat",
            "body": {
                "request_id": identity,
                "expected_revision": revision,
                "command_id": command_id,
            },
        },
    }


def cancellation(identity, revision, command_id="cancel-1"):
    return _revision_command("cancel", identity, revision, command_id)


def completion(identity, revision, command_id="complete-1"):
    return _revision_command("complete", identity, revision, command_id)


async def until(handle, predicate):
    from verification.kubernetes_workflow import KubernetesQueue

    async with asyncio.timeout(30):
        while True:
            state = await handle.query(KubernetesQueue.snapshot)
            if predicate(state):
                return state
            await asyncio.sleep(0.1)
