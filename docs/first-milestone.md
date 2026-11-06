# First milestone for Birbforge

Status: implemented with functional native iPhone and Mac verification at
`5d333cda03a6b385b669f6025b248d4ba4272071`, reported by the local verification
owner in `birbforge-h-5mbs`. See `docs/evidence/acceptance.md` for evidence and
limits. The owner reportedly deferred native OS Large Text/VoiceOver for current
owner use; those checks remain DEFERRED / NOT VERIFIED. The original full
accessibility journey below has not passed. Human authentication/permission
review remains required before merge. This is not production or merge approval.

## Later durable verification milestone

The [durable verification queue](durable-verification-queue.md) adds a new
fixture journey after this UI milestone. The native result above remains bound
to its recorded commit. It does not verify the new request, cancellation,
recovery, artifact, or shared observation controls. Fresh physical iPhone
execution for the changed paths is NOT VERIFIED. Local queue execution and independent source review passed, as recorded
in the linked queue evidence. Native OS Large Text and VoiceOver retain
the existing DEFERRED / NOT VERIFIED status.

## Outcome

An authenticated owner can begin a goal conversation on a phone, continue it in
a Mac browser, and resolve the same pending input through either conversation
or inbox. Both clients converge on authoritative state after reconnect.

Use Birbcrew's human-input request, resolved by ID and version through an
authenticated Birbforge action. Generated local test credentials suffice for
this isolated proof. Production identity is a later deployment gate.

## Scope and dependencies

Use the proven Birbcrew AG-UI contract and fixtures. Validate Expo and React
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
