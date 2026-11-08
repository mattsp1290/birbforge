# Contextless closure acceptance

Executed source is `e8a895976f9cee392bc3ac793b6cd77be3ffa613`. Later publication changes contain only this evidence and the device handoff. Birbverify is pinned at `e785dd8882222b18eaf59ce2b1ceecbd092dcd9e`; Birbcrew remains at `88b219c18adeb352d2f291f099ede990a3190a58`.

The parent independently executed the final source on Docker Desktop Linux/aarch64. These results are separate from the implementation agent's development runs and the independent Claude source review.

| Check | Result |
|---|---|
| Python queue, boundary and actual Temporal/producer suite | 62 passed, no skips |
| Fixture launcher suite | 9 passed, no skips |
| Shared TypeScript contract/client suite | 16 passed, no skips |
| Full Node suite against the running fixture | 34 passed; includes the shared cases above |
| Actual browser conversation/inbox journeys | Six stages passed, no page errors |
| iOS and Android exports | Both succeeded |
| Final independent Claude source review | No blockers in supplied source; no tests executed by reviewer |
| Exact owned container cleanup | 20 recorded identities checked absent |

## Behavior established

The actual producer and Temporal tests cover real worker loss before context, coordinator restart, immutable dropped-reply replay, two supervisor routes racing on first creation, missing/corrupt closure evidence, unknown mutation quarantine, late worker fencing and pre-registration launcher death. A fresh command against a normally completed request is rejected while another request owns the target.

A real producer-generated quarantined manifest also reaches closure. Its bytes stay unchanged while the successor completes. The positive manifest digest unit cross-checks producer-model and consumer-dictionary serialization.

The real Chromium journey uses the gateway and official AG-UI events on two pages. It covers a passed request, queued successor, pending closure, invalid retained proof, completed closure without a manifest, observer reconnect and newer ownership. Invalid proof keeps the successor queued even when the target reports free. Reconnect emits no admission. Both historical outcomes and absence of history remain intact.

Focused screenshot inspection confirmed the pending, invalid and validated closure labels. The six-stage browser journey was repeated to capture the request card inside the app's scrolling panel. Raw screenshots, sessions, credentials and logs stay private.

## Attribution and setup

The [machine-readable record](contextless-closure-acceptance.json) binds 97 source files to the executed commit, the final review to supplied source hashes, and private evidence to SHA-256 digests. Both full dependency archives were checked on the host and rechecked inside the driver. Nine imported producer modules resolve to the verified export source. Prepared Temporal binary bytes were also checked. The adapter value derives from those same source bytes, so it is not an independent attestation.

Private exports and attestation archives must be mounted at the same absolute paths on the host and driver. Installed virtualenv dependencies are outside the source attestation. Source bytes were checked again after execution; this is not a hostile-host or whole-environment reproducibility claim.

Docker Desktop required a fixture-only loopback relay from the Linux driver to its exact owned PostgreSQL container. The relay was stopped with PID/start-time checking. For deterministic evidence corruption, a temporary workflow-only worker kept real queue queries available while observation activities were paused. Normal observation resumed before assertions. No daemon, network or production configuration changed.

The driver has the host PID/cgroup view required for producer registration. A worker with Docker socket access provides attribution and cleanup boundaries, not a hostile-code security sandbox.

## Remaining gates

Physical Mac-browser and iPhone rendering passed in the separate [exact-revision native acceptance](contextless-closure-native-acceptance.md). That record distinguishes actual device observations from the earlier native exports and Linux Chromium evidence. Large Text and VoiceOver remain owner-deferred.

Legacy Config retains its compatibility default; the new fixture explicitly selects closure-v2 and v2 targets reject legacy tooling. A dedicated outstanding-request UI label and an explicit Continue-As-New run-ID assertion remain refinements. Actor/grant rotation deliberately fails closed rather than rewriting an existing command.

Staging readiness, native candidate isolation, production identity, notification delivery, live providers and deployment are outside this fixture proof. No merge or deployment was performed.
