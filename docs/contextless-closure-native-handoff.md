# Physical Mac and iPhone closure rendering check

Source revision: e8a895976f9cee392bc3ac793b6cd77be3ffa613. Branch: impl/contextless-closure-integration-20261108. Producer: e785dd8882222b18eaf59ce2b1ceecbd092dcd9e. Birbcrew: 88b219c18adeb352d2f291f099ede990a3190a58.

Completed on 2026-11-08: [physical-device acceptance and execution limits](evidence/contextless-closure-native-acceptance.md). Keep this recipe for future revision-bound runs.

This handoff covers changed closure rendering and conversation/inbox continuity. It is not deployment authorization. Use the owner’s known physical Mac/iPhone verification location. Native export and Mac-hosted Linux Chromium evidence do not satisfy this handoff. Large Text and VoiceOver remain explicitly deferred.

Read docs/contextless-closure-integration.md and the public acceptance record. Verify the exact source revision and immutable dependency exports first. Preserve any existing worktree and active services. Do not reuse a stopped historical bridge or disposable credential. Establish current fixture ownership and device route before starting a new explicitly scoped fixture. Keep credentials only in private local files; never copy them into chats, screenshots, public docs or Beans notes.

Use the real native Expo app on the connected physical iPhone and a browser on the Mac. Start a fresh closure-v2 fixture. Use deterministic agents and synthetic verification candidates only. Each observation must name the source revision, native build identity, request, closure, target incarnation and target revision, with private artifact hashes.

1. Open one authenticated conversation on both surfaces. Admit synthetic work and confirm the same request in conversation and inbox.
2. With the worker stopped through the fixture’s exact worker identity and closure pending, confirm REQUEST CLOSURE PENDING on both surfaces. A missing attempt ID reads Not recorded. An already recorded dispatch attempt ID remains visible even if the worker context file is missing. Neither case implies never acquired.
3. Reconcile the same immutable closure identity through the private operator CLI. Capture REQUEST CLOSED, retained proof validity and the absence-of-manifest explanation. Closing a request grants no delivery eligibility.
4. For a closure with a recorded historical manifest, preserve its identity/digest before and after closure. Both surfaces must say the original history is preserved.
5. Use the approved isolated evidence-fault recipe to show invalid or unavailable retained proof, without mutating a production artifact. Confirm the successor remains blocked until the exact retained evidence and target state validate.
6. Allow a successor to acquire the environment. The older request remains historically closed, while current ownership names the successor. Replaying the older closure must not change the successor.
7. Disconnect and reconnect the phone observer without submitting a prompt or request. Confirm the same request/closure/target revision in conversation and inbox. Confirm no duplicate admission or cancellation.

Capture actual native screenshots with credentials hidden and paired browser snapshots. Record pass, fail or inconclusive separately per journey. Do not convert API evidence into a native rendering claim. Sign both clients out and stop only the exact new fixture resources and forwards. Record cleanup failures as failures. Publish a sanitized handoff with private evidence locations and hashes. No merge, deployment, production identity, notification delivery or provider call is part of this check.
