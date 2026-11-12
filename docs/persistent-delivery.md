# One approved goal to a draft PR

The approved-goal pilot presents one installed, revision-bound Beans goal on the phone and in the browser. Both the conversation and inbox show the same AG-UI delivery snapshot. The owner can approve, reject, or request cancellation. Reconnecting only observes state.

Approval binds the goal digest, repository, base commit, allowed paths, acceptance policy, owner, and conversation. Forge stores the decision in one long-lived Temporal workflow. A second conversation cannot approve the same offer again. A retried command keeps its identity and original bytes. Reusing that identity with another action conflicts.

Crew owns three versioned activities. The author produces a candidate and acceptance receipt. An independent reviewer, Claude CLI or OpenCode Go as configured in Crew, reviews that exact candidate and the receipt records which one ran. Receipts naming `opencode-go` need a Crew image whose `ReviewReceipt` accepts it; older Crew rejects them. Only an approved receipt can reach draft publication. Changed candidate or review identities stop the workflow. The installed offer is immutable; this pilot deliberately admits one goal rather than offering a second scheduler.

Cancellation remains requested until the producer reports confirmed cancellation. A disconnected observer, an activity timeout, or a missing reply does not prove termination. Unconfirmed effects remain uncertain. A draft may already exist if cancellation races publication; the recorded draft receipt remains visible.

## Install the control plane

Install Crew in the Python environment that runs the delivery module. Run these commands from the Forge repository or installed application directory.

```sh
python -m delivery install /config/delivery.json
python -m delivery worker /config/delivery.json
```

The private delivery configuration contains `temporal_address`, `namespace`, `workflow_id`, `workflow_task_queue`, `activity_task_queue`, `owner_principal`, and the producer's `GoalOffer` object in `offer`. For mTLS, `tls` contains absolute paths `server_root_ca_cert`, `client_cert`, `client_private_key`, plus the expected certificate `domain`. Installation must use the same immutable workflow identity on every restart. Changing an existing goal requires a new explicitly reviewed installation.

Run the existing gateway with `BIRBFORGE_CLIENT_CONFIG`. Its private JSON sets `mode` to `approved-goal`, `url` to the same-pod Crew loopback URL, and `tokens` to the configured principal credentials. Set `delivery` to an object containing the absolute Python executable in `python` and the delivery configuration path in `configuration`. Do not configure fixture verification in this mode. The web export is served from `dist`.

The gateway retains loopback binding and its exact HTTPS proxy origin policy. `GET /healthz` checks that the listener is running; it does not establish Temporal, provider, or storage readiness. TLS termination and forwarding belong to the installation package.

## Use the pilot

1. Open the private endpoint in the installed phone app or browser.
2. Select one of the five recent conversations, or create a new one. Explicit private single-owner installations need no client credential. Bearer installations still require their owner credential.
3. Read the installed goal and its allowed paths. Select **Approve goal and start** to authorize that exact offer.
4. Observe authoring, independent review, and draft publication in either view.
5. Open the draft PR from the completed card. This pilot never merges or deploys a job's PR.

Credentials remain in memory. They are not stored in browser local storage. A failed command acknowledgement retains the original command for an explicit retry; AG-UI observation can reconcile its durable receipt first.

## Verify the implementation

```sh
npm run check
node_modules/.bin/tsx --tsconfig tsconfig.node.json --test tests/delivery.test.ts
python -m pytest tests/delivery_python -q
```

The Temporal test starts an isolated local development server. Set `TEMPORAL_TEST_SERVER` to an installed Temporal CLI binary if it is not `/opt/homebrew/bin/temporal`. It runs the real delivery workflow and restarts its worker while a test activity remains active. Provider activity doubles establish workflow behavior, not live Codex, Claude or OpenCode Go execution.

Real subscription execution, draft publication, persistent cluster restart, and current physical-phone acceptance require separate installation evidence. Fixture verification is disabled and these checks do not establish Verify staging eligibility.

## Build the pilot image

The Dockerfile takes immutable `NODE_IMAGE` and `CREW_IMAGE` build arguments. Use a Node 22 Debian slim image compatible with the pinned Python 3.13 Crew image. The build exports the web application and includes the Crew execution contract through the base image. It excludes host dependencies, private configuration, credentials, and local evidence from the build context. The runtime defaults to UID/GID 10001 and needs private configuration files readable by that identity.

```sh
docker build --build-arg NODE_IMAGE="$NODE_IMAGE" --build-arg CREW_IMAGE="$CREW_IMAGE" -t "$FORGE_IMAGE" .
```

`python -m delivery health /config/delivery.json` queries the fixed workflow without changing it. Successful queries establish workflow service availability. They do not establish subscription authentication, authoring-worker readiness, or end-to-end delivery.

## Retry an inconclusive review

**Retry independent review** requests a new numbered attempt for the same candidate after a confirmed terminal inconclusive review. It preserves the author result and previous review. It does not repeat the author, change the approved goal or retry a substantive rejection. An interrupted reviewer or an unconfirmed activity remains uncertain and requires operator reconciliation.

Upgrade Crew first, then Forge. The compatibility test replays a frozen pre-retry workflow history before exercising the new command and worker restart. This proves the recorded legacy history shape, not every possible operational failure.
