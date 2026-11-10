from hashlib import sha256
from pathlib import Path
from typing import TYPE_CHECKING, Annotated

from birbverify.contract import Record, Sha
from pydantic import Field
from temporalio.client import Client, TLSConfig

if TYPE_CHECKING:
    from verification.kubernetes import KubernetesConfig


class TemporalTLS(Record):
    server_name: Annotated[str, Field(min_length=1, max_length=253)]
    server_ca: Path
    server_ca_sha256: Sha
    client_cert: Path
    client_key: Path

    def credentials(self) -> TLSConfig:
        ca = self.server_ca.read_bytes()
        if not ca or sha256(ca).hexdigest() != self.server_ca_sha256:
            raise ValueError("temporal_ca_mismatch")
        cert = self.client_cert.read_bytes()
        key = self.client_key.read_bytes()
        if not cert or not key:
            raise ValueError("temporal_client_identity_missing")
        return TLSConfig(
            server_root_ca_cert=ca,
            domain=self.server_name,
            verification_server_name=self.server_name,
            client_cert=cert,
            client_private_key=key,
        )


async def connect(config: "KubernetesConfig") -> Client:
    if config.temporal_tls is None:
        if config.queue.deployment is not None:
            raise ValueError("deployment_requires_mutual_tls")
        return await Client.connect(config.temporal_address, namespace=config.namespace)
    # The SDK permits a URL scheme to override its TLS-derived transport scheme.
    if "://" in config.temporal_address:
        raise ValueError("temporal_address_requires_host_port")
    return await Client.connect(
        config.temporal_address,
        namespace=config.namespace,
        tls=config.temporal_tls.credentials(),
    )
