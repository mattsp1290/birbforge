import argparse
import asyncio
import hashlib
import json
import os
import secrets
import signal
import socket
import subprocess
import tempfile
from contextlib import AsyncExitStack
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

FORGE = Path(__file__).resolve().parents[1]
CREW = FORGE.parent / "crew"
BEANS = FORGE.parent / "beans"
PROJECT_QUESTION = (
    "Using both mattsp1290/forge and mattsp1290/crew source files, "
    "explain who owns approvals, finalized conversation history, and durable execution. "
    "Cite each repository, supplied file path and exact commit. "
    "Do not execute or change anything."
)


PROJECT_FOLLOWUPS = [
    "In at most120words, compare Forge approval ownership with Crew request ordering. "
    "Cite both frozen repository sources and exact commits.",
    "In at most120words, explain why these source documents do not let a planning message "
    "authorize implementation. Cite both frozen repositories.",
    "After reconnect, in at most120words explain finalized versus provisional message history "
    "using the supplied Crew source. Relate it to Forge's owner controls.",
    "In at most120words, identify one missing implementation fact in the supplied historical "
    "project documents. Label it as a gap, not a proven capability, and cite the sources.",
    "In at most120words, give a project-chat safety checklist grounded in both supplied "
    "repositories. Distinguish source evidence from inference and do not execute anything.",
]


