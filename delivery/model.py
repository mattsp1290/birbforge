from pathlib import Path
from typing import Literal
from uuid import UUID

from birbcrew.execution.contract import Digest, GoalOffer, Record
from pydantic import Field
from temporalio.client import Client, TLSConfig


class TLS(Record):
    server_root_ca_cert: Path
    client_cert: Path
    client_private_key: Path
    domain: str


class Config(Record):
    temporal_address: str
    namespace: str
    workflow_id: str
    workflow_task_queue: str
    activity_task_queue: str
    owner_principal: str
    offer: GoalOffer
    tls: TLS | None = None


class Command(Record):
    command_id: UUID
    expected_revision: int = Field(ge=0)
    offer_sha256: Digest
    action: Literal["approve", "reject", "cancel", "retry_review"]


class Intent(Record):
    op: Literal["snapshot", "command"]
    principal: str
    conversation_id: UUID
    body: Command | None = None


async def connect(config: Config):
    tls = config.tls
    return await Client.connect(
        config.temporal_address,
        namespace=config.namespace,
        tls=TLSConfig(
            server_root_ca_cert=tls.server_root_ca_cert.read_bytes(),
            client_cert=tls.client_cert.read_bytes(),
            client_private_key=tls.client_private_key.read_bytes(),
            domain=tls.domain,
        )
        if tls
        else False,
    )


def load(path):
    return Config.model_validate_json(Path(path).read_text())
