"""Read the installed deployment's eligibility status using a query-only identity."""

import argparse
import asyncio
import json
from datetime import timedelta
from pathlib import Path
from typing import Literal

from birbverify.contract import Id, Record, RequestId, Sha
from temporalio.exceptions import TemporalError
from temporalio.service import RPCError

from verification.kubernetes import KubernetesConfig, check_installation
from verification.temporal_transport import connect


class Invocation(Record):
    request_id: RequestId
    request_sha256: Sha
    epoch: Id


class EvidenceStatus(Record):
    schema_version: Literal["birbforge.deployment.evidence-status.v1"]
    invocation: Invocation
    operation_id: Sha
    result_sha256: Sha | None
    seal_observation_sha256: Sha | None
    eligible: Literal[False]
    reason: Literal["release_not_authorized"]


async def retrieve(config: KubernetesConfig) -> EvidenceStatus:
    profile = config.queue.deployment
    if profile is None or config.temporal_tls is None:
        raise ValueError("authenticated_deployment_required")
    client = await connect(config)
    queue = client.get_workflow_handle(config.queue.authority.workflow_id)
    timeout = timedelta(seconds=10)
    installed = await queue.query("installation", rpc_timeout=timeout)
    check_installation(config, installed)
    raw = await queue.query(
        "deployment_evidence_v1", profile.invocation, rpc_timeout=timeout
    )
    if not isinstance(raw, dict) or raw.get("eligible") is not False:
        raise ValueError("invalid_deployment_status")
    status = EvidenceStatus.model_validate(raw, strict=True)
    if (
        status.invocation.model_dump() != profile.invocation
        or status.operation_id != profile.operation_id
    ):
        raise ValueError("deployment_status_mismatch")
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "config", type=Path, help="trusted query-only installation config"
    )
    args = parser.parse_args()
    try:
        config = KubernetesConfig.model_validate_json(args.config.read_bytes())
        status = asyncio.run(asyncio.wait_for(retrieve(config), timeout=25))
    except (ValueError, OSError, RuntimeError, TemporalError, RPCError, TimeoutError):
        print(json.dumps({"eligible": False, "reason": "status_unavailable"}))
        return 2
    print(status.model_dump_json())
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
