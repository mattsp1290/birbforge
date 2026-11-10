import hashlib
import json
from importlib.resources import files
from pathlib import Path


def check_producer(revision: str) -> None:
    pin = json.loads(
        (
            Path(__file__).resolve().parents[1] / "packaging/kubernetes-producer.json"
        ).read_text()
    )
    if revision != pin["revision"]:
        raise ValueError("producer_revision_mismatch")
    package = files("birbverify")
    for name, expected in pin["source_sha256"].items():
        if hashlib.sha256(package.joinpath(name).read_bytes()).hexdigest() != expected:
            raise ValueError("producer_source_mismatch")
