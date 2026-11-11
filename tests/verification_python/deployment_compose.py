"""Run the Birbverify app fixture in a fresh Compose project."""

import os
import secrets
import subprocess
import tarfile
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import NamedTuple


class ComposeApp(NamedTuple):
    revision: str
    images: dict[str, str]
    port: int


@contextmanager
def start_app(repository: Path, expected_sessions: int):
    from deployment_activity_journey import REVISION, free_port, run
    from deployment_storage_fixture import DisposableProject

    project_name = "aftl-auth-" + secrets.token_hex(8)
    env = {name: os.environ[name] for name in ("HOME", "PATH")}
    with TemporaryDirectory(prefix=project_name) as work:
        root = Path(work)
        with subprocess.Popen(
            ["git", "-C", repository, "archive", REVISION], stdout=subprocess.PIPE
        ) as export:
            with tarfile.open(fileobj=export.stdout, mode="r|") as archive:
                archive.extractall(root, filter="data")
            if export.wait():
                raise RuntimeError("Birbparty source export failed")
        port = free_port()
        variables = {
            "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
            "OPENFGA_POSTGRES_PASSWORD": secrets.token_urlsafe(32),
            "OPENFGA_PRESHARED_KEY": secrets.token_urlsafe(32),
            "JWT_AUTH_KEY": secrets.token_urlsafe(32),
            "API_HOST_PORT": port,
            "POSTGRES_HOST_PORT": free_port(),
            "OPENFGA_HOST_PORT": free_port(),
            "API_PUBLIC_ORIGIN": f"http://127.0.0.1:{port}",
            "HOST_BIND_ADDRESS": "127.0.0.1",
            "API_IMAGE_TAG": project_name,
            "BIRBPARTY_REVISION": REVISION,
        }
        (root / "disposable.env").write_text(
            "".join(f"{k}={v}\n" for k, v in variables.items())
        )
        project = DisposableProject(project_name, root, env)
        tag = "birbparty-api:" + project_name
        run(
            [
                "docker",
                "build",
                "--build-arg",
                f"BIRBPARTY_REVISION={REVISION}",
                "-f",
                root / "crates/api/Dockerfile",
                "-t",
                tag,
                root,
            ],
            env=env,
        )
        try:
            project.start()
            assert project.accounts_and_sessions() == {"accounts": 0, "sessions": 0}
            images = {
                name: run(
                    [
                        "docker",
                        "inspect",
                        "-f",
                        "{{.Image}}",
                        project.run("ps", "-q", name),
                    ],
                    env=env,
                )
                for name in ("api", "openfga", "postgres", "openfga-postgres")
            }
            yield ComposeApp(REVISION, images, port)
            assert project.accounts_and_sessions() == {
                "accounts": 1,
                "sessions": expected_sessions,
            }
        finally:
            try:
                project.run("down", "--volumes")
            finally:
                run(["docker", "image", "rm", tag], env=env)
