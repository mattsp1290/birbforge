# Run the disposable development proofs

Use `scripts/dev` for the original conversation proof. Use
`scripts/verification-dev` for the new durable verification fixture. The latter
also starts the conversation runtime. Do not run both launchers together.
The [durable queue reference](durable-verification-queue.md) separates this
milestone's acceptance evidence from historical native results.

## Run the original conversation proof

Use this Linux machine's existing Docker, Git, uv, bn 0.3.0, curl, ripgrep,
sha256sum, OpenSSL CLI, and Python prerequisites. No OS package installation is part of setup.
All runtime listeners bind to loopback. Do not use the private Beans hub.

1. Run `scripts/setup` to restore the locked repository JavaScript dependencies.
2. Run `scripts/dependency` to extract the exact pinned Birbcrew commit into a
   new temporary directory and run its documented setup. Set `BIRBCREW_SOURCE`
   only to an existing source checkout containing that commit. The default is
   `../birbcrew`. This reads the producer without changing it or merging a branch.
3. Run `scripts/npm run export:web`.
4. Run `scripts/dev` and keep it running while either client is in use.
5. Read the generated `.local/session.json` privately. Enter only its owner
   test credential into the UI at `http://127.0.0.1:8787`.
6. Create a conversation, send a goal, and copy its displayed identity to the
   second client's sign-in form. Use the same owner credential there.
7. Stop the launcher with Ctrl-C. It stops only its own processes and disposable
   container. Its fixture directory remains outside Git for inspection.

The launcher reuses Birbcrew's `Proof.boot` and `FixtureHub` helpers. It disables
only the producer's interruption failpoint before starting the UI conversations.
It uses deterministic TestModel fixtures and makes no live model calls. It
retains the producer's Temporal workflow, PostgreSQL store, AG-UI encoder, and
Beans context boundary. It is a development launcher, not a scheduler.

`.local/session.json`, all fixture credentials, service configuration, logs, and
screenshots stay private. The directory is ignored by Git. Treat its credentials
as disposable local fixture secrets. Do not publish the raw producer fixture
folder. No credential belongs in an EXPO_PUBLIC variable.

## Exercise the checks

With `scripts/dev` running, run the following commands in another shell.

```sh
scripts/npm exec expo install -- --check
scripts/npm run check
scripts/npm test
BIRBFORGE_CHROMIUM=/path/to/existing/chrome .local/bin/node scripts/browser-check.mjs
scripts/npm run export:native
scripts/npm run export:web
.local/bin/node docs/build.mjs
python3 docs/check.py
```

The browser check requires an existing authorized Chromium installation.
It does not download a browser or install operating-system dependencies.
It writes a private screenshot and a redacted transition report.

The ARM64 Linux host cannot run the dependency's x86-64 Linux Hermes compiler.
`export:native` therefore uses `--no-bytecode` and verifies JavaScript bundles
only. It does not build or run an iOS or Android app. On an authorized native
machine with Node and the matching toolchain already installed, restore this
repository with `npm ci` and run `npx expo start --localhost`. The Linux
extracted Node binary is not a Mac toolchain. Use the local signed native-build route in [Mac and iPhone verification](mac-iphone-verification.md).
Do not assume App Store Expo Go supports SDK 55. Do not install a
simulator, change account settings, or open a network listener to complete this
handoff. The native crypto and streaming adapters still require execution there.

A physical phone and Mac need existing authorized private connectivity to this
loopback development service. The original Linux proof found no such destination. Configure
no new tunnel, route, public listener, identity provider, or infrastructure as
part of this proof. Target acceptance remains open until an authorized path and
native target are available.

## Version selection

The lockfile is authoritative. The exercised versions are Expo 55.0.32,
React and React DOM 19.2.0, React Native 0.83.10, React Native Web 0.21.4,
Expo Crypto 55.0.19, and AG-UI client/core 1.0.4. The setup extracts Node 22.23.3
from the same digest-pinned Node image selected by the producer setup.
The producer pins Python 3.13.12, Pydantic AI 2.66.0, Temporal SDK 1.35.0,
Temporal CLI 1.10.0, and PostgreSQL 17.6. Dependency setup never changes the
producer checkout or global Node/model settings.

