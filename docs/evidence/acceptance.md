# First UI milestone acceptance

The local Mac owner exercised the signed native iPhone app and actual Mac
browser at `5d333cda03a6b385b669f6025b248d4ba4272071` with pinned Birbcrew
`88b219c18adeb352d2f291f099ede990a3190a58`. Five functional journeys are verified
within the limits below. Native OS Large Text and VoiceOver are DEFERRED /
NOT VERIFIED by the owner decision reported in `birbforge-h-5mbs`. The reported
owner-use acceptance is not blocked by that deferral. Full original accessibility
acceptance has not passed. Human authentication and permission review remains
required before merge.

## Journey results at the tested revision

| Journey | Status | Observation and limit |
| --- | --- | --- |
| Phone to browser | VERIFIED | Signed native app created the goal. Actual Mac Chrome opened the same conversation, finalized messages, pending ID and version. iPhone Mirroring operated the physical device, not a web viewport. |
| Inbox to conversation | VERIFIED | Mac inbox recorded inspect; native conversation showed the recorded choice and completed goal, with one decision. A separate Mac-created conversation was resolved from native with test, and the Mac inbox cleared. |
| Racing answers | VERIFIED at the shared action API, with both devices observing | Concurrent Mac API requests produced one 200 and one 409; both UIs converged. This was not simultaneous physical tapping. A stale version returned 409. |
| Connection loss | VERIFIED observed recovery; native request-count limit retained | Stopping/restoring the owned bridge visibly disconnected/reconnected both targets with the same pending ID/version and one accepted input. Native background/foreground recovered. No Send action was used. Native POST attempts were not separately instrumented; exactly one POST is established only by the separate Mac browser harness. |
| Unauthorized action | VERIFIED with native and API evidence | Native rejected invalid and stranger credentials. API checks returned 401 invalid, 404 stranger, 400 forged actor and 409 stale version, with unchanged owner snapshot. Native displays a generic rejection rather than those HTTP codes. |
| Accessibility | PARTIAL; native OS checks DEFERRED / NOT VERIFIED | Installed Mac Chrome passed five Tab presses, Enter activation and visible focus. Native OS font scaling and VoiceOver were explicitly deferred by the reported owner decision. No complete accessibility claim is made. |

The first conversation finalized at revision 5 with one input and one decision.
The second finalized at revision 9 with two inputs and two decisions.
[The redacted native report](native-acceptance.json) preserves fixture identities,
finalized message IDs, note keys/hashes, API outcomes and exact limits.

## Provenance and independent receipt checks

The execution owner supplied `birbforge-h-5mbs` and a private evidence package.
The Linux implementation owner recomputed all 13 delivered file hashes and all
30 pinned Git source hashes without mismatches. The local owner reported the
same source hashes matched before and after execution. The Linux owner did not
access that Mac worktree or rerun the native journeys.

[The receipt](native-evidence-receipt.json) binds the redacted summary to those
private files. Raw images, origin, installation paths, service/group identifiers
and device identifiers remain outside public Git. A native result screenshot
was inspected; screenshots supplement the reported transitions rather than
proving the whole journey alone. Native bundle bytes were not delivered, so its
reported SHA256 is not independently recomputed here.

Physical target was iPhone 16 Pro, iOS 26.6.1, bundle `dev.birbforge.proof`
0.1.0 build 1. The owner reports that the local signed Release build succeeded. Expo's install connection
stalled; the owner reports Xcode devicectl then installed the exact generated binary. Generated ATS
had arbitrary loads disabled and local networking enabled. Native used HTTPS.
Mac was macOS 26.6.2 ARM64, Chrome 156.0.8078.80, Node 26.6.0. Both an actual
Chrome window and the headless repository browser harness ran.

## Owner-reported boundary and deferral

The return handoff records the owner's decision to treat enrolled NetBird peers
as friendly and decline proxy-only bridge isolation/firewall changes for this
private owner-use setup. This records the owner-use exception for friendly enrolled peers; it does not
verify proxy-only source/interface isolation or direct LAN/other-ingress denial.
Acceptance of the possible LAN/other-overlay residual risk is not established
by this handoff. Those callers are outside its stated friendly-peer rationale.

HTTPS, private service access, application bearer authorization and an exact
interface-address bridge bind remain in use. SSH hides the original caller from
the app. A reachable direct caller can spoof Host; bearer authorization remains
the per-person action gate. If a LAN or other-overlay caller can reach the
bridge, bearer authorization is its only per-person action gate as well. This
reachability and acceptance of that residual risk remain unresolved for human
authentication/permission review before merge. No broader trust grant is inferred. The earlier independent source review did not endorse
this later owner decision. Human authentication/permission review must assess it
before merge. A broader or untrusted audience requires a new boundary review.

The reported accessibility deferral is separate from a pass. It removes those
native checks from the owner's current acceptance requirement, while preserving
them as unverified work for future external-user scope.

## Runtime and contract

The local owner reports the private service and encrypted bridge active and left
running for inspection. They depend on the owned Mac/SSH session and are not a
durable deployment. A public-path diagnostic returned 403. Mac uses its loopback
SSH route because the target peer's request to its own private origin returned
421. No claim is made that the Mac successfully used that same HTTPS origin.
The implementation owner has not changed or stopped these retained services.

The producer contract remains four inputs, stable request IDs and versions,
snapshot-based reconnect, authoritative finalized messages, and cancellation
separate from disconnect. No producer change, workflow replacement, Continue-As-New
or arbitrary token resume was introduced. Beans remains the authored-note
fixture authority. Checks used deterministic models, not live-account validation.

The existing [Linux checks](runtime-checks.json), [command fault checks](command-checks.json),
[transport recovery](transport-checks.json), [TLS proxy fixture](private-access-checks.json)
and [Mac/native results](native-acceptance.json) have distinct targets and scopes.
No evidence or source manifest is regenerated to imply a different revision
received this native execution. Later prose reconciliation changes no runtime code.

Independent source reviews and the later evidence reconciliation are described in
[review-resolution.md](../review-resolution.md). No reviewer ran the device tests
or granted merge approval. No merge, production deployment, live provider call
or Slack message is authorized by this acceptance record.
