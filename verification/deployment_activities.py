"""Coordinator access to the pinned deployment ownership journal."""

import asyncio
import json
import re
import ssl
from datetime import UTC, datetime
from http.client import HTTPException, HTTPSConnection

from birbverify.contract import digest
from birbverify.deployment_activity_contract import (
    ActivityInstallation,
    ActivityResult,
    Invocation,
)
from birbverify.deployment_http import strict_json
from birbverify.deployment_ownership import CloseCommand, ClosureProgress, Owner
from temporalio import activity
from temporalio.exceptions import ApplicationError

from verification.ownership_tls import OwnershipTLS

_POSTGRES = {"volume-permissions": "busybox", "postgresql": "postgres"}
_CONTAINERS = {
    "api": {"authz-state-init": "busybox", "authz-bootstrap": "api", "api": "api"},
    "ui": {"ui": "ui"},
    "openfga": {"migrate-database": "openfga", "openfga": "openfga"},
    "application-postgres": _POSTGRES,
    "openfga-postgres": _POSTGRES,
}
_INSTALLATION_OBLIGATIONS = {
    "writer_and_admission_integrity",
    "reconciliation_quiescence",
    "baseline_restoration",
}
_EFFECT_OBLIGATIONS = {
    "api_completion",
    "object_cleanup",
    "terminal_status",
    "route_cleanup",
    "stop_reconciliation",
    "restore_storage",
}


