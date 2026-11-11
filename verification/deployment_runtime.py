"""Installer-owned files used only by the deployment coordinator."""

import ssl
from pathlib import Path
from typing import TYPE_CHECKING

from birbverify.contract import Record, digest

from verification.ownership_tls import OwnershipTLS

if TYPE_CHECKING:
    from verification.kubernetes import KubernetesConfig


PRODUCER_REVISION = "3688810cd229befa853c2d569669a7eb74b937f2"
PRODUCER_PACKAGE_SHA256 = (
    "5ffa9c6ba2c5f9eaec55391e48a7671660091afeca3d47a0d92d1b3d8eed95fb"
)
ASSERTION_SUITE_SHA256 = (
    "6c14602bfa28c5d4a79fe8216bde60705fc74634b805e95ed03beadd0975cab6"
)


class DeploymentRuntime(Record):
    activity_installation: Path
    ownership: OwnershipTLS


def producer_package_sha256() -> str:
    from importlib.resources import files

    package = Path(str(files("birbverify")))
    return digest(
        {
            path.relative_to(package).as_posix(): digest(path.read_bytes())
            for path in sorted(package.rglob("*.py"))
        }
    )


def coordinator_activities(config: "KubernetesConfig") -> list:
    deployment = config.queue.deployment
    runtime = config.deployment_runtime
    if deployment is None:
        if runtime is not None:
            raise ValueError("deployment_profile_missing")
        from verification.kubernetes_runtime import check_producer

        check_producer(config.queue.authority.producer_revision)
        return []
    if runtime is None or config.temporal_tls is None:
        raise ValueError("authenticated_deployment_runtime_required")
    if config.queue.authority.producer_revision != PRODUCER_REVISION:
        raise ValueError("deployment_producer_revision_mismatch")
    if not (
        deployment.producer_package_sha256
        == PRODUCER_PACKAGE_SHA256
        == producer_package_sha256()
    ):
        raise ValueError("deployment_producer_package_mismatch")

    if runtime.ownership.server_cert_sha256 != deployment.ownership_server_cert_sha256:
        raise ValueError("deployment_ownership_issuer_mismatch")

    from birbverify.deployment_activity import suite_sha256
    from birbverify.deployment_activity_contract import ActivityInstallation

    from verification.deployment_activities import DeploymentActivities

    with runtime.activity_installation.open("rb") as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise ValueError("deployment_installation_too_large")
    installation = ActivityInstallation.model_validate_json(raw)
    request = installation.request
    profile = installation.profile
    authority = config.queue.authority
    cert = config.temporal_tls.client_cert.read_text()
    leaf, marker, _ = cert.partition("-----END CERTIFICATE-----")
    coordinator_cert_sha256 = digest(ssl.PEM_cert_to_DER_cert(leaf + marker))
    if not (
        digest(installation) == deployment.activity_installation_sha256
        and digest(request) == deployment.request_sha256
        and request.request_id == deployment.request_id
        and request.deadline == deployment.deadline
        and request.workflow_id == authority.workflow_id
        and request.target == authority.target
        and request.candidate_revision == authority.candidate_revision
        and request.authored_revision == authority.authored_revision
        and request.beans_issue == authority.beans_issue
        and request.plan_sha256 == authority.plan_sha256
        and request.policy_revision == authority.policy_revision
        and request.producer_revision == authority.producer_revision
        and request.installation_sha256 == authority.installation_sha256
        and request.images["api"].reference == authority.image
        and profile.verifier_revision == authority.producer_revision
        and profile.suite_sha256 == ASSERTION_SUITE_SHA256 == suite_sha256()
        and profile.temporal_server_ca_sha256 == config.temporal_tls.server_ca_sha256
        and profile.temporal_namespace == config.namespace
        and profile.worker_cert_sha256 != coordinator_cert_sha256
        and profile.task_queue == deployment.verifier_task_queue
        and profile.task_queue != config.workflow_task_queue
    ):
        raise ValueError("deployment_installation_mismatch")
    bindings = DeploymentActivities(installation, deployment.epoch, runtime.ownership)
    return [bindings.observe, bindings.result, bindings.close]
