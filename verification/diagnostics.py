import fcntl
import json
from datetime import UTC, datetime

EVENTS = frozenset(
    {
        "admitted",
        "queue_wait",
        "cancellation_requested",
        "worker_uncertain",
        "manifest_recorded",
        "cleanup_complete",
        "manifest_conflict",
        "evidence_failure",
    }
)
MAX_LOG_BYTES = 65536


def event_json(event, *, request_id, attempt_id=None, source_id, timestamp):
    if event not in EVENTS:
        raise ValueError("unknown_diagnostic_event")
    return json.dumps(
        {
            "service": "birbforge-verification",
            "env": "fixture",
            "version": "birbverify.v1",
            "timestamp": timestamp,
            "status": "warning"
            if event in {"worker_uncertain", "evidence_failure", "manifest_conflict"}
            else "info",
            "message": event,
            "request_id": request_id,
            "attempt_id": attempt_id,
            "correlation_id": request_id,
            "source_id": source_id,
        },
        separators=(",", ":"),
    )


def evidence_failure(root, request_id, attempt_id):
    line = (
        event_json(
            "evidence_failure",
            request_id=request_id,
            attempt_id=attempt_id,
            source_id="artifact_reader",
            timestamp=datetime.now(UTC).isoformat(),
        )
        + "\n"
    ).encode()
    try:
        with (root / "verification-diagnostics.jsonl").open("a+b") as output:
            fcntl.flock(output, fcntl.LOCK_EX)
            output.seek(0)
            for previous in output:
                record = json.loads(previous)
                if (
                    record["message"] == "evidence_failure"
                    and record["request_id"] == request_id
                ):
                    return
            output.seek(0, 2)
            if output.tell() + len(line) <= MAX_LOG_BYTES:
                output.write(line)
    except (OSError, ValueError):
        return