def private(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as output:
        json.dump(value, output, indent=2)


def git(directory, *args):
    return subprocess.check_output(
        ["git", "-C", str(directory), *args],
        text=True,
        env={
            **{key: value for key, value in os.environ.items() if not key.startswith("GIT_")},
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_NOSYSTEM": "1",
        },
        stderr=subprocess.PIPE,
    ).strip()


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def runtime_sources():
    roots = [FORGE / "server", FORGE / "app", CREW / "src", BEANS / "src"]
    paths = [Path(__file__).resolve(), FORGE / "package-lock.json", BEANS / "target/debug/bn"]
    for directory in roots:
        paths.extend(
            path
            for path in directory.rglob("*")
            if path.suffix in {".py", ".ts", ".tsx", ".rs", ".json"}
        )
    return {
        str(path.relative_to(FORGE.parent)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(paths)
    }


async def main(args):
    import httpx
    import psycopg
    import uvicorn
    from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
    from temporalio.testing import WorkflowEnvironment
    from temporalio.worker import Worker

    run = args.evidence / ("local-assembled-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ"))
    run.mkdir(mode=0o700)
    report = {
        "environment": "isolated local Mac loopback, PostgreSQL, Temporal, actual Forge gateway",
        "provider": "OpenCode Go" if args.live else "injected FunctionModel",
        "github": "live Octokit service identity using owner-authorized existing CLI credential",
        "shared_staging": False,
        "installed_phone": False,
        "ready_worker": False,
        "run_path": str(run),
        "operations": [],
        "chats": [],
        "verdict": "incomplete",
    }
    report["repository_heads"] = {
        path.name: git(path, "rev-parse", "HEAD") for path in [FORGE, CREW, BEANS]
    }
    report["runtime_source_digests"] = runtime_sources()
    processes = []
    server = None
    http_task = None
    forge_process = None
    postgres = Path("/opt/homebrew/bin/postgres").resolve()
    owner_token, service_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    forge_port = free_port()
    forge_url = f"http://127.0.0.1:{forge_port}"
    attestation = args.attestation.resolve() if args.attestation else None
    if args.live:
        from birbcrew import provider

        preflight = provider.preflight_account(attestation)
        report["account_preflight"] = {
            key: preflight[key]
            for key in (
                "model",
                "models_http_status",
                "selected_model_listed",
                "extra_usage_disabled",
                "eligible_coding_use",
            )
        }
    managed_home, hub, remote = run / "beans-home", run / "hub", run / "remote.git"
    managed_home.mkdir(mode=0o700)
    hub.mkdir()
    git(run, "init", "--bare", "-q", "-b", "main", str(remote))
    git(hub, "init", "-q", "-b", "main")
    git(hub, "config", "user.name", "Local project journey")
    git(hub, "config", "user.email", "project-journey@localhost")
    git(hub, "commit", "--allow-empty", "-qm", "Initialize disposable project journey")
    git(hub, "remote", "add", "origin", str(remote))
    git(hub, "push", "-qu", "origin", "main")
    token_file = run / "service.token"
    token_file.write_text(service_token)
    token_file.chmod(0o600)

    def start_forge(configuration):
        env = {
            **os.environ,
            "BIRBFORGE_CLIENT_CONFIG": str(configuration),
            "BIRBFORGE_PORT": str(forge_port),
        }
        log = (run / f"forge-{len(processes)}.log").open("w")
        process = subprocess.Popen(
            [
                str(FORGE / "node_modules/.bin/tsx"),
                "--tsconfig",
                "tsconfig.node.json",
                "server/main.ts",
            ],
            cwd=FORGE,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        log.close()
        processes.append(process)
        return process

    def stop(process):
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    try:
        with tempfile.TemporaryDirectory(
            prefix="forge-project-socket-", dir="/tmp"
        ) as socket_directory:
            socket_root = Path(socket_directory)
            subprocess.run(
                [
                    str(postgres.parent / "initdb"),
                    "-D",
                    str(run / "postgres-data"),
                    "-A",
                    "trust",
                    "--no-locale",
                    "--encoding=UTF8",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            db_log = (run / "postgres.log").open("w")
            db = subprocess.Popen(
                [
                    str(postgres),
                    "-D",
                    str(run / "postgres-data"),
                    "-k",
                    str(socket_root),
                    "-h",
                    "",
                ],
                stdout=db_log,
                stderr=subprocess.STDOUT,
            )
            db_log.close()
            try:
                for _ in range(100):
                    try:
                        with psycopg.connect(host=str(socket_root), dbname="postgres"):
                            break
                    except psycopg.OperationalError:
                        await asyncio.sleep(0.1)
                else:
                    raise RuntimeError("isolated_postgres_start_failed")
                config = run / "crew.json"
                private(
                    config,
                    {
                        "database_url": "postgresql:///postgres?host=" + str(socket_root),
                        "temporal_address": "local-test-environment",
                        "task_queue": "assembled-" + str(uuid4()),
                        "token_hashes": {"owner": hashlib.sha256(owner_token.encode()).hexdigest()},
                        "context": {
                            "project": "unused",
                            "actor": "owner",
                            "commit": "fixture",
                            "notes": [],
                        },
                        "evidence_dir": str(run),
                        "mode": "project-live" if args.live else "project-test",
                        "live_attestation": str(attestation) if args.live else None,
                        "project_service_token_sha256": hashlib.sha256(
                            service_token.encode()
                        ).hexdigest(),
                    },
                )
                os.environ["BIRBCREW_CONFIG"] = str(config)
                from birbcrew.config import settings

                settings.cache_clear()
                from birbcrew import api, store
                from birbcrew.project_runtime import (
                    project_conversation_events,
                    save_project_conversation,
                    validate_project_provider,
                )
                from birbcrew.project_workflow import ProjectConversationWorkflow

                await store.migrate()
                async with await WorkflowEnvironment.start_local(
                    plugins=[PydanticAIPlugin()],
                    dev_server_existing_path="/opt/homebrew/bin/temporal",
                    dev_server_log_level="error",
                ) as environment:
                    api.app.state.temporal = environment.client
                    sock = socket.socket()
                    sock.bind(("127.0.0.1", 0))
                    crew_url = f"http://127.0.0.1:{sock.getsockname()[1]}"
                    server = uvicorn.Server(
                        uvicorn.Config(api.app, log_level="error", lifespan="off")
                    )
                    http_task = asyncio.create_task(server.serve(sockets=[sock]))
                    while not server.started:
                        await asyncio.sleep(0.05)
                    forge_config = run / "forge.json"
                    private(
                        forge_config,
                        {
                            "url": crew_url,
                            "tokens": {"owner": owner_token},
                            "projects": {
                                "owner_principal": "owner",
                                "github": {
                                    "token_file": str(args.evidence / "private/github.token"),
                                    "owner_login": (args.evidence / "private/github-login.txt")
                                    .read_text()
                                    .strip(),
                                },
                                "beans": {
                                    "binary": str(BEANS / "target/debug/bn"),
                                    "hub": str(hub),
                                    "home": str(managed_home),
                                    "branch": "main",
                                    "actor": "project-journey",
                                },
                                "service_token_file": str(token_file),
                                "intent_directory": str(run / "intents"),
                            },
                        },
                    )
                    forge_process = start_forge(forge_config)
                    options = {
                        "task_queue": settings().task_queue + "-projects",
                        "workflows": [ProjectConversationWorkflow],
                        "activities": [
                            project_conversation_events,
                            save_project_conversation,
                            validate_project_provider,
                        ],
                    }
                    async with AsyncExitStack() as workers:
                        await workers.enter_async_context(
                            Worker(environment.client, **options)
                        )
                        async with httpx.AsyncClient(
                            base_url=forge_url,
                            timeout=45,
                            headers={"Authorization": "Bearer " + owner_token},
                        ) as client:
                            for _ in range(100):
                                try:
                                    if (await client.get("/healthz")).status_code == 200:
                                        break
                                except httpx.TransportError:
                                    pass
                                if forge_process.poll() is not None:
                                    raise RuntimeError("forge_gateway_exited")
                                await asyncio.sleep(0.1)
                            else:
                                raise RuntimeError("forge_gateway_start_failed")

                            async def request(path, body=None, expected=200):
                                response = await (
                                    client.get("/api" + path)
                                    if body is None
                                    else client.post("/api" + path, json=body)
                                )
                                assert response.status_code == expected, (
                                    path,
                                    response.status_code,
                                    response.text[:500],
                                )
                                return response.json()

                            async def mutation(project_id, revision, change):
                                body = {
                                    "project_id": project_id,
                                    "operation_id": str(uuid4()),
                                    "expected_revision": revision,
                                    "change": change,
                                }
                                report["operations"].append(body)
                                result = await request("/projects", body)
                                assert result["pushed"] is True
                                return result["project"], body

                            async def create_chat(project):
                                cid = str(uuid4())
                                state = await request(
                                    f"/projects/{project['id']}/conversations",
                                    {"id": cid},
                                )
                                report["chats"].append(
                                    {
                                        "id": cid,
                                        "project_id": project["id"],
                                        "context_sha256": state["context_sha256"],
                                    }
                                )
                                return cid, state

                            async def finalized(cid, count):
                                for _ in range(2400):
                                    state = await request("/conversations/" + cid)
                                    if state["phase"] == "failed" or any(
                                        item["outcome"] == "failed" for item in state["inputs"]
                                    ):
                                        private(run / "failed-state.json", state)
                                        raise RuntimeError(state["failure"])
                                    if (
                                        sum(
                                            item["outcome"] == "completed"
                                            for item in state["inputs"]
                                        )
                                        == count
                                    ):
                                        return state
                                    await asyncio.sleep(0.1)
                                raise RuntimeError("provider_turn_timeout_retain_request")

                            project_id = "assembled-" + uuid4().hex[:16]
                            project, creation = await mutation(
                                project_id,
                                None,
                                {
                                    "type": "create",
                                    "name": None,
                                    "repository_ids": [
                                        "1447665555",
                                        "1447699708",
                                        "1447665555",
                                    ],
                                },
                            )
                            assert project["name"] == "forge"
                            assert [repository["id"] for repository in project["repositories"]] == [
                                "1447665555",
                                "1447699708",
                            ]
                            head = git(hub, "rev-parse", "HEAD")
                            assert (await request("/projects", creation))["replayed"] is True
                            assert git(hub, "rev-parse", "HEAD") == head
                            first_revision = project["revision"]
                            project, _ = await mutation(
                                project_id,
                                project["revision"],
                                {
                                    "type": "rename",
                                    "name": "Forge and Crew assembled journey",
                                },
                            )
                            await request(
                                "/projects",
                                {
                                    "project_id": project_id,
                                    "operation_id": str(uuid4()),
                                    "expected_revision": first_revision,
                                    "change": {
                                        "type": "rename",
                                        "name": "Stale device",
                                    },
                                },
                                expected=409,
                            )
                            subprocess.run(
                                [
                                    str(BEANS / "target/debug/bn"),
                                    "--hub",
                                    str(hub),
                                    "--branch",
                                    "main",
                                    "--actor",
                                    "project-journey",
                                    "--project",
                                    project_id,
                                    "--json",
                                    "remember",
                                    "--key",
                                    "conversation-boundary",
                                    (
                                        "Project planning reads the frozen source snapshot "
                                        "and cannot authorize implementation."
                                    ),
                                ],
                                check=True,
                                cwd=managed_home,
                                env={
                                    "PATH": os.environ["PATH"],
                                    "HOME": str(managed_home),
                                    "LANG": "C.UTF-8",
                                },
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.PIPE,
                            )
                            cid, original = await create_chat(project)
                            second_cid, _ = await create_chat(project)
                            separate, _ = await mutation(
                                "other-" + uuid4().hex[:16],
                                None,
                                {
                                    "type": "create",
                                    "name": "Separate project",
                                    "repository_ids": ["1447699708"],
                                },
                            )
                            separate_cid, separate_state = await create_chat(separate)
                            assert len(separate_state["project_context"]["repositories"]) == 1
                            assert {
                                row["id"]
                                for row in await request(f"/projects/{project_id}/conversations")
                            } == {cid, second_cid}
                            assert [
                                row["id"]
                                for row in await request(
                                    f"/projects/{separate['id']}/conversations"
                                )
                            ] == [separate_cid]
                            prompts = [PROJECT_QUESTION, *PROJECT_FOLLOWUPS][: args.turns]
                            report["turn_requests"] = []
                            snapshots = []
                            for turn, text in enumerate(prompts, start=1):
                                prompt = {"request_id": str(uuid4()), "text": text}
                                report["turn_requests"].append(prompt)
                                report["request_id"] = prompt["request_id"]
                                private(run / "report.json", report)
                                await request(f"/conversations/{cid}/inputs", prompt)
                                final = await finalized(cid, turn)
                                private(run / f"turn-{turn}.json", final)
                                snapshots.append(final)
                                producer_final = await store.snapshot(cid, "owner")
                                assert len(producer_final["attempts"]) == turn
                                assert len(final["inputs"]) == turn
                                assert all(
                                    item["outcome"] == "completed" for item in final["inputs"]
                                )
                                await request(f"/conversations/{cid}/inputs", prompt)
                                assert (
                                    len((await request(f"/conversations/{cid}"))["inputs"]) == turn
                                )
                                assert len((await store.snapshot(cid, "owner"))["attempts"]) == turn
                                await request(
                                    f"/conversations/{cid}/inputs",
                                    {**prompt, "text": "tampered retry"},
                                    expected=409,
                                )
                                if turn == 3 and args.turns > 3:
                                    before_restart = final["messages"]
                                    await workers.aclose()
                                    await workers.enter_async_context(
                                        Worker(environment.client, **options)
                                    )
                                    report["worker_restart_after_turn"] = turn
                                    restarted = await request(f"/conversations/{cid}")
                                    assert restarted["messages"] == before_restart
                                    await request(f"/conversations/{cid}/inputs", prompt)
                                    assert (
                                        len((await store.snapshot(cid, "owner"))["attempts"])
                                        == turn
                                    )
                                    private(run / "after-worker-restart.json", restarted)
                            private(run / "finalized-history.json", final)
                            private(run / "producer-finalized-history.json", producer_final)
                            assert (
                                len(final["inputs"])
                                == len(producer_final["attempts"])
                                == args.turns
                            )
                            assert (
                                final["messages"][: len(snapshots[0]["messages"])]
                                == snapshots[0]["messages"]
                            )
                            report["completed_turns"] = args.turns
                            report["attempt_ids"] = [
                                item["id"] for item in producer_final["attempts"]
                            ]
                            report["finalized_history_prefix_preserved"] = True
                            stop(forge_process)
                            forge_process = start_forge(forge_config)
                            for _ in range(100):
                                try:
                                    if (await client.get("/healthz")).status_code == 200:
                                        break
                                except httpx.TransportError:
                                    pass
                                await asyncio.sleep(0.1)
                            assert (await request(f"/projects/{project_id}"))["id"] == project_id
                            assert (await request(f"/conversations/{cid}"))["messages"] == final[
                                "messages"
                            ]
                            project, _ = await mutation(
                                project_id,
                                project["revision"],
                                {
                                    "type": "remove_repository",
                                    "repository_id": "1447699708",
                                },
                            )
                            assert (await request(f"/conversations/{cid}"))[
                                "context_sha256"
                            ] == original["context_sha256"]
                            _fresh_cid, fresh = await create_chat(project)
                            assert len(fresh["project_context"]["repositories"]) == 1
                            assert fresh["context_sha256"] != original["context_sha256"]
                            await request(
                                "/projects",
                                {
                                    "project_id": project_id,
                                    "operation_id": str(uuid4()),
                                    "expected_revision": project["revision"],
                                    "change": {
                                        "type": "remove_repository",
                                        "repository_id": "1447665555",
                                    },
                                },
                                expected=409,
                            )
                            await request(
                                f"/conversations/{cid}/delivery/command",
                                {"command_id": str(uuid4()), "action": "approve"},
                                expected=409,
                            )
                            report.update(
                                {
                                    "default_name": "forge",
                                    "project_id": project_id,
                                    "separate_project_id": separate["id"],
                                    "scope_change_preserves_historical_chat": True,
                                    "new_chat_uses_latest_membership": True,
                                    "gateway_restart_survived": True,
                                    "unchanged_creation_retry_single_commit": True,
                                    "unchanged_turn_retry_single_attempt": True,
                                    "rejected_stale_revision": True,
                                    "rejected_tampered_retry": True,
                                    "rejected_last_repository_removal": True,
                                    "old_pilot_cannot_launch_project_chat": True,
                                    "finalized_message_count": len(final["messages"]),
                                    "model_names": sorted(
                                        {
                                            message.get("model_name")
                                            for message in producer_final["native_messages"]
                                            if message.get("model_name")
                                        }
                                    ),
                                    "note_receipts": [
                                        {key: value for key, value in note.items() if key != "body"}
                                        for note in producer_final["context"]["notes"]
                                    ],
                                    "source_receipts": [
                                        {
                                            key: value
                                            for key, value in source.items()
                                            if key != "text"
                                        }
                                        for source in original["project_context"]["sources"]
                                    ],
                                    "verdict": (
                                        "local assembled boundary passed; "
                                        "source answer requires independent review"
                                    ),
                                }
                            )
                            private(
                                run / "browser-session.json",
                                {
                                    "url": forge_url,
                                    "token": owner_token,
                                    "project_id": project_id,
                                    "conversation_id": cid,
                                },
                            )
                            print(
                                "LOCAL_ASSEMBLED_READY " + str(run / "browser-session.json"),
                                flush=True,
                            )
                            private(run / "report.json", report)
                            deadline = asyncio.get_running_loop().time() + args.hold_seconds
                            while (
                                asyncio.get_running_loop().time() < deadline
                                and not (run / "stop-browser.flag").exists()
                            ):
                                await asyncio.sleep(1)
                            for chat in report["chats"]:
                                response = await client.post(
                                    f"/api/conversations/{chat['id']}/cancel", json={}
                                )
                                assert response.status_code == 202
                    server.should_exit = True
                    await asyncio.wait_for(http_task, 15)
                    server = None
            finally:
                if server:
                    server.should_exit = True
                    if http_task:
                        await asyncio.wait_for(http_task, 15)
                stop(forge_process)
                db.send_signal(signal.SIGINT)
                db.wait(timeout=15)
        report["cleanup"] = (
            "Owned Forge gateway, API, workers, local Temporal and PostgreSQL stopped. "
            "Disposable hub, intents and private evidence retained."
        )
    except BaseException as error:
        report["verdict"] = "incomplete"
        report["error_type"] = type(error).__name__
        report["error"] = str(error)[:500]
        raise
    finally:
        report["runtime_sources_unchanged"] = report["runtime_source_digests"] == runtime_sources()
        if not report["runtime_sources_unchanged"]:
            report["verdict"] = "inconclusive because runtime source changed during the journey"
        for process in processes:
            stop(process)
        private(run / "report.json", report)
        print(str(run / "report.json"), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--hold-seconds", type=int, default=0)
    parser.add_argument("--turns", type=int, choices=range(1, 7), default=1)
    parser.add_argument("--attestation", type=Path)
    args = parser.parse_args()
    if args.live:
        if args.attestation is None:
            parser.error("--live requires an explicit current owner-only --attestation file")
        try:
            metadata = args.attestation.stat()
            if (
                args.attestation.is_symlink()
                or not args.attestation.is_file()
                or metadata.st_uid != os.getuid()
                or metadata.st_mode & 0o077
            ):
                parser.error("--attestation must be an owner-only regular file owned by this user")
        except OSError:
            parser.error("--attestation must identify an existing owner-only evidence file")
    asyncio.run(main(args))
