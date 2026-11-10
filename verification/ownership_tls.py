from pathlib import Path
from typing import Annotated

from birbverify.contract import Record, Sha
from pydantic import Field


class OwnershipTLS(Record):
    host: Annotated[str, Field(min_length=1, max_length=253)]
    port: Annotated[int, Field(strict=True, ge=1, le=65535)] = 8443
    server_ca: Path
    server_cert_sha256: Sha
    client_cert: Path
    client_key: Path
