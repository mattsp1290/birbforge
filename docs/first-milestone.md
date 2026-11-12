# First milestone for Forge

## Current status on 2026-11-08

The latest physical iPhone and Mac closure journeys passed at source
`e8a895976f9cee392bc3ac793b6cd77be3ffa613`. The
[revision-bound native record](evidence/contextless-closure-native-acceptance.json)
and `docs/evidence/contextless-closure-native-acceptance.md` distinguish actual
device observations from Linux execution and native export checks. Large Text
and VoiceOver remain owner-deferred. No physical Android acceptance is claimed.

The owner authorized the scoped authentication and permission review and
continuation recorded in `birbforge-h-q8xg`. On 2026-11-08 the owner also
explicitly authorized merging birb* PRs that the agent has reviewed and approved,
including fixes needed to reach approval. This records operator authorization;
it does not claim that the owner independently reviewed the source or that any
PR has merged. Each PR still needs a review tied to its current patch.

This fixture milestone does not establish k3s staging readiness, native candidate
isolation, production identity, notification delivery or deployment acceptance.
The disposable verification runtime and owned forwards are stopped, and both
clients are signed out.

## Earlier evidence

The first conversation proof exercised physical iPhone and Mac at
`5d333cda03a6b385b669f6025b248d4ba4272071`, reported in `birbforge-h-5mbs`.
Its [native record](evidence/native-acceptance.json) retains the original limits.
It does not verify later code. The original full accessibility journey below
has not passed because the owner deferred native Large Text and VoiceOver.

The [durable verification queue](durable-verification-queue.md) subsequently
added request, cancellation, recovery and shared observation controls. Its
original publication preceded physical acceptance. Later exact-revision results
are recorded separately; the current closure record above is the latest one.
Historical review documents retain their findings and review-time pending gates.
The earlier generic authentication review gate is resolved for this scoped
owner-use fixture. Future deployment and permission changes need their own review.

## Outcome

An authenticated owner can begin a goal conversation on a phone, continue it in
a Mac browser, and resolve the same pending input through either conversation
or inbox. Both clients converge on authoritative state after reconnect.

Use Crew's human-input request, resolved by ID and version through an
authenticated Forge action. Generated local test credentials suffice for
this isolated proof. Production identity is a later deployment gate.

## Scope and dependencies

Use the proven Crew AG-UI contract and fixtures. Validate Expo and React
Native Web against the selected SDKs before expanding the interface. Share
domain state and action handlers. Use platform-specific presentation where a
browser-only CopilotKit component cannot run natively. Do not substitute an
embedded browser demonstration for the required native phone journey.

Build one real conversation and one durable input decision. Keep PRs, cloud
dispatch and notifications as explicit later milestones. The decision fixture
does not grant merge authority. Reuse CopilotKit OSS where it reduces work.
Intelligence is excluded. A2UI is unnecessary for this acceptance journey.

Consume Beans-backed context through the agreed boundary. Beans owns authored
work records and shared notes. Avoid creating another editable work or notes
store. Use synthetic records in a disposable Beans hub for the first UI proof.

## Required evidence

| Journey | Passing observation |
| --- | --- |
| Phone to browser | The same conversation, finalized messages and pending input appear on both clients |
| Inbox to conversation | Resolving one input updates both surfaces without a second decision |
| Racing answers | One valid version wins; the stale answer receives an explicit conflict |
| Connection loss | Reconnect restores coherent state without resending a prompt |
| Unauthorized action | The server rejects it even if the client edits local state |
| Accessibility | The core journey works with large text, keyboard access on web and accessible phone controls |

Record dependency versions, device or simulator identity, browser version and
evidence for each journey. Run the interface in both targets. Screenshots alone
do not establish a working state transition. Local proof precedes private
NetBird deployment. Authentication and permission changes require human review before merge.

## Handoff requirements

Publish the action contract and compatibility fixtures in this repository.
Document exercised setup and verification commands. Report implementation,
unresolved integration limits and checks separately. Obtain independent review.
No real merge, production access, Slack message or installation change belongs
to this first UI milestone.
