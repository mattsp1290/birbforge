import json
from pathlib import Path

import pytest

pytest.importorskip("birbverify")

from verification import kubernetes_runtime

PIN = json.loads(
    (
        Path(__file__).resolve().parents[2] / "packaging/kubernetes-producer.json"
    ).read_text()
)


def test_installed_producer_source_matches_approved_pin():
    kubernetes_runtime.check_producer(PIN["revision"])
    with pytest.raises(ValueError, match="producer_revision_mismatch"):
        kubernetes_runtime.check_producer("0" * 40)


def test_modified_producer_module_is_rejected(tmp_path, monkeypatch):
    installed = kubernetes_runtime.files("birbverify")
    for name in PIN["source_sha256"]:
        (tmp_path / name).write_bytes(installed.joinpath(name).read_bytes())
    with (tmp_path / "contract.py").open("a") as source:
        source.write("\nchanged = True\n")
    monkeypatch.setattr(kubernetes_runtime, "files", lambda package: tmp_path)
    with pytest.raises(ValueError, match="producer_source_mismatch"):
        kubernetes_runtime.check_producer(PIN["revision"])
