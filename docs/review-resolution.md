# Independent review disposition

Fresh design and code reviews returned `claude-opus-5-5` in the CLI modelUsage
record. Both used a new Claude CLI process, safe mode, and Read, Glob, and Grep
only. Before invocation, help and process-local auth status were inspected.
Removing the three Anthropic override variables selected existing first-party
Claude Max subscription authentication. No fallback was selected. No persistent
account or global model setting changed. The reviewer did not inspect private
billing settings or execute verification.

The source and audit trail were reviewed through the agreed Codex implementation
and Claude CLI mapping. Cursor-only Task, Comment Sicko, deslop, and control
APIs were unavailable. No successful invocation of those tools is claimed.
The independent review covered comments and maintainability. No application
comments or suppression directives needed removal or restoration.

[Design review](evidence/design-review.json) compared a shared Expo controller
with separate CopilotKit presentations. The selected shared design avoids a
second state/action adapter. The stock CopilotKit runtime would not reduce work
for the producer's observation-only stream. Discovery is explicit entry of the
same conversation identity, within the one-conversation scope.

[Initial code review](evidence/code-review.json) found material client issues.
The reviewer read changing files while browser verification was still running.
Its missing-evidence observations describe that earlier snapshot. Later
passing reports do not invalidate the code findings.

| Finding | Disposition |
| --- | --- |
| Rejected goal locks editor | Definitive command rejection clears the pending prompt. Ambiguous acknowledgements retain the original identity and bytes. The real-runtime fault check exercises both cases. |
| Refresh failure obscures accepted command | Command acknowledgement and authoritative refresh are separate. Refresh failure updates the notice without rejecting an accepted submit, resolution, or cancellation. Real-runtime fault checks cover accepted submit and resolution followed by failed GET. |
| New conversation changes identity on retry | The UI retains the pending create UUID and reuses it. The browser fixture drops an acknowledgement after real producer acceptance and asserts identical UUIDs on retry. |
| Notices hide failures or persist after reconnect | Controller owns action notices, including cancellation failures. A successful stream connection clears only connection-error notices. iOS announcements are wired but native execution remains open. |
| SSE filtering claim | Contract corrected. GET and the consumer controller filter the projection. The authenticated producer stream forwards scoped context including note bodies and paths. No SSE wire filtering is claimed. |
| Bare default fetch | Default and platform adapters use arrow wrappers. The browser rerun exercises the actual wrapper. |
| Keyboard and selection | Buttons expose selected state and visible focus. The browser check reaches the decision with actual Tab traversal and Enter. Native assistive and OS font-scale acceptance remain open. The application large-text toggle covers conversation body text. |
| Dependency pipeline and marker | Setup checks the commit first and uses a separate archive file. It writes the revision marker after successful producer setup, checks all 24 pinned hashes, and creates its own local directory. |
| Gateway environment and startup | Gateway receives a minimal environment and the private client-config path. The launcher waits for readiness before publishing its session and watches producer child liveness. |
| Binary-named file | An empty file created during the failed foreign-architecture Hermes execution was moved to the ignored local directory. It is excluded from staging. |
| Missing or incomplete evidence | Browser and runtime reports now contain transitions, identities, timestamps, and dependency versions. The redacted design review is public. Native and Mac gaps remain visible. |
| Involuntary connection loss | The browser fixture toggles network offline and restores it, then verifies automatic observation recovery and exactly one accepted input. This tests the network-loss path without restarting the producer. |
| Response projection assertion | The test proves the gateway excludes native_messages and owner from GET. No claim is made that producer GET excludes them. |
| Readable generator | Retained because Node and DOM ReadableStream declarations conflict in this selected TypeScript configuration. It forwards bytes with backpressure and aborts upstream when the downstream closes. No alternate event protocol is introduced. |
| Small maintenance observations | Added a stable conversation test ID. Evidence generation is an intentional verification artifact. No speculative helpers or unused CSS assets were added. |

The final fix review is recorded separately after affected journeys rerun.
Human authentication and permission review remains mandatory before merge.
No independent reviewer grants merge authority or substitutes for native/Mac
acceptance.

## Fresh fix review and evidence correction

The [fresh fix review](evidence/fix-review.json) returned `claude-opus-5-5` and
confirmed all six original material implementation findings fixed. It found no
new material implementation defect. Its evidence criticism was accepted.
The offline fixture previously checked a connected state that could have been
left over from the earlier attachment. A stronger assertion reproduced that
gap. The browser now handles offline and online notifications by closing and
reattaching observation without submitting a goal. The final browser report
records two observations before loss and three after recovery, and the fixture
requires an offline or connecting transition before restoring the network.

The command fault fixture now asserts that the injected failed GET was consumed
and that the notice explicitly records refresh unavailability. The create fault
fixture asserts producer acceptance before dropping the acknowledgement. Actual
Tab traversal also checks the computed visible focus outline. Retry hints are
handled consistently for submit and resolve, including the producer's 409 retry
hint. A closing decision row records the final passing checks and manifest.

These affected checks passed after the review. The reviewer did not execute
them or recompute hashes. The latest source manifest covers implementation and
test source, not changing prose under `docs`. The Mac/iPhone handoff is a pending
local verification procedure, not acceptance evidence.

## Final targeted review

The [final targeted review](evidence/final-review.json) returned
`claude-opus-5-5`. It found no remaining material implementation defects and
confirmed that the earlier offline evidence criticism was resolved. It retained
two low evidence observations. The browser fixture now counts POST /inputs and
requires exactly one, so a deduplicated resubmission cannot satisfy the gate.
A separate real-runtime transport fixture interrupts the official SDK stream,
fails the first reconnect GET with 503, and requires automatic reattachment,
unchanged pending state, and one input POST. This exercises the shared controller's
stream-error retry independently of browser online/offline notifications.

Those small assertion additions were implemented after this final review and
rerun by the implementation owner. They were not independently executed by the
reviewer. Native Expo transport, device networking, and OS accessibility remain
NOT VERIFIED. The [SDK 55 iOS CLI help](evidence/expo-ios-help.txt) records the
inspected flags. It is not evidence of an Xcode build or device installation.
