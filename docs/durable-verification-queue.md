# Durable verification queue

Status on November 6, 2026. This milestone adds Birbforge's first durable
environment queue and shared verification view. The local execution checks and independent source review passed.
Physical iPhone fixture acceptance is now recorded for product revision
`6b46dac`, using the separate native test build at `88a8182`. The
[cancellation qualification and current results](#physical-iphone-acceptance)
below distinguish fresh checks from earlier evidence. Native OS accessibility
checks remain owner-deferred; real staging remains unverified.

This is an isolated, synthetic Linux Docker fixture. It grants no staging,
production, PR, or merge authority. The broader
[verification contract](verification-contract.md) remains a proposal wherever
it exceeds the concrete pinned producer behavior below.

## Pinned producer and queue ownership

Birbforge consumes Birbcrew commit
`88b219c18adeb352d2f291f099ede990a3190a58` and Birbverify commit
`a70315a276837ffdde32049fdb77670a3468e151` without source overlays.
Birbverify supplies its real `Activities.verify` activity, target fencing,
immutable request/result contract, artifact reader, and fixture procedures.
Birbforge supplies `verification.workflow.EnvironmentQueue`.
Birbverify's `FixtureWorkflow` is not the environment queue.

Each admitted producer request has one attempt budget and one immutable
terminal result. An identical terminal request returns its original result.
Neither reconnect nor supervisor recovery reruns that request. Automatic
execution retries and replacement terminal manifests are outside this milestone.

| Authority | Responsibility |
| --- | --- |
| Authenticated gateway | Checks existing Birbcrew conversation ownership and accepts only admission, cancellation, and observation payloads |
| Installation policy | Binds the exact candidate, approved plan, policy, permitted operations, deadline, and fixture capabilities |
| Birbforge Temporal workflow | Owns admission order, immutable bindings, idempotency receipts, request revisions, and dispatch |
| Birbverify activity and target | Execute the pinned procedure, own acquired attempt identity, fence effects, and record the producer result |
| Separate supervisor CLI | Confirms worker and container stop, reconciles the owned attempt through target operations, and records a separate recovery receipt |
| Shared phone and browser client | Displays authoritative observations and submits bounded commands. It cannot upload verdicts or release quarantine |

The fixture trusts processes under the same host user. A worktree is not a
native execution sandbox. The Python adapter runs as a bounded subprocess of
the existing gateway. Its interpreter and private configuration paths come
from launcher configuration. Clients cannot choose executables or paths.
There is no separate API listener or application queue database.

## Immutable admission and command replay

The gateway accepts these strict snake_case bodies.

| Command | Client fields |
| --- | --- |
| Admit | `request_id`, `idempotency_key`, `candidate_commit`, `approved_plan_sha256` |
| Cancel | `request_id`, `command_id`, `expected_revision` |
| Observe | Empty body for a snapshot, or the bounded AG-UI observation envelope |

Request, idempotency, command, and conversation identities are UUIDs. Candidate
commits are full 40-character hashes. Plan digests are 64-character SHA-256
values. The gateway derives the principal and owned conversation. The
conversation identity becomes the producer goal identity. Extra body fields,
including caller-supplied authority or verdict fields, are rejected.

The workflow compares normalized original intent before binding a new request
to installation policy. Repeating a key with identical intent preserves its
original binding and deadline after policy changes. Changed intent under that
key conflicts. A request ID also remains unique across different keys.
Temporal Update IDs include the normalized intent digest. Cancellation command
replay compares the complete original payload, including the expected revision.

Installation starts the stable queue workflow with `REJECT_DUPLICATE`.
Admission never starts a missing or closed workflow. The workflow carries its
registry, revisions, queued requests, and command receipts through
Continue-As-New after handlers drain and no activity is active. This finite
fixture admits at most 128 lifetime requests. It is not an unbounded queue.

## Dispatch, cancellation, and uncertain execution

The queue dispatches requests in admission order when the target reports free.
`dispatching` means the Temporal activity has been scheduled. `running` means
the target has supplied an acquired attempt. `attempt_id` remains null before
acquisition. A queued deadline can expire without an attempt or manifest.

A queued cancellation marks the request before dispatch and acknowledges it
as `cancelled_before_dispatch`. After scheduling, cancellation uses
`WAIT_CANCELLATION_COMPLETED` and producer reconciliation. A cancellation
receipt alone does not prove execution stopped. Terminal cancellation can be
too late. Client disconnect only ends observation.

Workflow-worker restart replays the existing activity identity. Activity-worker
loss does not release target ownership. Activity timeout or an unknown dispatch
result blocks the queue until producer observations establish the result.
A confirmed Temporal cancellation or producer non-retryable rejection, combined
with a target observation of no acquired attempt, records `not_acquired`. It
does not invent a manifest or retry execution. A timeout with no acquired
attempt stays `uncertain` and blocks dispatch. There is no supervisor command
to clear that case in this revision. Preserve its workflow history and private
fixture for a bounded follow-up on worker stop and target fencing. No-attempt
and free-target observations alone do not justify redispatch or recovery.

## Recovery and immutable history

The supervisor requires the original attempt context and separate supervisor
key. It checks Linux process identity, including boot and start identity, and
confirms the exact attempt container is absent. A PID alone is insufficient.
Missing context or an unconfirmed stop leaves quarantine in place. A lost
reservation reply can leave an acquired attempt without its context file.
That case also has no recovery command in this revision. The bounded producer
follow-up must cover both never-acquired uncertainty and acquired attempts
without context, with target-owned fencing and immutable closure evidence.
The key separates the supervisor operation from ordinary target commands. It
is not an isolation boundary between trusted processes running as the same user.

For unknown termination, the supervisor first preserves an inconclusive
producer manifest with unknown termination and quarantined release status.
It then inspects target state between recovery, cleanup, and release operations.
Repeated commands inspect already committed transitions rather than blindly
repeating them after a lost reply.

A completed recovery produces a separate immutable receipt bound to the
request, attempt, and original manifest digest. The original manifest remains
unchanged after the environment becomes free. Recovery cannot turn unknown
termination into a passed verification result. The gateway exposes no recovery
or quarantine-release action.

## Evidence eligibility and shared observations

Every snapshot carries installed candidate, plan, policy, workflow revision,
request rows, current environment state, and separate recovery records.
Request rows retain request and idempotency identities, acquired attempt or
null, phase, cancellation state, producer outcome, manifest, and current gate
eligibility. The environment can be free while an older manifest still records
quarantine. Both observations are meaningful.

A passed result becomes ineligible when the current synthetic candidate,
approval, or policy changes. Those changes do not rewrite its historical
outcome. The producer artifact reader checks required artifact bytes against
their recorded size and digest on observation. Missing, changed, or unreadable
required artifacts fail closed as `evidence_unavailable_or_invalid`.

The gateway sends standard AG-UI `RUN_STARTED`, `STATE_SNAPSHOT`, and
`RUN_FINISHED` events. The observer run ID is distinct from the producer attempt
ID. Phone and browser use one shared client that accepts each snapshot
atomically. Serialized observations and connection generations reject stale
responses while allowing fresh artifact eligibility at the same workflow revision.
The random `observation_id` correlates an observation; it is not an ordering clock.

An unavailable acknowledgement leaves the original command pending in the
current client session. Refresh and retry use its original identities and
payload. Pending client state is not a durable outbox across application reload.
An unavailable observation retains the last snapshot as historical information.
The client cannot infer a successful command or cancel verification on reconnect.

## Reproduce the local checks

After guest setup, select the validated producer interpreter from the private
setup record. These commands do not print credentials.

```sh
BIRBVERIFY_PYTHON=$(python3 -c 'import json,pathlib; p=pathlib.Path(".local/guest-setup-path").read_text().strip(); print(json.load(open(p))["exports"]["birbverify"]+"/.venv/bin/python")')
scripts/guest -- "$BIRBVERIFY_PYTHON" -m pytest tests/verification_python -q
scripts/guest -- scripts/npm run check
scripts/guest -- scripts/npm exec tsx -- --tsconfig tsconfig.node.json --test tests/verification-client.test.ts tests/verification-contract.test.ts
scripts/guest -- scripts/npm run export:native -- --output-dir .local/verification-native-build
scripts/guest -- scripts/npm run export:web
scripts/guest --producer birbcrew -- .venv/bin/python -I "$PWD/scripts/verification_http_proof.py" "$PWD"
```

The HTTP proof owns and cleans a fresh runtime. After it exits, start
`scripts/guest -- scripts/verification-dev`. In a second Mac terminal, run
`BIRBFORGE_CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/verification-browser.mjs`
with compatible native Node 22 and the existing browser. Then stop with
`scripts/guest -- scripts/verification-dev --stop`.

The interactive launcher cleans its fixture if a child process exits. The
interruption proof uses the `VerificationRuntime` coordinator directly so it
can keep Temporal, target and gateway alive while restarting workers. Do not
treat killing the interactive launcher as the queue-worker recovery test.

For an acquired interrupted attempt, a trusted host coordinator invokes
`python -m verification.supervisor QUEUE_CONFIG ATTEMPT_ID RECOVERY_UUID fence`
using the validated producer interpreter. After checking quarantine, invoke the
same command without `fence`. The coordinator first confirms its exact activity
worker has stopped. The supervisor verifies that independently and reuses
Birbverify's stop, cleanup and release operations. It rejects recovery of a
normally released attempt and a different recovery identity for an already
recovered attempt. It never runs through the client action API.

One installation subprocess was observed hanging after Temporal had accepted
the workflow. Its failed fixture and report were retained privately. Subsequent
fresh installations passed. The launcher bounds startup calls and cleans its
owned fixture on timeout; the shutdown cause is not established. This is a
known local startup limitation, not evidence of a repaired SDK.

Diagnostics remain local. Queue transitions and supervisor cleanup emit
allowlisted JSON log envelopes; request and attempt identities are attributes,
not metric labels. Artifact failures are deduplicated per request and capped at
64 KiB per fixture. The cap may omit later diagnostics; authoritative state and
eligibility do not depend on these logs. No exporter is enabled.

## Acceptance evidence for this milestone

The following statuses describe the initial delivery at `7b8e1a5`. Historical
[first UI milestone](first-milestone.md) evidence does not satisfy these checks.

| Proof | Current status |
| --- | --- |
| Unchanged pinned producers and Linux guest runtime | [Portability and 14 producer tests passed](evidence/verification-portability.json) |
| FIFO, admission conflicts, immutable replay, and Continue-As-New retention | [30 queue and boundary tests passed](evidence/verification-queue.json) |
| Real activity, workflow restart, cancellation, and worker-loss quarantine | [Real Temporal and target proof passed](evidence/verification-queue.json) |
| Separate supervisor recovery and unchanged original manifest | [Target-confirmed recovery passed](evidence/verification-queue.json) |
| Artifact invalidation and candidate, approval, and policy freshness | [Nine HTTP scenarios passed](evidence/verification-http.json) |
| Gateway rejection, AG-UI observations, and shared browser behavior | [Mac browser passed](evidence/verification-browser.json); [14 shared tests and native JS exports passed](evidence/verification-shared.json); [six conversation regression tests passed](evidence/verification-regression.json) |
| Independent source review and fixes | [Claude Opus 5.5 review and closure](evidence/verification-review.json), supplied-source review with no independent execution |
| Changed native verification controls and transport on physical iPhone | NOT VERIFIED. Fresh host observations found no available physical phone |
| Native OS Large Text and VoiceOver | DEFERRED / NOT VERIFIED under the existing owner deferral |

Mac-hosted Linux execution is distinct from native macOS execution. Darwin
tool-version probes and exported native JavaScript bundles do not establish an
iPhone journey. `docs/mac-iphone-verification.md` defines the exact-revision
native handoff. It pins the exercised implementation commit. The [delivery binding](evidence/verification-binding.json)
records source, report, and dependency hashes.

Setup and cleanup commands are in `docs/host-execution.md` and
`docs/development.md`. Keep fixture credentials, host configuration, logs,
screenshots, raw artifact bytes, and continuation handoffs private and outside
Git. Public reports contain sanitized identities, digests, observations, and
the precise revision exercised. No live model, private notes hub, external
telemetry exporter, network reconfiguration, or production access belongs to
this fixture.

## Private route launcher follow-up

The native owner reported signed iPhone build/install/launch and Mac-only
checks at `7b8e1a5`, with all seven native journeys blocked by the private route.
The queue launcher had discarded `BIRBFORGE_PROXY_CONFIG` and accepted default
listener readiness without the optional proxy backend.

Implementation `2893bf3d68b7e582c5bd641b3bd272afc81e56da` forwards the explicit optional
configuration to the gateway and waits for a fresh all-listener readiness
receipt on every start. Existing Host, Origin, authentication and owner-only
file checks remain unchanged. The [follow-up evidence](evidence/verification-proxy-followup.json)
records eight launcher tests, ten HTTP scenarios and independent Claude closure.
The [Mac browser rerun](evidence/verification-proxy-browser.json) used the default
loopback UI while both listeners were active. Proxy AG-UI observations used raw
SSE; the official client checks used the default listener.

These tests do not verify the external HTTPS service or native transport.
Continue with the updated exact-revision native handoff in `docs/mac-iphone-verification.md`.
At that launcher-only checkpoint all seven native journeys remained NOT VERIFIED.
The physical acceptance below supersedes that status. Large Text and VoiceOver
remain deferred. Original delivery reports above remain historical; the follow-up
[content binding](evidence/verification-proxy-binding.json) records the new source.


## Physical iPhone acceptance

On November 6, 2026 (local time; November 7 UTC), the owner Mac and a physical
iPhone exercised the remaining queue controls against the isolated fixture.
The [native evidence record](evidence/verification-native.json) binds the
results to product revision `6b46dac2931225e0739e9deb047e48b956bff8fc` and
native fixture revision `88a8182346c380bd15f4b7b2ec7f442f81dbd130`.
The application, controller, gateway and queue sources are unchanged between
those revisions. The separate test entry point adds explicit transport fault
controls; normal native bundles exclude them.

| Journey | Evidence and limit |
| --- | --- |
| Shared admission, automatic reconnect, historical outcome versus current eligibility | Earlier physical checks at the same product revision remain valid. Fresh admission and recovery also appeared on the Mac. The earlier full journeys were not all rerun. |
| Lost admission acknowledgement | The native fixture withheld one validated HTTP 200 response and temporarily held observations. The phone showed the original pending request, then reconciled to its passed result automatically. One native POST and one target operation were recorded. This tests app-facing reply loss, not dropped network packets or persistence across app reload. |
| Cancellation | The phone's requested state was captured during an activity heartbeat timeout. A separate ordinary, unpaused cancellation showed acknowledged on phone and Mac, with confirmed stop, complete cleanup and no Temporal timeout. These separate runs establish the state distinction; they are not one clean requested-to-acknowledged screen recording. |
| Known-attempt supervisor recovery | Actual worker loss left an inconclusive result and quarantined environment. A separate trusted supervisor confirmed stop and cleanup. Phone and Mac then showed a free environment and separate recovery receipt while the original request and manifest remained unchanged and ineligible. |
| Forged native action | The real native transport sent an extra authority field. HTTP 400 and the phone rejection matched unchanged server requests and target effects. Earlier invalid/stranger credential checks remain historical; this is bounded rejection coverage. |

Two paused cancellation attempts exceeded the activity heartbeat deadline; a
third request finished before cancellation was pressed. These are recorded as
unsuccessful timing attempts, not ordinary cancellation passes. The false
assumption was that a ten-second pause could not exhaust a fifteen-second
heartbeat deadline: the heartbeat was already aging before the pause.

The closing audit rechecked 44 source hashes, 39 signed-app file hashes and
three target artifact objects, with no mismatches. It compared authoritative
before/after state and followed Temporal history across Continue-As-New.
Independent Claude reviewed the fixture and private coordinator source and
closed its findings. It did not independently execute the device journeys.
The executing agent operated the real phone and browser and performed the
read-only evidence audit; those are not two independent executions.

Both clients were signed out. The disposable runtime, its seven containers
and temporary forwards were stopped. Screenshots, credentials, runtime
configuration and raw evidence stay outside Git; the public record contains
digests and bounded observations.

This closes the scoped physical-phone acceptance work. Native OS Large Text
and VoiceOver remain explicitly deferred. Unknown dispatch or missing-context
recovery, actual k3s staging, native candidate isolation, artifact access and
retention, and production identity remain separate gates. No merge or
deployment is authorized by this evidence.
