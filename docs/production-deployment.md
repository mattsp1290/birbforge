# Production deployment reference

This page is for whoever writes the Kubernetes chart. It lists what the Forge image and its processes read, write, listen on and spawn. Each line cites the source that sets the requirement. Paths such as `/config` and `/var/lib/forge` are examples, not values the code requires.

"Verified" below means it was run as described in [What was checked](#what-was-checked). Everything else is read from source and has not run in a cluster.

## Processes and placement

| Process | Command | Placement | Source |
| --- | --- | --- | --- |
| Forge gateway | image default `CMD` under `tini` | Same pod as the Crew API, the Crew member gateway when member chats are on, and the TLS edge | `Dockerfile:40-41` |
| Crew API | `python -m uvicorn birbcrew.api:app --host 127.0.0.1 --port 8000` with `BIRBCREW_CONFIG` | Same pod as the gateway. Forge accepts only an `http://127.0.0.1` producer URL. | `server/gateway.ts:19-22`; Crew `docs/persistent-pilot.md:15-19` |
| Crew member gateway | Crew `npm run gateway -- <config>` | Same pod as the gateway when `members` is set. Forge accepts only `http://127.0.0.1:<port>`. | `server/members.ts:9`; Crew `docs/member-gateway.md:5-17` |
| TLS edge (nginx) | outside this repository | Same pod. The private listener drops any connection whose source is not `127.0.0.1`. | `server/gateway.ts:243-246`, `server/gateway.ts:61-64` |
| Crew project worker | `python -m birbcrew.project_worker` | Any pod that reaches Temporal and PostgreSQL. Needed for project chats. | `docs/project-chats.md`; Crew `docs/project-chats.md:23` |
| Forge delivery worker | `python -m delivery worker /config/delivery.json` | Any pod that reaches Temporal. Runs from this image because `delivery/` lives here. | `delivery/__main__.py:70-74`, `Dockerfile:33` |
| Crew execution worker | `python -m birbcrew.execution.worker` | Separate pod or host. It authors, reviews and publishes. | Crew `docs/persistent-pilot.md:21-27`, Crew `docs/in-cluster-executor.md` |

The gateway also starts short-lived children in its own container: `bn` and `git` for Projects mode (`server/beans-projects.ts:13`, `:53`) and for the standalone catalog (`server/catalog.ts:38`, `:97-105`), `python -m delivery.adapter` per delivery command (`server/delivery.ts:31`), and `python -I scripts/chat-agent.py` for each workspace chat reply whenever `BIRBFORGE_CHAT_PYTHON` is set, live or local (`server/chat.ts:104`, `server/chat.ts:278`). The image therefore runs under `tini` (`Dockerfile:40`). If the chart sets `command:` it replaces `tini`; set `args:` instead.

## Image

| Build argument | Value used for the local build | Source |
| --- | --- | --- |
| `NODE_IMAGE` | `node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9` | `Dockerfile:16` |
| `RUST_IMAGE` | `rust:1.98.1-slim-bookworm@sha256:ff521445a372125ed4f76e1453a1f8098f2d05332d1601d30db1c1f62757e730`. Its toolchain must match the Beans `rust-toolchain.toml`. Auto-install is off, so a mismatch fails the build. | `Dockerfile:4`, `Dockerfile:11-14` |
| `CREW_IMAGE` | A Crew image built from Crew's root `Dockerfile`, digest-pinned. Production needs a Crew revision whose `ReviewReceipt.reviewer` accepts `opencode-go` (Crew PR 45 or later). | `Dockerfile:25` |
| `BEANS_COMMIT` | `bb55b2aa253a63cb18d8e4357ca8958d3fd5ad0b`, the commit tagged Beans `v0.4.0`. The build pins the SHA rather than the tag and fails unless the fetched `HEAD` equals it. `bn --version` prints `v0.4.0+<sha>`. | `Dockerfile:6-13` |
| `BEANS_REPOSITORY` | `https://github.com/mattsp1290/beans.git` | `Dockerfile:5` |

Every `FROM` takes a digest-pinned build argument. Use multi-platform index digests so one argument works for `linux/amd64` and `linux/arm64`. The Dockerfile uses no BuildKit-only syntax, so any builder that supports multi-stage builds with `ARG` in `FROM` works.

The final image adds `git`, `ca-certificates`, `tini` and `libstdc++6` from Debian, Node and npm from `NODE_IMAGE`, and `/usr/local/bin/bn` (`Dockerfile:27-31`). Only the `bn` binary comes from the Rust stage. It embeds the placeholder Beans web UI, so `bn serve` is not useful from this image. The application is `/app/birbforge`, readable by all and owned by root (`Dockerfile:32-35`). The runtime user is `10001:10001` with no passwd entry (`Dockerfile:38`). The image has no SSH client, so a Beans hub remote must use HTTPS.

## Pod security

| Setting | Requirement | Source |
| --- | --- | --- |
| `runAsUser` / `runAsGroup` | `10001`. Owner-only files below must be owned by this UID. | `Dockerfile:38`, `server/members.ts:55`, `server/secrets.ts:22`, `server/access.ts:34` |
| `readOnlyRootFilesystem` | Supported with a writable `/tmp`. tsx caches compiled modules in the OS temp directory, and standalone catalog mode creates temporary checkouts there (`server/catalog.ts:94`). | verified, see below |
| `capabilities.drop: [ALL]`, `allowPrivilegeEscalation: false` | Supported. Nothing runs as root at runtime. | verified, see below |
| `workingDir` | Leave the image default `/app/birbforge`. The gateway serves `dist` and runs `scripts/chat-agent.py` relative to it. | `server/main.ts:23`, `server/chat.ts:104` |
| `fsGroup` | The gateway needs write access to the volume root to create its directories. Either the provisioner creates writable directories (k3s `local-path` does), or set `fsGroup: 10001` with `fsGroupChangePolicy: OnRootMismatch` on an empty volume. With the default `Always` policy, Kubernetes re-adds group permissions on every mount and the owner-only checks then fail. Inferred from Kubernetes behavior, not tested. | `server/secrets.ts:20-22`, `server/members.ts:55`, `server/chat.ts:99` |

Kubernetes Secret and ConfigMap volumes present files as symbolic links owned by root. The proxy configuration and the members token are opened with `O_NOFOLLOW` and must be regular files owned by UID 10001 with no group or other permission bits (`server/access.ts:31-36`, `server/members.ts:52-55`). Copy them into an `emptyDir` with an init container running as UID 10001 and `chmod 0600`. The other credential files are read without those checks; keep them readable by UID 10001 only anyway.

## Gateway environment

| Variable | Required | Meaning | Source |
| --- | --- | --- | --- |
| `BIRBFORGE_CLIENT_CONFIG` | yes | Absolute path to the gateway JSON configuration below. Startup fails without it. | `server/main.ts:10-12` |
| `BIRBFORGE_PORT` | no | Loopback listener port, default `8787`. | `server/main.ts:13-14` |
| `BIRBFORGE_PROXY_CONFIG` | for the TLS edge | Path to the private listener configuration. | `server/main.ts:15`, `server/access.ts:11-38` |
| `BIRBFORGE_WORKSPACE_DIR` | set it | Durable workspace directory. The default is a `workspace` directory next to the client configuration, which is wrong for a read-only mounted configuration. | `server/main.ts:19` |
| `BIRBFORGE_CHAT_MODE` | yes | `live` or `local`. There is no default: startup fails when it is unset or has any other value. `live` sends every workspace chat to the provider, reports `live`, and requires `BIRBFORGE_CHAT_PYTHON` and the `OPENCODE_GO_API_KEY` machine secret. It never answers from local inspection. `local` makes no model call. | `server/main.ts:16`, `server/chat.ts:26-39`, `server/chat.ts:99-104`, `server/chat.ts:278`, `server/chat.ts:299` |
| `BIRBFORGE_CHAT_PYTHON` | with `live`; optional with `local` | Absolute Python with Crew installed. In this image, `/venv/bin/python`. With `live`, startup fails unless it is an absolute path to an executable. With `local` and without it, workspace chats answer with the local inspection text. | `server/main.ts:20`, `server/chat.ts:33-37`, `server/chat.ts:99`, `server/chat.ts:278` |
| `BIRBFORGE_BEANS_HUB` | no | Standalone catalog hub. Ignored for projects when `projects` is configured. | `server/main.ts:20`, `server/catalog.ts:45-53` |
| `BIRBFORGE_READY_FILE` | no | Writes a ready marker after both listeners bind. Not needed in Kubernetes. | `server/main.ts:50-56` |
| `PATH` | keep the image value | Standalone catalog mode runs `bn` from `PATH`; Projects mode passes `PATH` to `bn` and `git`. | `server/catalog.ts:30`, `server/beans-projects.ts:14` |
| `DD_*` | no | Datadog tracing, see [Datadog](#datadog). | `server/tracing.mjs` |

## Gateway configuration file

`BIRBFORGE_CLIENT_CONFIG` is parsed by `GatewayConfig` (`server/gateway.ts:18-31`). It is read once at startup.

| Key | Meaning | Source |
| --- | --- | --- |
| `url` | Crew API, must be `http://127.0.0.1[:port]`. | `server/gateway.ts:19-22` |
| `tokens` | Principal to bearer token, each at least 32 characters, matching Crew's credentials. | `server/gateway.ts:23` |
| `mode` | `proof` (default) or `approved-goal`. `approved-goal` requires `delivery` and forbids `verification`. | `server/gateway.ts:25`, `server/gateway.ts:29-31` |
| `delivery.python`, `delivery.configuration` | Absolute paths. Use `/venv/bin/python`: the adapter runs with `PATH=/usr/bin:/bin` and the application directory as its working directory. Each command must finish within 20 seconds. | `server/delivery.ts:9-12`, `server/delivery.ts:31-34`, `server/delivery.ts:46` |
| `verification` | Fixture verification. Its Python module is not in this image, so leave it unset. | `server/verification.ts:10-13`, `Dockerfile:32-34` |
| `projects` | Projects mode and project chats, below. | `server/projects.ts:10-11` |
| `members` | Member chats, below. | `server/members.ts:8-12` |

### Projects and project chats

| Key | Requirement | Source |
| --- | --- | --- |
| `projects.owner_principal` | Only this principal can use project routes and the workspace. | `server/projects.ts:126`, `server/workspace.ts:13` |
| `projects.github.token_file` | GitHub token, read when the connection is first made and then kept until restart. Rotating it needs a gateway restart. | `server/github.ts:26-29`, `server/projects.ts:21-23` |
| `projects.github.owner_login` | Must match `GET /user` for that token. | `server/github.ts:31-34` |
| `projects.beans.binary` | `/usr/local/bin/bn` in this image. | `server/beans-projects.ts:6`, `Dockerfile:31` |
| `projects.beans.hub` | Writable Beans hub clone with an upstream branch, owned by UID 10001 so Git trusts it. The gateway requires a clean tree and `HEAD` equal to upstream before capturing chat context. | `server/beans-projects.ts:47`, `server/beans-projects.ts:52-59` |
| `projects.beans.home` | `HOME` for `bn` and `git`. Put the Git credential helper configuration for the hub remote here. | `server/beans-projects.ts:13-14` |
| `projects.beans.branch`, `projects.beans.actor` | Passed to every `bn` call. | `server/beans-projects.ts:47` |
| `projects.service_token_file` | Crew project service token, reread on every internal call and sent as `X-Birbforge-Project-Token`. Crew holds its SHA-256 as `project_service_token_sha256`. | `server/projects.ts:72-77`; Crew `docs/project-chats.md:9` |
| `projects.intent_directory` | Durable, writable. Created `0700`; intents are `0600`; the directory and its parent are fsynced, so the parent must be openable. | `server/project-intents.ts:26-38` |

Outbound HTTPS to `api.github.com` and to the hub remote is required. `bn` calls time out after ten minutes (`server/beans-projects.ts:20`).

### Member chats

| Key | Requirement | Source |
| --- | --- | --- |
| `members.url` | Crew member gateway, `http://127.0.0.1:<port>`. | `server/members.ts:9` |
| `members.token_file` | Reread on every call. Regular file, not a symlink, owned by UID 10001, mode `0600` or stricter. Otherwise turns stay pending. | `server/members.ts:51-60`, `server/members.ts:70` |
| `members.profiles` | At least one of `codex` or `pi`, each a profile registered by the Crew worker. | `server/members.ts:11` |

### Private listener

`BIRBFORGE_PROXY_CONFIG` holds `port` (1024-65535), `origin` (an exact `https://` origin) and optional `authentication` (`server/access.ts:11-18`). The file must be outside `/app/birbforge` (or under its ignored `.local/`), a regular file, owned by UID 10001 and mode `0600` or stricter (`server/access.ts:22-38`). The edge must connect from `127.0.0.1`, send `Host` equal to the origin's host, preserve `Authorization`, and not buffer event streams (`server/gateway.ts:61-64`; `docs/private-phone-access.md`).

## Volumes

| Path (example) | Mode | Contents | Source |
| --- | --- | --- | --- |
| `/tmp` | `emptyDir` | tsx compile cache and temporary checkouts | `server/catalog.ts:94` |
| `BIRBFORGE_WORKSPACE_DIR`, e.g. `/var/lib/forge/workspace` | durable, created `0700` by the gateway | `workspace-chats.sqlite` (`0600`), `crew.json`, `secrets/` (`0700`, files `0600`, owner checked) | `server/chat.ts:131-134`, `server/catalog.ts:124-128`, `server/secrets.ts:17-24` |
| `projects.intent_directory` | durable | operation intents | `server/project-intents.ts:26-38` |
| `projects.beans.hub` and `projects.beans.home` | durable, owned by 10001 | Beans hub clone and service home | `server/beans-projects.ts:13-14` |
| configuration and credential files | read-only, copied to `emptyDir` where owner checks apply | client config, proxy config, tokens, delivery config and its mTLS files | see tables above |

Mount the durable volume one level above the workspace (for example `/var/lib/forge`) and let the gateway create the workspace directory, so it is owned by UID 10001 with mode `0700`. Run one gateway per workspace directory (`docs/development.md`).

## Ports and probes

| Port | Bind | Purpose | Source |
| --- | --- | --- | --- |
| `8787` (`BIRBFORGE_PORT`) | `127.0.0.1` | Loopback listener. Requires `Host: 127.0.0.1[:port]`. | `server/main.ts:13`, `server/main.ts:23`, `server/gateway.ts:65-67` |
| proxy `port` (pilot `8788`) | `127.0.0.1` | Private listener for the TLS edge | `server/main.ts:25-28`, `server/access.ts:12`, `docs/private-single-owner.md:9` |
| `8000` | `127.0.0.1` | Crew API | Crew `docs/persistent-pilot.md:18` |

Both gateway listeners bind loopback only, so a kubelet `httpGet` probe to the pod IP cannot reach them. Use an `exec` probe, for example `["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>r.json()).then(b=>process.exit(b.chat==='live'?0:1)).catch(()=>process.exit(1))"]`, or probe through the edge with the external `Host`. `GET /healthz` without a query string returns `200 {"code":"ready","chat":"live"}` once the listener runs, with `chat` set to the configured `BIRBFORGE_CHAT_MODE` (`server/gateway.ts:70-75`). A production probe should require `"chat":"live"`. An image from before `BIRBFORGE_CHAT_MODE` existed sends no `chat` field and would answer chats locally when given no attestation path, so that probe keeps such an image out of service. The check does not cover Crew, Temporal, GitHub or storage (`docs/persistent-delivery.md`). The gateway prints `Forge loopback gateway ready.` after binding. When startup fails it exits with status 1 after printing a generic error, or the chat setting to correct when that is the cause (`server/main.ts:57-64`).

On `SIGTERM` the gateway closes both listeners and stops the member reconciler (`server/main.ts:29-31`). Under `tini`, the signal reaches the tsx launcher, which relays it to the gateway process.

## Delivery worker

| Item | Requirement | Source |
| --- | --- | --- |
| Command | `python -m delivery install <config>` once per installation, then `python -m delivery worker <config>`. | `delivery/__main__.py:34-76` |
| Probe | `python -m delivery health <config>` queries the workflow with a 5 second limit. It shows Temporal reachability, not author readiness. | `delivery/__main__.py:63-69` |
| Configuration | `temporal_address`, `namespace`, `workflow_id`, `workflow_task_queue`, `activity_task_queue`, `owner_principal`, `offer`, optional `tls` with `server_root_ca_cert`, `client_cert`, `client_private_key` paths and `domain`. Use absolute paths. | `delivery/model.py:10-25`, `docs/persistent-delivery.md:20` |
| Crew contract | Imported from `CREW_IMAGE`. Receipts from the OpenCode Go reviewer need a Crew image that accepts `opencode-go`. | `delivery/workflow.py:8-21` |
| Logs | Transition records are single-line JSON on stderr. | `delivery/__main__.py:15-31` |

The gateway also needs the same delivery configuration and Temporal reachability, because each delivery command runs the adapter in the gateway container (`server/delivery.ts:31`).

## Datadog

Tracing is off unless the gateway environment has `DD_TRACE_ENABLED=true` exactly. Any other value loads nothing (`server/tracing.mjs:3`).

| Variable | Use |
| --- | --- |
| `DD_TRACE_ENABLED=true` | Turns on `dd-trace` for the gateway process. |
| `DD_AGENT_HOST` or `DD_TRACE_AGENT_URL` | Datadog agent, for example `status.hostIP` through the downward API. |
| `DD_ENV`, `DD_VERSION`, `DD_SERVICE` | Unified service tags. `DD_SERVICE` defaults to `forge-gateway` (`server/tracing.mjs:4`). |

When tracing is on, the gateway forces these settings over the environment (`server/tracing.mjs:5-17`): no remote configuration, no AppSec, IAST or dynamic instrumentation, no header tags, no client IP, no baggage tags, no child-process spans, and full query-string redaction. Exported spans are inbound HTTP (method, path without query, status, user agent), outbound HTTP to Crew, the member gateway and GitHub (method, URL without query, status), and DNS lookups and TCP connects (host and port). None carry `Authorization`, cookies, query strings, request bodies or child-process arguments. Outbound calls carry Datadog and W3C trace headers. The forced variables are inherited by the chat-agent Python child.

Runtime metrics stay off unless `DD_RUNTIME_METRICS_ENABLED=true`. The tracer still sends its own DogStatsD client counters to the agent, over the agent's HTTP port when it accepts `/dogstatsd/v2/proxy` and otherwise over UDP to the agent host on `DD_DOGSTATSD_PORT` (default 8125). Allow both in network policy. With tracing on, the gateway also prints `DATADOG TRACER CONFIGURATION` and `DATADOG TRACER INTEGRATIONS LOADED` lines at startup; set `DD_TRACE_STARTUP_LOGS=false` to drop them.

Do not enable Datadog single-step instrumentation or admission-controller library injection for this pod. It loads the tracer without these overrides. Do not mount the agent's `/etc/datadog-agent` into the gateway container either: a fleet-managed `application_monitoring.yaml` there takes precedence over environment variables.

Gateway output is otherwise plain text with no per-request logs, so log-to-trace correlation is not wired. Collect container stdout and stderr with the agent's log collection.

For the delivery worker, collect its stderr with agent log collection and set `DD_ENV`, `DD_SERVICE` and `DD_VERSION` (or the `tags.datadoghq.com/*` labels) for unified tagging. Its JSON transition lines parse without a pipeline. Do not add `ddtrace` or library injection to the worker: the Temporal workflow sandbox has not been tested with it. The gateway already starts its adapter children with `DD_TRACE_ENABLED=false` and injection off (`server/delivery.ts:33-34`).

## What was checked

On an Apple silicon Mac with Docker in Colima, the image was built for `linux/amd64` (emulated) and `linux/arm64` (native) with the arguments above, against Crew images built from Crew PR 45 (`834ff9c`). Each container ran with `--user 10001:10001 --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp`, a tmpfs workspace owned by UID 10001, and a stub Crew API on port 8000 plus a stub Datadog agent on port 8126 in the same network namespace.

- `bn --version` printed `v0.4.0+bb55b2aa253a63cb18d8e4357ca8958d3fd5ad0b` and `git --version` printed `2.39.5`. `bn init` against a local bare remote, `bn --json project catalog`, and the gateway's `git rev-list` and `git status` calls succeeded on the read-only root.
- `tini` ran as PID 1 above the tsx launcher and the gateway. The `exec` probe above returned `200`. Authenticated requests reached the stub Crew API. The workspace was created `0700` with the chat database `0600`. `docker stop` exited 0 in under half a second.
- With tracing off, the stub agent received nothing and Crew calls carried no trace headers. With tracing on, the agent received trace, telemetry and DogStatsD client payloads tagged `forge-gateway`. None contained the bearer token, cookie, query value or message text sent in the requests.
- On emulated `linux/amd64`, tsx's esbuild helper (a Go binary) crashed in garbage collection under QEMU. The amd64 gateway runs therefore set `GOGC=off`. The native arm64 runs needed no workaround. Expect a real amd64 node to behave like arm64, but this was not run.
- `tests/tracing.test.ts` starts the gateway as the image command does, with tracing on and an environment that tries to turn every forced setting back on. It sends a bearer token, cookie, query value, `X-Forwarded-For` address, baggage value, message text, and a marker in a child process's arguments, and checks that none reach the agent or the gateway output. Removing any one of the header, query, client IP, baggage, child-process or AppSec overrides makes it fail. The remote configuration, IAST and dynamic instrumentation overrides are checked only as environment values.
- Forge's delivery Python tests pass against Crew PR 45, including an OpenCode Go receipt reaching a draft, and that snapshot parses in the Forge client contract.

Not verified: native amd64 hardware, any Kubernetes deployment, a real Datadog agent or backend, a Beans hub push over HTTPS, GitHub access, Crew's real API, member gateway or project worker, the TLS edge, `fsGroup` behavior, and a live OpenCode Go review.
