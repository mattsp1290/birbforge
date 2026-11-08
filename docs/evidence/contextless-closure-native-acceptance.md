# Physical iPhone and Mac closure acceptance

The seven closure journeys passed on 2026-11-08 using source `e8a895976f9cee392bc3ac793b6cd77be3ffa613`. This closes the physical-device rendering handoff for that revision. It does not authorize merge or deployment.

The signed Release app ran on a physical iPhone 16 Pro with iOS 26.6.1. Google Chrome 156.0.8078.80 ran on macOS 26.6.2. The phone used the existing private HTTPS route; the Mac used an owned loopback transport to the same fresh fixture. Phone actions and screenshots came from iPhone Mirroring, with owner-assisted sign-in. This was the installed native app, not a mobile browser viewport.

The runtime checkout was the documentation-only descendant `417cfea8fb7658c96086e51ed684038883b70864`. All 97 recorded source hashes matched before and after execution. Birbverify remained pinned to `e785dd8882222b18eaf59ce2b1ceecbd092dcd9e` and Birbcrew to `88b219c18adeb352d2f291f099ede990a3190a58`. Dependency export verification passed inside the fixture driver. The [machine-readable record](contextless-closure-native-acceptance.json) binds the native executable, JavaScript bundle and 91 private artifacts to this run.

## Observed journeys

| Journey | Result and evidence |
| --- | --- |
| Shared native admission | Two requests admitted from the phone appeared with the same identities in the Mac inbox. Native conversation and inbox used the same authenticated conversation. |
| Worker loss and pending closure | The exact registered worker was removed before closure. Its context file was absent. Both screens displayed REQUEST CLOSURE PENDING and the same closure identity after a deliberately lost supervisor reply. |
| Immutable closure without a manifest | Replaying the original closure identity produced REQUEST CLOSED with valid retained proof. Both screens explained that no verification manifest was recorded and closure grants no eligibility. |
| Historical manifest preserved | A one-shot read-only inspection reply loss produced a real quarantined, inconclusive manifest. Closure retained the original outcome. Both screens displayed Original verification history preserved. Canonical manifest bytes remained equal and their digest matched the closure receipt. |
| Invalid proof blocks dispatch | Corrupting the exact isolated stop-evidence artifact displayed invalid proof on both screens. A fresh successor stayed queued without an attempt. Restoring the hashed original bytes allowed execution. |
| Historical replay preserves current ownership | While a successor ran, replaying the older closure left its environment attempt and target revision 25 unchanged. The phone showed that successor running while the older request remained historically closed. |
| Native observer reconnect | The phone visibly changed from connected to offline and back, then opened its inbox. Request records and cancellation states were unchanged; workflow revision remained 13 and target revision remained 35. Only the observation identity changed. No goal, admission or cancellation was submitted by reconnect. |

The historical-manifest successor subsequently passed and was eligible for verification. Its predecessor remained inconclusive and ineligible. Verification eligibility still grants no merge approval.

## Execution details and limits

The first queued successor expired during manual device capture without acquiring an attempt. A new request exercised invalid-proof blocking and later execution; the expired request was not retried or relabeled. Activity uncertainty preceded the explicit worker removal, so this run does not claim that removal caused the first uncertainty transition. The historical-manifest case required a replacement fixture activity worker after closure, as in its accepted producer recipe.

A missing worker context does not erase an already recorded dispatch attempt ID. That ID remained visible for the contextless request. Queued rows displayed Attempt Not recorded. Neither presentation claimed that execution was never acquired.

Mirroring keyboard entry was unreliable. During initial setup, paste inserted stale phone clipboard content into the endpoint field, and a screenshot exposed disposable content. No form was submitted with that endpoint. That fixture and transport were stopped; the replacement rejected its old credential. The owner entered the replacement credential directly in the installed app. Raw credentials, screenshots, device identifiers, logs and private paths remain outside Git.

The signed app used an isolated native worktree at the source revision. Its build and install are recorded separately from actual device observations. No application, producer or infrastructure source changed during this acceptance run. The private controller used numbered commands and real supervisor/target operations; it did not write queue results or manufacture receipts.

## Cleanup and remaining boundaries

Both clients were visibly signed out. The runtime reported complete cleanup with unchanged source. An independent read-only cleanup audit confirmed absence of 15 recorded worker, candidate and driver identities and closure of both owned host listeners. The runtime also confirmed removal of its exact database container and relay. No broad container cleanup or network/account configuration change was performed.

Large Text and VoiceOver remain explicitly owner-deferred. Physical Android acceptance, k3s readiness, native candidate isolation, production identity and deployment are not established by this fixture run. No merge, deployment, live provider call or notification delivery occurred.
