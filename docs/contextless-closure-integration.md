# Contextless closure consumer

Birbforge can keep one dispatched request outstanding after the activity worker loses its context. An operator closes that request through the pinned Birbverify supervisor. The queue advances only after the exact request has a validated closure receipt and a fresh, unchanged target snapshot reports no owner. A normal verification release remains a separate attributable path.

This implementation pins Birbverify `e785dd8882222b18eaf59ce2b1ceecbd092dcd9e`. Birbverify owns the target journal, permanent seal, execution fence, stop, cleanup and release. Birbforge owns admission, the durable environment queue and delivery eligibility. Closure does not create a verification manifest or grant eligibility.

## Fresh configuration

Use an explicit `closure-v2` queue configuration with the producer's installed `closure_binding`. The workflow ID must end in `-closure-v2`. The installation binding is captured again on each admitted row. Changed incarnation, missing capabilities or an adapter revision mismatch fail closed.

This is a fresh workflow profile. Replaying an older queue history under changed workflow code is unsupported. Existing compatibility fixtures select `legacy-v1` explicitly. Legacy supervisors are rejected on v2 targets before reading a recovery receipt or context.

The interactive fixture launcher defaults to v2. `scripts/verification-dev --legacy-v1` selects the historical proof profile. `scripts/verification_http_proof.py` selects that compatibility profile explicitly. The historical `scripts/verification-browser.mjs` requires it and is not the closure browser acceptance recipe.

## Operator command

Run the command with the queue's producer Python environment and Birbforge working directory. The authenticated supervisor reads its private key from the installation. Neither the gateway nor the observation activity reads that key.

```sh
python -m verification.supervisor /private/queue.json REQUEST_UUID CLOSURE_UUID request
python -m verification.supervisor /private/queue.json ATTEMPT_ID CLOSURE_UUID attempt
```

A successful CLI exit means the producer accepted or replayed the operation. It does not mean the environment is released. Inspect `progress.phase` and `progress.receipt` in the JSON response. A pending phase with a null receipt remains blocked. Never-dispatched queued requests are rejected. A fresh command also requires that the queue still owns this request as outstanding. Historical commands remain replayable after release, but a normally completed request cannot create a new keyed closure.

Both routes resolve the same queue request and acquire the same request lock before producer effects or cached returns. The command is written once, fsynced and preserved under `closure-commands/`. Repeat the same closure UUID and reason. The original nullable expected attempt and epoch remain unchanged. A different identity or payload conflicts. If the local command file was lost after target commit, the supervisor can adopt the target's exact original command after checking the admitted payload, target binding and caller identity.

Rotating the installation closure actor or grant makes an existing command conflict. This is intentional fail-closed behavior. Preserve the original installation authorization when replaying; there is no automatic command rewrite or authority migration.

A blocked reply is durable progress, not permission to retry verification or change identity. Unknown mutating delivery remains quarantined. A receipt may describe historical release while the target has a new owner. Replaying the old closure cannot release that owner.

## Queue and client state

`outstanding_request_id` is independent of result phase. It survives terminal manifests, activity failure, cancellation, restart and Continue-As-New. Queued cancellation and queued expiry never acquire this responsibility. Once valid release retires it, later historical proof invalidation remains visible without resurrecting ownership or touching a successor.

The observer reads an atomic target snapshot, validates retained closure evidence and binding, then reads another snapshot. A changed target revision cannot authorize queue release. Historical manifest bytes remain immutable, or remain absent. Missing attempts are shown as not recorded until the target proves the request never acquired execution.

Both conversation and inbox receive the same AG-UI state. Closure is absent, pending or historically released. Released history has a separate current proof validity. Target revision and workflow revision are distinct. Client reconnect never submits work, and a stale target revision cannot overwrite newer facts. No public recovery action was added.

## Isolated fixture proof

Use a fresh Linux driver with a short daemon-shared directory such as `/private/tmp/bfi8`. The driver needs the host PID and cgroup view for the pinned launcher to register its worker. The worker keeps a private PID namespace, drops capabilities and has no restart policy. It receives the producer's existing scoped mounts. Its small Temporal entry and public config live in `launch/`; no broad Birbforge source mount or producer overlay is added.

Prepare pinned exports and locked dependencies using the repository setup guidance. On the host with the pinned Git checkouts available, create a private export attestation:

```sh
python3 scripts/closure-attestation.py prepare /private/proof/export-attestation.json
```

The command verifies both Git archives and saves their exact bytes beside the attestation. It records the prepared Temporal binary hashes. Mount that private directory into the isolated driver and provide these variables:

```sh
export BIRBFORGE_EXPORT_ATTESTATION=/private/proof/export-attestation.json
export BIRBFORGE_FIXTURE_ROOT=/private/tmp/bfi8
export BIRBFORGE_CLOSURE_EVIDENCE=/private/proof/closure
export BIRBVERIFY_WORKER_IMAGE=sha256:REVIEWED_IMAGE_ID
scripts/verify-closure-integration
```

The script rechecks export archive membership and bytes, selected import origins, the expected adapter digest and prepared Temporal binary hashes before running tests. Installed virtualenv dependencies are outside this source attestation. It runs Python queue, adapter, real Temporal/producer journeys, fixture launcher checks and shared TypeScript contract/client checks. Reports and JUnit stay in the private evidence directory. Real worker loss, dropped transport replies, missing and corrupt retained proof, concurrent supervisor processes and late worker arrival are exercised by `test_closure_temporal.py`. The launcher fsyncs an exact producer-generated container name before creation, then atomically publishes its registered ID and entry digest. Cleanup includes those launch identities and target-registered workers as well as target-recorded attempts. A crash before registration remains attributable without broad container enumeration. These fixture boundaries provide attribution and cleanup, not a security sandbox against a worker with Docker socket access.

Runtime evidence and independent review are recorded separately at publication. Source exports or Linux browser checks do not establish physical phone acceptance. The changed closure labels need an exact-revision Mac/iPhone handoff. Large Text and VoiceOver remain owner-deferred. Staging readiness, native candidate isolation, production identity and live deployment remain separate work.
