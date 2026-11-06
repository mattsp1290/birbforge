# Independent review disposition

Sections before "Native and Mac evidence reconciliation" record the status at
each historical review. Their open native gates and stricter activation profile
are historical, not current functional results. The final section records the
later operator evidence and reported owner decisions without granting merge
approval or endorsing an unverified LAN/other-ingress risk.

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
test source, not changing prose under `docs`. At that review, the Mac/iPhone handoff was a pending
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
reviewer. At that review, native Expo transport, device networking, and OS accessibility
remained NOT VERIFIED. The [SDK 55 iOS CLI help](evidence/expo-ios-help.txt) records the
inspected flags. It is not evidence of an Xcode build or device installation.

## Private phone access continuation

The owner-selected existing infrastructure superseded the initial app-owned
TLS sketch. [The revised design review](evidence/proxy-design-review.json)
preferred reusing its private HTTPS service. Both design records are historical;
they do not establish live endpoint compatibility or approve the later bridge.

[The private-access code review](evidence/private-code-review.json) identified
an overly general bind/source configuration that could allow a plaintext LAN
hop. The implementation removed it. Both application listeners are now fixed
to loopback. Proxy configuration contains only a port and one canonical external
HTTPS origin. Actual socket-source checks reject anything except 127.0.0.1.
The proposed enrolled-peer SSH bridge stays outside application authority and
requires its own observed ingress and direct-port isolation checks.

The review's TLS fixture finding was fixed by separating HTTP Host from normal
TLS hostname validation. Its missing-design-evidence finding was resolved by
publishing the redacted reviews and rewriting the workflow around the final
shape. Config validation uses an opened descriptor, startup readiness is atomic
and create-only, and shutdown prevents remaining startup steps. No private key
or application TLS service was introduced.

[The first fix review](evidence/private-fix-review.json) confirmed those code
fixes but found material activation/evidence gaps. At that review, the procedure required
proxy-only bridge reachability, observed NetBird source/interface, other-peer
and actual LAN-ingress denial, with no owner tokens until those gates pass.
A Host 403 or an HTTPS audience group alone is explicitly insufficient. Missing
controls require a scoped owner-approved proposal, not an insecure fallback.
The scanner now self-tests a synthetic key marker, generates its own report,
and runs from `scripts/verify`. Historical and final designs are distinguished
in the workflow and append-only decisions.

[The final targeted review](evidence/private-final-review.json) returned
`claude-opus-5-5` and found no material implementation defect, unsafe activation
guidance, or unsupported acceptance claim. It confirmed all three material
fix-review findings resolved on source/evidence inspection. It did not execute
tests, inspect private config or account settings, recompute hashes, or approve
a merge. CLI safe mode, tools, and process-local subscription authentication
were observed by the implementation owner, not independently by the reviewer.

Low follow-ups were accepted after that review. Fixture child gateways receive
the same process-local Datadog-disable flags. Public scanning rejects symlinks
before dereferencing them and recognizes DSA key headers as well as the tested
PKCS8 marker. The activation text includes every non-NetBird ingress and places
local processes within the owned peer's host trust boundary. A closing decision
row names the final affected verification run. These small changes were rerun
by the implementation owner after review.

The local TLS proxy is a fixture with a client-only CA, not evidence of the real
NetBird service or Apple trust. At that review, the actual route, public/non-enrolled denial,
bridge-port restrictions, native app, and full device journeys remained
NOT VERIFIED. Later functional results and the reported exception follow below. Human authentication and permission review remains required before
merge. No DNS, network/account setting, firewall, OS trust, or production change
was performed in this continuation.

## Native and Mac evidence reconciliation

The local verification owner returned `birbforge-h-5mbs` for tested revision
`5d333cda03a6b385b669f6025b248d4ba4272071`. The implementation owner recomputed
all 13 delivered evidence file hashes and 30 Git source hashes without mismatch,
checked JSON outcome/count invariants and inspected a native result screenshot.
[The receipt](evidence/native-evidence-receipt.json) records that check. It does
not claim a native rerun, access to the Mac source tree, independent recomputation
of the supplied native bundle hash, or a new test of a later documentation commit.

[Acceptance](evidence/acceptance.md) now records five functional journeys with
explicit limits. The race used concurrent Mac API requests while both real UIs
observed. Native recovery had no separate POST-attempt counter; the exactly-one
POST count belongs to the independent Mac browser harness. Native OS Large Text
and VoiceOver remain DEFERRED / NOT VERIFIED by the owner decision reported in
the handoff. Mac keyboard controls were exercised.

The handoff also reports the owner's explicit trusted-enrolled-peer decision
and refusal of proxy-only bridge isolation/firewall changes for this private
setup. This records a friendly-enrolled-peer exception for owner use, not acceptance
of possible LAN/other-overlay exposure. Source/interface isolation and direct
LAN/other-ingress denial remain unverified. A reachable caller could spoof Host,
leaving bearer authorization as its only per-person action gate. The handoff
does not confirm acceptance of that residual risk; human authentication and
permission review must resolve it before merge. Neither
the prior source review nor this documentation reconciliation grants a new
security endorsement. The app's bearer, exact authority, and loopback checks are
unchanged. Human authentication/permission review remains required before merge.
A broader or untrusted audience requires renewed review of the trust boundary.

This reconciliation changes public prose and redacted evidence only. It does
not regenerate device/source manifests, stop the retained runtime or SSH bridge,
change permissions/network settings, or authorize merge or production deployment.

The [reconciliation review](evidence/native-reconciliation-review.json) found
trust-scope and historical-status contradictions. The reported friendly-peer
exception is now expressly limited to enrolled peers. It does not establish
acceptance of reachable LAN/other-overlay callers, for whom bearer auth could
be the only per-person action gate. Historical review-time statuses are labeled.

The [fix review](evidence/native-reconciliation-fix-review.json) confirmed those
corrections and identified one remaining future-activation gap. The procedure now
explicitly requires every new or re-created owner-use bridge to establish
LAN/other-ingress denial or wait for explicit human permissions review before
owner tokens are sent. Only friendly-peer segregation is waived. This is a
future-operation guard, not a claim of a passed test or a lifecycle change to the
retained session. The implementation owner addressed that finding and reran the
documentation checks. No additional device execution is claimed.
