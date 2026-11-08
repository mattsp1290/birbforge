import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

from birbverify.fixture_launcher import WorkerGroup
from birbverify.lifecycle import Engine


def write_owned(path, value):
    path.parent.mkdir(mode=0o700, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(json.dumps(value, sort_keys=True).encode())
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    try:
        temporary_path.replace(path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary_path.unlink(missing_ok=True)


class OwnedEngine(Engine):
    def __init__(self, root):
        super().__init__()
        self.root = root

    def raw(self, method, path, body=None):
        prefix = "/containers/create?name="
        if method == "POST" and path.startswith(prefix):
            identity = path.removeprefix(prefix)
            if not re.fullmatch(r"worker-[0-9a-f]{32}", identity):
                raise ValueError("invalid_worker_launch_identity")
            if body["Labels"]["birbverify.worker_execution"] != identity:
                raise ValueError("worker_launch_identity_conflict")
            write_owned(
                self.root / "owned-worker-launches" / (identity + ".json"),
                {"container_name": identity},
            )
        return super().raw(method, path, body)


def owned_worker_identities(root):
    identities = set()
    for record in (root / "owned-worker-launches").glob("*.json"):
        identity = json.loads(record.read_text())["container_name"]
        if not re.fullmatch(r"worker-[0-9a-f]{32}", identity):
            raise ValueError("invalid_worker_launch_identity")
        identities.add(identity)
    for record in (root / "owned-worker-groups").glob("*.json"):
        identities.add(json.loads(record.read_text())["container_id"])
    database_path = root / "target.sqlite"
    if database_path.exists():
        with sqlite3.connect(f"file:{database_path}?mode=ro", uri=True) as database:
            registrations = database.execute(
                "SELECT payload FROM worker_registrations"
            ).fetchall()
        for (payload,) in registrations:
            identities.add(json.loads(payload)["group"]["container_id"])
    return sorted(identities)


def launch(config):
    root = config.installation_root
    directory = root / "launch"
    directory.mkdir(mode=0o700, exist_ok=True)
    entry = directory / "birbforge_activity.py"
    shutil.copyfile(Path(__file__).with_name("activity_entry.py"), entry)
    public = directory / "temporal.json"
    public.write_text(
        json.dumps(
            {
                key: getattr(config, key)
                for key in ["temporal_address", "namespace", "activity_task_queue"]
            }
        )
    )
    return WorkerGroup(
        root,
        [sys.executable, "-P", str(entry), str(root), str(public)],
        engine=OwnedEngine(root),
    )


def main():
    import signal
    import threading

    from verification.adapter import check_profile, load_config

    os.umask(0o077)
    if sys.argv[1] == "remove":
        from birbverify.lifecycle import Engine, container_path

        identity = sys.argv[2]
        if len(identity) != 64 or any(
            character not in "0123456789abcdef" for character in identity
        ):
            raise ValueError("invalid_worker_identity")
        engine = Engine()
        if engine.raw("DELETE", container_path(identity) + "?force=true")[0] not in {
            204,
            404,
        }:
            raise ValueError("worker_removal_unknown")
        if engine.raw("GET", container_path(identity) + "/json")[0] != 404:
            raise ValueError("worker_absence_unconfirmed")
        return
    config = load_config(sys.argv[1])
    if config.profile != "closure-v2":
        raise ValueError("closure_profile_required")
    check_profile(config)
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    group = launch(config)
    try:
        directory = config.installation_root / "owned-worker-groups"
        directory.mkdir(mode=0o700, exist_ok=True)
        write_owned(
            directory / (group.identity + ".json"),
            {
                "container_id": group.container_id,
                "entry_sha256": hashlib.sha256(
                    (
                        config.installation_root / "launch/birbforge_activity.py"
                    ).read_bytes()
                ).hexdigest(),
            },
        )
        stopped.wait()
    finally:
        group.remove()


if __name__ == "__main__":
    main()
