import asyncio
from hashlib import sha256
from unittest.mock import patch
from uuid import uuid4

import pytest
from birbcrew.execution.contract import GoalOffer

from delivery.workflow import DeliveryWorkflow


def offer():
    text = "Document one restart procedure."
    return GoalOffer(
        offer_id="pilot-one",
        title="Document restart",
        goal_text=text,
        goal_ref={
            "project": "birbforge",
            "record_id": "goal-one",
            "revision": "1",
            "content_sha256": sha256(text.encode()).hexdigest(),
        },
        repository_id="mattsp1290/birbforge",
        base_commit="a" * 40,
        policy_revision="b" * 64,
        allowed_paths=("docs/operator.md",),
        acceptance_id="docs-check",
    )


def installed():
    return DeliveryWorkflow(
        {
            "offer": offer().model_dump(mode="json"),
            "owner_principal": "owner",
            "activity_task_queue": "execution",
            "workflow_id": "installed-pilot",
        }
    )


def command(instance, action="approve", principal="owner", conversation=None, **body):
    return {
        "op": "command",
        "principal": principal,
        "conversation_id": conversation or str(uuid4()),
        "body": {
            "command_id": str(uuid4()),
            "expected_revision": instance.revision,
            "offer_sha256": instance.offer_digest,
            "action": action,
            **body,
        },
    }


def approve(instance):
    intent = command(instance)
    with patch("delivery.workflow.workflow.uuid4", uuid4):
        assert instance.command(intent) == {"ok": True}
    return intent


def candidate(instance):
    return {
        "repository_id": instance.offer.repository_id,
        "base_commit": instance.offer.base_commit,
        "head_commit": "c" * 40,
        "branch": "birbforge/pilot/" + str(instance.approved.delivery_id),
        "changed_paths": ["docs/operator.md"],
        "acceptance": {
            "acceptance_id": "docs-check",
            "outcome": "passed",
            "evidence_digest": "d" * 64,
            "evidence_ref": "evidence/one",
        },
    }


def review(head="c" * 40):
    return {
        "candidate_commit": head,
        "reviewer": "claude-cli",
        "disposition": "approved",
        "findings_digest": "e" * 64,
        "evidence_ref": "review/one",
    }


def test_approval_replay_conflicts_and_owner_binding():
    instance = installed()
    assert instance.command(command(instance, principal="stranger"))["status"] == 403
    assert instance.command(command(instance, offer_sha256="f" * 64))["status"] == 409
    intent = approve(instance)
    assert instance.command(intent) == {"ok": True}
    assert instance.revision == 1
    changed = {**intent, "body": {**intent["body"], "action": "reject"}}
    assert instance.command(changed)["code"] == "command_conflict"
    assert instance.command(command(instance, "cancel"))["code"] == "bound_elsewhere"
    assert instance.command(
        command(instance, conversation=intent["conversation_id"])
    ) == {"ok": True}
    assert instance.revision == 1
    restored = installed()
    with patch("delivery.workflow.workflow.uuid4", uuid4):
        restored.command(intent)
    assert restored.approved.delivery_id == instance.approved.delivery_id


def test_cancel_before_dispatch_never_calls_executor():
    instance = installed()
    intent = approve(instance)
    assert instance.command(
        command(instance, "cancel", conversation=intent["conversation_id"])
    )["ok"]
    asyncio.run(instance.deliver())
    assert instance.stage["kind"] == "cancelled"
    assert instance.cancellation == "acknowledged"


@pytest.mark.parametrize("mismatch", ["candidate", "review", "publication"])
def test_receipts_bind_exact_approved_source(mismatch):
    instance = installed()
    approve(instance)
    calls = []

    async def activity(name, value):
        calls.append(name)
        if "author" in name:
            item = candidate(instance)
            if mismatch == "candidate":
                item["base_commit"] = "f" * 40
            return {"status": "candidate", "candidate": item}
        if "review" in name:
            return review("f" * 40 if mismatch == "review" else "c" * 40)
        return {
            "status": "draft_ready",
            "repository_id": instance.offer.repository_id,
            "head_commit": "f" * 40,
            "base_branch": "main",
            "provider": "github",
            "number": 1,
            "url": "https://github.com/mattsp1290/birbforge/pull/1",
            "draft": True,
        }

    instance.activity = activity
    with pytest.raises(ValueError, match="binding_mismatch"):
        asyncio.run(instance.deliver())
    assert len(calls) == {"candidate": 1, "review": 2, "publication": 3}[mismatch]


