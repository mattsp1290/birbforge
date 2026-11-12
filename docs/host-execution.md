# Run Forge from a Mac through Linux

Use an existing Linux ARM64 Colima profile to run the original Linux setup and
runtime commands from a Mac. This is Mac-hosted Linux execution. The extracted
Node, Python, and Temporal binaries run in Linux. They do not provide native
macOS or iPhone acceptance.

Start a healthy Docker Colima profile separately. The wrappers check its state
and Docker engine. They do not start, restart, repair, or reconfigure Colima.
Host repository and private state paths must appear at the same paths in the
guest. The existing profile must provide Git, Python 3, Docker, curl, and tar.
The Mac needs Python 3.12 or newer, Git, and Colima.

Prepare the pinned producers from local source checkouts.

```sh
scripts/guest-setup \
  --crew-source /path/to/crew \
  --verify-source /path/to/verify
```

The default private root is `~/.local/state/birbforge/guest`. Use `--root` to
select another root, and `--profile` to select an existing Colima profile.
The command downloads checksum-pinned Linux ARM64 uv 0.11.3, ripgrep 15.1.0,
and Beans 0.3.0. It exports Crew commit
`88b219c18adeb352d2f291f099ede990a3190a58` and Verify commit
`a70315a276837ffdde32049fdb77670a3468e151`, then runs their original
`scripts/setup` commands and Forge's original `scripts/setup` in Linux.
Producer setup also downloads its declared pinned runtime artifacts.

To reuse prepared exports, pass `--crew-export`, `--verify-export`, and
`--tools-root`. Keep the corresponding source checkouts available for validation.
Use `--prepare-only` to record and validate those paths without running the
producer or Forge setup commands. Missing tools are still downloaded and
verified. The private JSON record contains paths, the profile, and producer
revisions. The ignored `.local/guest-setup-path` points to that record.

Run commands through the guest wrapper.

```sh
scripts/guest -- uv --version
scripts/guest -- scripts/dev
scripts/guest --producer verify -- .venv/bin/python -m pytest --basetemp /tmp/bfv-tests
```

For the new durable queue fixture, run the following after guest setup. Keep
the verification launcher in the foreground until the clients finish.

```sh
scripts/guest -- scripts/npm run export:web
scripts/guest -- scripts/verification-dev
```

Use the fresh loopback URL printed by `verification-dev`. Read the private
`.local/verification-session.json` for its generated credentials. This launcher
starts both the conversation fixture and verification fixture. Do not also run
`scripts/dev`. In a second terminal, run `scripts/guest -- scripts/verification-dev --stop`.
It verifies the recorded Linux launcher identity before signalling it, stops its
owned processes and containers, and removes its own session pointer. It retains private fixture files and logs for inspection.
After an abrupt stop, inspect the recorded process and container ownership
before removing stale session state. See `docs/development.md` for credential
transfer and cleanup details. Setup changes no network or account configuration.

Use a short `/tmp` test directory for Verify. Its Unix sockets can exceed
Linux's path length limit inside long export paths. Forward only the private
owner URL that the approved access procedure requires. Read runtime session
credentials from `.local/session.json` privately.

Before execution, the wrapper checks pinned tool bytes and every file in each
producer's pinned Git archive. It also runs Crew's existing source fixture
check and checks Verify's pinned source manifest. No producer source overlay
is applied. `.local/dependency-path` selects the validated Crew export for
the existing runtime. Python downloads and caches remain under the private root.
The wrapper does not copy host credentials or the private notes hub.

On a Linux host, continue to use the existing `scripts/setup`,
`scripts/dependency`, and `scripts/dev` directly. The guest wrappers do not change
those commands. Setup and version checks alone do not establish milestone or
feature acceptance.

## Optional existing private HTTPS route

The guest wrapper intentionally does not forward arbitrary host environment
variables. Set the proxy path inside the guest command when the route owner has
selected an existing authorized route and a free owned backend port.

```sh
scripts/guest -- env BIRBFORGE_PROXY_CONFIG=/absolute/private/proxy.json scripts/verification-dev
```

The file must be visible at that absolute guest path and pass the existing
owner-only configuration checks in `docs/private-phone-access.md`. Both
listeners bind only to guest loopback. The launcher waits for a new readiness
receipt on each gateway start and records the validated `proxy_origin` in the
private `.local/verification-session.json`. A malformed file or occupied port
fails startup and invokes the launcher's scoped cleanup. Without the variable,
the runtime retains its default loopback-only behavior.

This command does not create an HTTPS route or forward. The route owner must
verify TLS, service target, peer port and backend reachability before sending
new credentials. A synthetic Host/Origin test on loopback does not verify the
owner's external service or physical iPhone transport.
