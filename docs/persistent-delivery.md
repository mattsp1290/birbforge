# One approved goal to a draft PR

The approved-goal pilot presents one installed, revision-bound Beans goal on the phone and in the browser. Both the conversation and inbox show the same AG-UI delivery snapshot. The owner can approve, reject, or request cancellation. Reconnecting only observes state.

Approval binds the goal digest, repository, base commit, allowed paths, acceptance policy, owner, and conversation. Birbforge stores the decision in one long-lived Temporal workflow. A second conversation cannot approve the same offer again. A retried command keeps its identity and original bytes. Reusing that identity with another action conflicts.

Birbcrew owns three versioned activities. The author produces a candidate and acceptance receipt. Claude independently reviews that exact candidate. Only an approved receipt can reach draft publication. Changed candidate or review identities stop the workflow. The installed offer is immutable; this pilot deliberately admits one goal rather than offering a second scheduler.

Cancellation remains requested until the producer reports confirmed cancellation. A disconnected observer, an activity timeout, or a missing reply does not prove termination. Unconfirmed effects remain uncertain. A draft may already exist if cancellation races publication; the recorded draft receipt remains visible.

## Install the control plane

Install Birbcrew in the Python environment that runs the delivery module. Run these commands from the Birbforge repository or installed application directory.

```sh
python -m delivery install /config/delivery.json
python -m delivery worker /config/delivery.json
```

The private delivery configuration contains `temporal_address`, `namespace`, `workflow_id`, `workflow_task_queue`, `activity_task_queue`, `owner_principal`, and the producer's `GoalOffer` object in `offer`. For mTLS, `tls` contains absolute paths `server_root_ca_cert`, `client_cert`, `client_private_key`, plus the expected certificate `domain`. Installation must use the same immutable workflow identity on every restart. Changing an existing goal requires a new explicitly reviewed installation.

Run the existing gateway with `BIRBFORGE_CLIENT_CONFIG`. Its private JSON sets `mode` to `approved-goal`, `url` to the same-pod Birbcrew loopback URL, and `tokens` to the configured principal credentials. Set `delivery` to an object containing the absolute Python executable in `python` and the delivery configuration path in `configuration`. Do not configure fixture verification in this mode. The web export is served from `dist`.

The gateway retains loopback binding and its exact HTTPS proxy origin policy. `GET /healthz` checks that the listener is running; it does not establish Temporal, provider, or storage readiness. TLS termination and forwarding belong to the installation package.

## Use the pilot

1. Open the private endpoint in the installed phone app or browser.
2. Enter the owner credential and create a conversation, or use **Find my conversations** to select an existing identity.
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

The Temporal test starts an isolated local development server. Set `TEMPORAL_TEST_SERVER` to an installed Temporal CLI binary if it is not `/opt/homebrew/bin/temporal`. It runs the real delivery workflow and restarts its worker while a test activity remains active. Provider activity doubles establish workflow behavior, not live Codex or Claude execution.

Real subscription execution, draft publication, persistent cluster restart, and current physical-phone acceptance require separate installation evidence. Fixture verification is disabled and these checks do not establish Birbverify staging eligibility.