@pytest.mark.parametrize("outcome", ["changes_requested", "cancel", "inconclusive"])
def test_review_findings_and_cancellation_prevent_publication(outcome):
    instance = installed()
    approve(instance)
    calls = []

    async def activity(name, value):
        calls.append(name)
        if "author" in name:
            return {"status": "candidate", "candidate": candidate(instance)}
        receipt = review()
        if outcome == "cancel":
            instance.cancellation = "requested"
        else:
            receipt["disposition"] = outcome
        return receipt

    instance.activity = activity
    asyncio.run(instance.deliver())
    assert len(calls) == 2
    assert instance.snapshot()["stage"]["kind"] == (
        "changes_requested" if outcome == "changes_requested" else "uncertain"
    )


def test_observation_is_read_only_and_cancel_does_not_claim_terminal():
    instance = installed()
    intent = approve(instance)
    initial = instance.snapshot()
    assert instance.snapshot() == initial
    instance.command(
        command(instance, "cancel", conversation=intent["conversation_id"])
    )
    assert instance.snapshot()["cancellation"] == "requested"
    assert instance.stage["kind"] == "authoring"


def test_explicit_review_retry_is_idempotent_and_never_reauthors():
    instance = installed()
    approved = approve(instance)
    calls = []

    async def activity(name, value):
        calls.append((name, value.model_dump(mode="json")))
        if "author" in name:
            return {"status": "candidate", "candidate": candidate(instance)}
        if "review" in name:
            receipt = review()
            receipt["disposition"] = (
                "inconclusive" if value.review_attempt == 0 else "approved"
            )
            if value.review_attempt:
                receipt["review_attempt"] = value.review_attempt
            return receipt
        return {
            "status": "draft_ready",
            "repository_id": instance.offer.repository_id,
            "head_commit": "c" * 40,
            "base_branch": "main",
            "provider": "github",
            "number": 42,
            "url": "https://github.com/mattsp1290/birbforge/pull/42",
            "draft": True,
        }

    instance.activity = activity
    asyncio.run(instance.deliver())
    assert instance.stage == {"kind": "uncertain", "reason": "review_inconclusive"}
    retry = command(instance, "retry_review", conversation=approved["conversation_id"])
    stale = {**retry, "body": {**retry["body"], "expected_revision": 0}}
    assert instance.command(stale)["code"] == "stale_offer_or_revision"
    assert instance.command(retry) == {"ok": True}
    assert instance.command(retry) == {"ok": True}
    assert instance.review_attempt == 1
    assert (
        instance.command(
            command(instance, "retry_review", conversation=approved["conversation_id"])
        )["code"]
        == "review_not_retryable"
    )
    from birbcrew.execution.contract import ExecutionInput

    asyncio.run(
        instance.review_and_publish(
            ExecutionInput(
                operation_id=instance.approved.delivery_id,
                approved_goal=instance.approved,
            ),
            instance.candidate,
        )
    )
    assert [name for name, _ in calls] == [
        "birbcrew.author_goal.v1",
        "birbcrew.review_candidate.v1",
        "birbcrew.review_candidate.v1",
        "birbcrew.publish_draft.v1",
    ]
    assert "review_attempt" not in calls[1][1]
    assert calls[2][1]["review_attempt"] == calls[3][1]["review_attempt"] == 1
    assert calls[2][1]["candidate"] == calls[1][1]["candidate"]
    assert instance.stage["kind"] == "draft_ready"


def test_substantive_review_cannot_be_retried():
    instance = installed()
    approved = approve(instance)
    instance.transition(
        {
            "kind": "changes_requested",
            "candidate": candidate(instance),
            "review": review(),
        }
    )
    assert (
        instance.command(
            command(instance, "retry_review", conversation=approved["conversation_id"])
        )["code"]
        == "review_not_retryable"
    )


def test_interrupted_review_never_offers_or_accepts_retry():
    instance = installed()
    approved = approve(instance)
    calls = []

    async def activity(name, value):
        calls.append(name)
        if "author" in name:
            return {"status": "candidate", "candidate": candidate(instance)}
        return {
            **review(),
            "disposition": "inconclusive",
            "findings_digest": "0" * 64,
            "evidence_ref": "execution/old/review-interrupted",
        }

    instance.activity = activity
    asyncio.run(instance.deliver())
    assert instance.snapshot()["stage"] == {
        "kind": "uncertain",
        "reason": "review_interrupted_requires_recovery",
    }
    assert instance.command(
        command(instance, "retry_review", conversation=approved["conversation_id"])
    )["code"] == "review_not_retryable"
    assert not instance.retry_review_requested
    assert instance.review_attempt == 0
    assert calls == ["birbcrew.author_goal.v1", "birbcrew.review_candidate.v1"]
