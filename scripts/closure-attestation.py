#!/usr/bin/env python3
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path

from guest import GuestSetup, PINS, source_archive, verify_archive, verify_exports


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def main():
    parser = argparse.ArgumentParser(description="Bind fixture execution to host-checked producer exports")
    parser.add_argument("mode", choices=["prepare", "verify"])
    parser.add_argument("attestation", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    setup = GuestSetup(**json.loads(Path((repo / ".local/guest-setup-path").read_text().strip()).read_text()))
    if args.mode == "prepare":
        verify_exports(setup)
        args.attestation.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        archives = {}
        temporal = {}
        for name, revision in PINS.items():
            archive = source_archive(setup.sources[name], revision)
            path = args.attestation.with_name(name + "-" + revision + ".tar")
            path.write_bytes(archive)
            path.chmod(0o600)
            archives[name] = {"path": str(path.resolve()), "sha256": sha256(archive)}
            binary = Path(setup.exports[name]) / ".proof/bin/temporal"
            temporal[name] = sha256(binary.read_bytes())
        value = {"revisions": PINS, "exports": setup.exports, "archives": archives, "temporal_sha256": temporal,
                 "limit": "Git source and selected Temporal binaries are attested. Installed virtualenv dependencies are not fully attested."}
        args.attestation.write_text(json.dumps(value, indent=2) + "\n")
        args.attestation.chmod(0o600)
        print(json.dumps({"result": "prepared", "attestation": str(args.attestation)}))
        return
    attestation = json.loads(args.attestation.read_text())
    if attestation["revisions"] != PINS or attestation["exports"] != setup.exports:
        raise ValueError("export_attestation_identity_mismatch")
    for name, record in attestation["archives"].items():
        content = Path(record["path"]).read_bytes()
        if sha256(content) != record["sha256"]:
            raise ValueError("export_archive_digest_mismatch")
        root = Path(setup.exports[name])
        verify_archive(root, content, name)
        if sha256((root / ".proof/bin/temporal").read_bytes()) != attestation["temporal_sha256"][name]:
            raise ValueError("temporal_binary_changed")
    producer = Path(setup.exports["birbverify"]) / "src/birbverify"
    origins = {}
    for name in ("contract", "closure", "closure_target", "closure_supervisor", "lifecycle", "fixture_launcher", "runner", "target", "policy"):
        path = producer / (name + ".py")
        module = importlib.import_module("birbverify." + path.stem)
        if Path(module.__file__).resolve() != path.resolve():
            raise ValueError("producer_import_origin_mismatch")
        origins[path.name] = sha256(path.read_bytes())
    from birbverify.contract import digest
    from birbverify.lifecycle import ADAPTER
    expected = digest({name: origins[name] for name in ("lifecycle.py", "closure_target.py", "fixture_launcher.py")})
    if ADAPTER != expected:
        raise ValueError("producer_adapter_mismatch")
    report = {"result": "passed", "attestation_sha256": sha256(args.attestation.read_bytes()),
              "producer_source_sha256": origins, "adapter_revision": ADAPTER,
              "temporal_sha256": attestation["temporal_sha256"], "limit": attestation["limit"]}
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"result": "passed", "producer_modules": len(origins), "adapter_revision": ADAPTER}))


if __name__ == "__main__":
    os.umask(0o077)
    main()