class DeploymentActivities:
    def __init__(
        self, installation: ActivityInstallation, epoch: str, transport: OwnershipTLS
    ):
        self.installation = installation
        self.invocation = Invocation(
            request_id=installation.request.request_id,
            request_sha256=digest(installation.request),
            epoch=epoch,
        ).model_dump(mode="json")
        self.operation_id = digest(
            {"invocation": self.invocation, "installation": digest(installation)}
        )
        self.transport = transport
        self.tls = ssl.create_default_context(cafile=transport.server_ca)
        self.tls.load_cert_chain(transport.client_cert, transport.client_key)

    def _post(self, path: str, payload: dict, limit: int) -> dict:
        conn = HTTPSConnection(
            self.transport.host, self.transport.port, context=self.tls, timeout=5
        )
        try:
            conn.connect()
            if (
                digest(conn.sock.getpeercert(binary_form=True))
                != self.transport.server_cert_sha256
            ):
                raise ValueError("ownership_server_pin_mismatch")
            conn.request(
                "POST", path, json.dumps(payload), {"Content-Type": "application/json"}
            )
            reply = conn.getresponse()
            lengths = reply.headers.get_all("Content-Length", [])
            if (
                reply.status != 200
                or reply.headers.get_all("Content-Type", []) != ["application/json"]
                or "Transfer-Encoding" in reply.headers
                or "Content-Encoding" in reply.headers
                or len(lengths) != 1
                or not re.fullmatch(r"[0-9]{1,7}", lengths[0])
                or not 1 <= int(lengths[0]) <= limit
            ):
                raise ValueError("ownership_response_invalid")
            value = strict_json(reply.read())
            if not isinstance(value, dict):
                raise TypeError("ownership_response_invalid")
            return value
        finally:
            conn.close()

    async def _call(self, raw, handle):
        try:
            if activity.info().workflow_id != self.installation.request.workflow_id:
                raise ValueError("unapproved_workflow")
            return await asyncio.to_thread(handle, raw)
        except (
            ValueError,
            OSError,
            HTTPException,
            TypeError,
            KeyError,
            RecursionError,
        ):
            # Temporal persists exception details, including validation inputs.
            failure = ApplicationError(
                "deployment_observation_unavailable", non_retryable=True
            )
        raise failure

    @activity.defn(name="birbforge_deployment_observe_v1")
    async def observe(self, raw: dict) -> dict:
        return await self._call(raw, self._observe)

    def _observe(self, raw: dict) -> dict:
        if raw != self.invocation:
            raise ValueError("unapproved_invocation")
        identity = {key: raw[key] for key in ("request_id", "request_sha256")}
        value = self._post("/v1/observe", identity, 4096)
        owner = Owner.model_validate(value)
        expected = self.invocation | {
            "schema_version": "birbverify.deployment.owner.v1",
            "installation_sha256": self.installation.request.installation_sha256,
            "state": owner.state,
        }
        if value != expected:
            raise ValueError("owner_identity_mismatch")
        return {"state": owner.state}

    @activity.defn(name="birbforge_deployment_result_v1")
    async def result(self, raw: dict) -> dict:
        return await self._call(raw, self._result)

    def _result(self, raw: dict) -> dict:
        if raw != self.invocation:
            raise ValueError("unapproved_invocation")
        reply = self._post("/v1/account-result", raw, 32768)
        if reply in ({"status": "absent"}, {"status": "pending"}):
            return reply
        if set(reply) != {"status", "result"} or reply["status"] != "recorded":
            raise ValueError("result_lookup_invalid")
        value = reply["result"]
        result = ActivityResult.model_validate(value)
        if (
            result.model_dump(mode="json") != value
            or result.invocation.model_dump(mode="json") != self.invocation
            or result.operation_id != self.operation_id
            or result.profile != self.installation.profile
            or not result.started_at <= result.completed_at <= datetime.now(UTC)
            or (
                result.outcome == "passed"
                and result.completed_at >= self.installation.request.deadline
            )
        ):
            raise ValueError("result_identity_or_time_mismatch")
        self._check_workloads(result)
        return {"status": "recorded", "result": value}

    def _check_workloads(self, result: ActivityResult) -> None:
        pins = {pod.workload: pod for pod in self.installation.pods}
        runtime_ids = set()
        for pod in result.workloads:
            pin = pins.pop(pod.workload, None)
            if (
                pin is None
                or pod.model_dump(exclude={"containers"}) != pin.model_dump()
            ):
                raise ValueError("pod_identity_mismatch")
            roles = _CONTAINERS[pod.workload]
            if (
                len(pod.containers) != len(roles)
                or {c.name: c.role for c in pod.containers} != roles
            ):
                raise ValueError("container_inventory_mismatch")
            for container in pod.containers:
                image = self.installation.request.images[container.role]
                runtime_id = (pod.node_uid, container.container_id)
                if (
                    container.runtime_image_digest
                    not in {
                        image.platform_manifest,
                        image.config_digest,
                    }
                    or runtime_id in runtime_ids
                ):
                    raise ValueError("container_identity_mismatch")
                runtime_ids.add(runtime_id)
        if result.outcome == "passed" and pins:
            raise ValueError("missing_workload")

    @activity.defn(name="birbforge_deployment_close_v1")
    async def close(self, raw: dict) -> dict:
        return await self._call(raw, self._close)

    def _close(self, raw: dict) -> dict:
        command = CloseCommand.model_validate(raw)
        if command.model_dump(exclude={"reason"}) != self.invocation:
            raise ValueError("unapproved_invocation")
        value = self._post("/v1/close", raw, 512 * 1024)
        progress = ClosureProgress.model_validate(value)
        expected = raw | {
            "installation_sha256": self.installation.request.installation_sha256,
            "cluster_uid": self.installation.request.target.cluster_uid,
            "namespace_uid": self.installation.request.target.namespace_uid,
        }
        if (
            value.get("release_authorized") is not False
            or progress.model_dump(mode="json") != value
            or any(value[key] != item for key, item in expected.items())
            or set(progress.installation_obligations) != _INSTALLATION_OBLIGATIONS
            or len(progress.installation_obligations) != len(_INSTALLATION_OBLIGATIONS)
            or len({effect.slot for effect in progress.effects})
            != len(progress.effects)
            or any(
                not set(effect.obligations) <= _EFFECT_OBLIGATIONS
                or len(effect.obligations) != len(set(effect.obligations))
                for effect in progress.effects
            )
        ):
            raise ValueError("closure_progress_mismatch")
        return value
