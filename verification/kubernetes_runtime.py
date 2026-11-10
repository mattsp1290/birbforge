import argparse
import hashlib
import json
import re
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


def main():
    parser = argparse.ArgumentParser(
        description="Check the pinned producer and image reference."
    )
    parser.add_argument("--base-image", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r".+@sha256:[0-9a-f]{64}", args.base_image):
        parser.error("base image must use an immutable sha256 digest")
    pin = json.loads(
        (
            Path(__file__).resolve().parents[1] / "packaging/kubernetes-producer.json"
        ).read_text()
    )
    check_producer(pin["revision"])


if __name__ == "__main__":
    main()
