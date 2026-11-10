# Verify the same conversation on Mac and iPhone

Physical queue acceptance is recorded for product revision
`6b46dac2931225e0739e9deb047e48b956bff8fc`, using the explicit native fixture
build at `88a8182346c380bd15f4b7b2ec7f442f81dbd130`. Read the
[current results and cancellation qualification](durable-verification-queue.md#physical-iphone-acceptance)
and [evidence binding](evidence/verification-native.json) before repeating a
journey. Native OS Large Text and VoiceOver remain DEFERRED / NOT VERIFIED.

The procedure below is the original exact-revision queue handoff. At that
checkpoint the recovery host lacked a phone, and the first owner attempt was
blocked by the private route. Those historical limitations are superseded by
the recorded physical checks, not by the launcher fix alone. For transport
fault injection, use the separate [native fixture entry point](../tests/native-fixture/README.md).

The local owner exercised functional device journeys at
5d333cda03a6b385b669f6025b248d4ba4272071. [Current acceptance](evidence/acceptance.md)
records those historical results and limits. That revision does not contain the
new queue controls. The original conversation procedure below remains for
repeat or broader acceptance.
The native verification owner executes this handoff locally and returns
attributable evidence through the authorized project handoff. Use the exact branch and full
commit in the private Beans handoff. Do not test a moving branch tip.

## Verify the queue at its final revision

The reviewed and exercised implementation commit is
`2893bf3d68b7e582c5bd641b3bd272afc81e56da`. The later delivery commit changes only
documentation and evidence binding. Test this immutable implementation revision,
not a moving branch tip.

```sh
BIRBFORGE_REVISION=2893bf3d68b7e582c5bd641b3bd272afc81e56da
git fetch origin fix/verification-private-route
git worktree add --detach "$BIRBFORGE_MAC_CHECKOUT" "$BIRBFORGE_REVISION"
cd "$BIRBFORGE_MAC_CHECKOUT"
git rev-parse HEAD
npm ci
npx expo install --check
npm run check
```

The retained signed build belongs to the earlier delivery. App, lockfile and
native configuration are unchanged by this launcher fix. The native owner may
reuse it only after binding those files and its retained artifact hashes to the
new revision. Build/install success alone does not satisfy any journey.

Use the existing Mac Node and native toolchain. Follow the prerequisite and
signed Release-build steps below. A historical binary, Darwin version probe,
or Linux native-bundle export cannot verify this commit.

Create a second checkout at the same revision for the Linux runtime. Keep its
Linux `node_modules` and `.local` tools separate from the native build checkout.
Prepare the existing Linux guest with `scripts/guest-setup` as documented in
`docs/host-execution.md`. Start the queue runtime instead of `scripts/dev`.

```sh
git worktree add --detach "$BIRBFORGE_RUNTIME_CHECKOUT" "$BIRBFORGE_REVISION"
cd "$BIRBFORGE_RUNTIME_CHECKOUT"
scripts/guest-setup --root "$BIRBFORGE_PRIVATE_RUNTIME_ROOT"
scripts/guest -- scripts/npm run export:web
scripts/guest -- env BIRBFORGE_PROXY_CONFIG="$BIRBFORGE_PRIVATE_PROXY_CONFIG" scripts/verification-dev
```

Before starting, have the route owner select an existing authorized service
and a free owned backend port. Set `BIRBFORGE_PRIVATE_PROXY_CONFIG` to its
absolute owner-only configuration path visible in the guest. The [guest
instructions](host-execution.md#optional-existing-private-https-route) explain
why the variable must be set inside the guest command. This source fix neither
creates nor verifies a live route. Verify TLS, endpoint identity and the expected
unauthenticated 401 from `/api/conversations` through the existing HTTPS route
before transferring fresh owner credentials. Keep route details private.

Use the launcher's selected loopback port and private
`.local/verification-session.json`. Transfer its credentials with the private
procedure in `docs/development.md`. Both clients must reach that same runtime
through an existing authorized route. The fixed port and `.local/session.json`
examples in the original conversation procedure below apply to `scripts/dev`.
They do not select the new queue runtime. If the existing phone route cannot
reach the new runtime, record the gate without changing network configuration.

Exercise the changed `app/App.tsx`, `app/src/controller.ts`, and
`app/src/verification.ts` paths through the native app. Those paths consume the
new shared verification contract and gateway observation and action boundary.
Retain the original conversation journeys, then capture these queue transitions.

| Journey | Required observation |
| --- | --- |
| Shared request | Admit on iPhone. Mac shows the same request and idempotency identities, acquired attempt or null, phase, outcome, eligibility, and environment state |
| Cancellation | Cancel from one client. Both distinguish requested cancellation from acknowledged stop or a too-late result |
| Reconnect | Background and foreground the phone and interrupt the existing observation route. Restore the same request without new admission or cancellation |
| Unavailable acknowledgement | Preserve the original pending action and reconcile with refresh and the same command identity. Do not report success from a timeout |
| Historical result | After the trusted host recovery procedure, show the unchanged original manifest and the separate recovery receipt alongside current environment state |
| Evidence gate | Show a passed historical outcome with a now-ineligible reason when the controlled fixture invalidates required artifacts or candidate freshness |
| Native rejection and usability | Exercise invalid credentials, stranger access and forged action fields from the native path, then capture ordinary native control use. Mac diagnostics do not satisfy this journey; OS Large Text and VoiceOver remain deferred |

Record the exact tested commit, native build provenance, device and OS,
browser, timestamps, and sanitized identities. Keep native logs, private route
details, credentials, screenshots, and the continuation handoff outside Git.
Run `scripts/guest -- scripts/verification-dev --stop` when finished. Return explicit NOT VERIFIED
or INCONCLUSIVE statuses for blocked checks. Keep Large Text and VoiceOver
deferred unless the owner separately authorizes and completes those checks.
Review the new verification permissions before merge. The previously resolved
generic authentication gate remains resolved. No merge is authorized here.

## Inspect prerequisites locally

The local owner checks existing Git status and repository instructions, macOS
and browser versions, Node, Xcode, selected developer tools, CocoaPods, and the
connected iPhone. Record device model, iOS version, and a private device identity.
Use existing approved signing credentials and device pairing. Developer Mode,
trust prompts, missing SDKs, or signing enrollment are explicit device setup
gates. Do not install OS packages or change account, network, or signing settings
without the owner's authorization. Preserve unrelated work in a separate worktree.

An existing authorized SSH connection to the Linux machine is needed for the
Mac browser. The iPhone also needs the reviewed [private HTTPS and SSH bridge route](private-phone-access.md)
to the same Linux loopback runtime. Inspect the route and the applicable trust
profile before a new build. Any new or re-created bridge must still establish LAN and
other non-NetBird ingress denial or wait for explicit human permissions review
before owner tokens are sent. The recorded owner-use run declined proxy-only peer
isolation; it did not establish LAN/other-ingress denial or acceptance of that risk.

## Check out the exact revision on Mac

Set `BIRBFORGE_REVISION` to the full hash in the Beans handoff and choose a new
worktree path outside the current checkout. These variables contain no secrets.

```sh
git fetch origin review/first-milestone-ui
git worktree add --detach "$BIRBFORGE_MAC_CHECKOUT" "$BIRBFORGE_REVISION"
cd "$BIRBFORGE_MAC_CHECKOUT"
git rev-parse HEAD
npm ci
npx expo install --check
npm run check
```

Use the Mac's already installed Node and npm. Do not run the Linux binary
extraction in `scripts/setup` on Mac. The lockfile pins Expo 55.0.32, React Native
0.83.10, React Native Web 0.21.4, and AG-UI client/core 1.0.4.

## Start one disposable runtime and connect the browser

Keep the Linux runtime in the reviewed checkout. Through the existing authorized
SSH destination, verify its HEAD equals `BIRBFORGE_REVISION`. In a dedicated
terminal on Linux, run the following commands. The dependency setup is already
available on the implementation machine. Rerun it only if the isolated source
is missing or its 24-hash check fails.

```sh
scripts/npm run export:web
scripts/dev
```

Keep that terminal running. The launcher creates fresh Temporal, PostgreSQL,
fixture credentials, and an explicit disposable Beans hub. It uses deterministic
model fixtures. Do not select a live provider. Never point fixture commands at
the private Beans hub. The launcher prints no credential.

On Mac, set `BIRBFORGE_SSH_HOST` privately to the existing authorized SSH alias or
destination. Do not commit it. Start an encrypted loopback forward in a second
terminal and leave it running.

```sh
ssh -N -T -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8787:127.0.0.1:8787 "$BIRBFORGE_SSH_HOST"
open http://127.0.0.1:8787
```

If that local port is occupied, choose another free loopback port and use it in
the browser URL. This is a transient SSH session, not a network configuration
change. Do not bind the forward to a LAN address or use `-g`.

Transfer the generated Linux `.local/session.json` into a mode-0600 file in a
new private Mac temporary directory through the same existing SSH connection.
Redirect SSH output straight to that file. Do not print it to a terminal, put
its contents in a prompt, or include it in a recording. Enter only the owner
token into the masked credential field on each client. Clear any clipboard
copy after use. The stranger token is only for the rejection check. Keep both
credentials out of Git, Beans, logs, screenshots, and exported environment files.

For the private transfer, replace `<linux-checkout>` with the path supplied in
the private Beans handoff. Run this in a local terminal with tracing disabled.
The command writes directly to a private file and sends the owner token only
to the Mac clipboard. The token never appears in the command text.

```sh
set +x
umask 077
BIRBFORGE_PRIVATE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/birbforge-device-XXXXXX")
ssh "$BIRBFORGE_SSH_HOST" 'cat "<linux-checkout>/.local/session.json"' > "$BIRBFORGE_PRIVATE_DIR/session.json"
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tokens"]["owner"], end="")' "$BIRBFORGE_PRIVATE_DIR/session.json" | pbcopy
```

After pasting into the masked field, clear the clipboard with `pbcopy </dev/null`.
Transfer to the iPhone only through the owner's already approved private
credential-entry method. Do not send a token through Beans or Codex chat.

## Launch the native iPhone app

Use a local, device-signed native build with bundled JavaScript. This avoids a
Metro connection between phone and Mac and does not require a cloud build.
The selected Expo SDK 55 CLI supports these flags, as checked on Linux. The
actual Xcode build and device installation remain local gates.

```sh
cd "$BIRBFORGE_MAC_CHECKOUT"
npx expo run:ios --device --configuration Release --no-bundler
```

Select the connected, already paired iPhone. This command generates the native
iOS project, installs repository native dependencies, builds, and installs the
app using existing Xcode tools and approved signing. Its generated `ios` folder
and native build products are local verification artifacts. Do not commit them.
If prerequisites or signing are missing, record the exact gate instead of
installing toolchains or changing developer accounts. An existing matching native
binary may be installed with the CLI's `--binary` route only if its source
revision and dependency provenance are established.

Do not assume the App Store Expo Go supports SDK 55. Current Expo documentation
states that App Store Expo Go stops at SDK 54. No TestFlight, EAS account setup,
or SDK migration is part of this handoff.
[Expo Go compatibility](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/).
The local native build and Release configuration are documented by Expo.
[Expo local builds](https://docs.expo.dev/guides/local-app-development/),
[Expo CLI](https://docs.expo.dev/more/expo-cli/).

## Establish iPhone runtime access explicitly

The iPhone app's `127.0.0.1` is the phone, not the Mac or Linux machine.
The default Linux gateway accepts only Host `127.0.0.1` with an optional port. It binds
only to Linux loopback. The optional [private proxy adapter](private-phone-access.md)
adds an exact-authority loopback backend for the existing private HTTPS service
and an already authorized enrolled-peer SSH bridge. The reported owner-use
profile trusts enrolled peers and does not claim proxy-only bridge isolation. Do not enter a raw Mac LAN or NetBird IP and claim that
it should work.

An existing authorized on-device SSH forward can provide a phone-local loopback
endpoint through encrypted SSH to Linux, if that already installed client
supports forwarding while Birbforge is foregrounded. The preferred route uses the existing private HTTPS service and an already
authorized enrolled-peer SSH bridge to the optional loopback proxy backend. It
preserves the configured external HTTPS Host. The legacy HTTP listener still
accepts only the loopback Host. For the stricter trust profile, prove the bridge port is inaccessible directly
from other peers and LAN ingress before owner tokens are used. The owner explicitly
declined proxy-only segregation among friendly enrolled peers for the reported
private verification setup. Do not infer acceptance of LAN/other-overlay exposure. Verify certificate
trust, route ownership, authentication forwarding, and foreground/background
behavior locally. Keep destination and certificate configuration private.

The local owner must name and exercise one of those existing routes before
acceptance. Neither route has been observed from Linux. The Mac-only SSH forward
above does not create phone access. If no suitable route exists, report
`iPhone connectivity NOT VERIFIED` with the smallest additional setup needed.
Do not expose port 8787 publicly, bind all interfaces, disable TLS checks, change
VPN routes, install a tunnel product, or add a new proxy under this handoff. Use the existing private HTTPS service
and the reviewed adapter when its scoped activation is authorized.

In **Settings**, enter the authorized phone-local or private HTTPS endpoint as the **Server URL**. Enter the same owner credential used in the Mac browser and select **Connect machine**. Open **Factory** to create or continue a goal workflow.
Both paths must terminate on the same running disposable Linux runtime.

## Run all six journeys

Use a fresh conversation begun on the iPhone. Keep its UUID, actual pending
request ID, version, input count, decision count, and finalized message IDs in
redacted evidence. Never put the credential-bearing private session file or an
authenticated network trace into public evidence.

| Journey | Execute and capture |
| --- | --- |
| Phone to browser | Send a synthetic coding goal on native iPhone. Open its displayed conversation UUID in the actual Mac browser with the same owner. Capture matching finalized messages, pending ID/version, and context note identities. Record both target identities and transitions. |
| Inbox to conversation | Resolve that request from the Mac inbox. Observe the same choice and cleared pending input in the iPhone conversation. On a separate fresh fixture conversation, reverse the surfaces and resolve from native conversation. Capture one decision per request. |
| Racing answers | Preserve the displayed ID/version on both devices. Submit different choices concurrently through the same Birbforge decision action. Capture one accepted result, an explicit HTTP 409 conflict for the loser, and converged authoritative state. A stale version must also reject explicitly. |
| Connection loss | Interrupt observation through the already authorized route or device network without cancelling. Capture disconnected/connecting state, restoration, a new observation, identical conversation identity, and unchanged accepted input count. No send action or new prompt UUID may occur on reconnect. Test iPhone background/foreground recovery too. |
| Unauthorized action | Use the fixture stranger or invalid credential and an attempted locally forged owner/request. Capture 404 or 401 rejection and unchanged owner state. An `actor` decision field must return 400. Redact all headers and tokens. |
| Accessibility | For full accessibility acceptance, run the core journey with OS large text on iPhone and VoiceOver-labelled controls. These native checks are deferred for current owner use and must remain NOT VERIFIED until run. On Mac, use actual Tab traversal and Enter/Space activation with visible focus. Capture settings, device/browser versions, control labels, and successful transitions. The application body-text toggle is additional evidence, not OS font scaling. |

The producer has four inputs per conversation. Use separate disposable
conversations for independent attempts when needed. Do not request workflow
replacement or Continue-As-New. Disconnect is separate from the explicit
cancellation button. GET and finalized snapshots are authoritative. A stale
cursor is not arbitrary token replay. These are synthetic decisions with no
merge, PR, or production authority.

For race or stale checks that require a direct authenticated request, use a
private script that reads the session file at runtime. Never paste a bearer
literal into a shell command or Codex message. The existing runtime test shows
the payload shape. Capture status, sanitized code, ID/version, and final state.

## Return attributable evidence through Beans

Write a new project-scoped continuation handoff with the exact tested revision,
macOS/browser and iPhone/iOS/build identities, dependency versions, private
artifact references, timestamps, and one status per journey. Explain every
NOT VERIFIED or INCONCLUSIVE gate. Public reports may contain fixture UUIDs and
hashes, but never private destinations or credentials. Keep raw screenshots and
recordings private until a credential scan and visual inspection pass.

Use the existing bn hub configuration only for this authorized handoff. Do not
browse unrelated hub records. The Linux runtime's fixture hub is a different,
disposable hub and must never receive the cross-machine continuation record.

Human authentication and permission review remains required before merge even
if all six device journeys pass. Do not merge or deploy. Report a producer
incompatibility with its smallest fixture before proposing a producer change.

During the native build, inspect generated iOS App Transport Security and local
network declarations for the selected endpoint. The JavaScript app does not
set an ATS override. If the existing phone-local HTTP route is blocked, preserve
the sanitized native error and report that gate. Do not disable ATS or TLS checks
to make the journey appear to pass.