Expo's documented streaming fetch entry point supports the selected adapter.
[Expo SDK 55 fetch documentation](https://docs.expo.dev/versions/v55.0.0/sdk/expo/).
The stock CopilotKit component path was evaluated against its own native
interface documentation and installed-registry metadata.
[CopilotKit native useAgent](https://docs.copilotkit.ai/reference/react-native/hooks/useAgent).

For a complete disposable run, set `BIRBFORGE_CHROMIUM` to the existing binary
and run `scripts/verify` with no other Birbforge launcher active. The command
starts and cleans up its own runtime. A second launcher refuses an existing
session file. If a launcher was killed without cleanup, inspect its processes
before removing a stale private session file.

The current gateway accepts only Host `127.0.0.1` with an optional port.
A remote target requires an already authorized forward that presents that host.
A NetBird address used directly as the endpoint will be rejected. On a physical
phone, `127.0.0.1` names the phone itself. These constraints are deliberate for
this local proof and do not establish usable private device connectivity.


An optional exact-authority loopback backend for the existing private HTTPS
service is described in [private phone access](private-phone-access.md).
It uses the same generated credentials, producer, and actions. The automated TLS
proxy is a fixture only. No test CA is installed in OS or phone trust.

## Run the durable verification fixture

On Mac, prepare the existing Linux guest with `scripts/guest-setup` as described
in [host execution](host-execution.md). The verification launcher requires its
validated Birbverify export and private setup record. It runs Linux binaries in
the guest, including the real pinned Birbverify activity.

1. Stop any earlier Birbforge launcher through its owning terminal.
2. Run `scripts/guest -- scripts/npm run export:web`.
3. Run `scripts/guest -- scripts/verification-dev` in a dedicated terminal.
4. Open the fresh loopback URL printed by the launcher through the existing
   authorized guest access route. The launcher selects a free port.
5. Read `.local/verification-session.json` privately and enter its owner
   credential into the masked client field.
6. Create or reopen one conversation and select **Request verification**.
7. Open the same conversation on the second client and observe its request,
   attempt, result, evidence eligibility, and environment state.
8. Run `scripts/guest -- scripts/verification-dev --stop` after both clients finish.

The launcher creates a disposable target, a dedicated Temporal namespace, an
environment-queue worker, an independent real activity worker, and the existing
conversation fixture. It uses deterministic model fixtures and disables ambient
telemetry exporters. It installs the queue once before serving admission.
No live provider or private Beans hub participates.

The identity-checked `--stop` command stops the launcher's processes and removes its attempt containers and
disposable conversation database container. It removes only its own
`.local/verification-session.json`. Private fixture files and logs remain for
inspection. If the launcher was killed, inspect the session's fixture root,
process identities, and exact owned containers before cleanup. Do not remove a
session file to bypass an active launcher or use broad container pruning.
Do not start another runtime while ownership remains uncertain.

Transfer credentials only through an existing authorized private channel into a
mode-0600 local file. Disable shell tracing and redirect the transfer directly
to that file. On a Mac that shares this checkout with the guest, the session
file is already available through the shared filesystem. A private terminal can
copy its owner credential without printing it.

```sh
set +x
python3 -c 'import json; print(json.load(open(".local/verification-session.json"))["tokens"]["owner"], end="")' | pbcopy
```

After entry, clear the clipboard with `pbcopy </dev/null`. Do not put credential
bytes in shell arguments, chat, handoffs, screenshots, or public reports.
The private session also records the selected URL and queue configuration.
Keep those records, raw logs, and handoffs outside Git.

An unknown command acknowledgement keeps the original client action pending.
Use **Refresh and retry same verification action**. Do not create a replacement
request to conceal uncertainty. The UI has no quarantine-release control.
Supervisor reconciliation belongs to the separate trusted host procedure.
This fixture authorizes no new network route, proxy, trust profile, account
configuration, or production access.
