# Physical iPhone fixture controls

This separate entrypoint renders the unchanged application with a diagnostic panel. It is acceptance tooling, not an application feature. Its transport delegates to the checked-in native `expo/fetch` adapter. The gateway and controllers remain unchanged.

Select the build with both `BIRBFORGE_NATIVE_FIXTURE=1` and an absolute `ENTRY_FILE` pointing to `tests/native-fixture/index.tsx`. The fixture Metro configuration replaces only the production App's transport import, only for iOS. The normal entrypoint and normal Metro configuration do not import this tooling. The native screen visibly identifies the fixture build. Record the source revision, diagnostic module hashes, bundle hash and signed app identity separately from the ordinary app build.

1. Authenticate with the ordinary secure field and open the ordinary conversation.
2. Expand Native fixture controls and arm one action. The panel collapses so the ordinary action remains available.
3. Tap the ordinary request or cancellation button. A lost-reply stimulus forwards the original bytes once, reads a successful matching receipt, then throws before the controller receives it. A forged-admission stimulus adds the forbidden `actor` field before the actual native request and returns the server's untouched response.
4. For lost replies, capture the ordinary acknowledgement-pending UI. Verification observations are separately held for at most 25 seconds. Release them through the panel and observe normal controller reconciliation. The driver never submits a retry.
5. Record the redacted receipt and native command POST count. Independently inspect the unchanged runtime for the durable request, stable operation identity and effect count. Driver counts alone do not prove effects.
6. For forged admission, require the actual HTTP 400, ordinary rejection notice, no matching durable request/effect and unchanged owner state. Any successful forge is explicitly recorded as `forge-accepted` and fails acceptance. The driver does not claim that an arbitrary response proves rejection.

The Expo response implementation does not support `clone()`. A lost successful reply is consumed deliberately. Other replies, including rejected forged requests, are returned untouched. Error bodies, headers and credentials are never included in diagnostic receipts.

The observation hold gates fetch completion, not chunks of an already returned stream. This is scoped to the existing gateway, which computes one snapshot and then writes `RUN_STARTED`, `STATE_SNAPSHOT`, `RUN_FINISHED` and closes the response. The production App rejects URL path prefixes and canonicalizes its endpoint to `base.origin`. The exact App transport import is the intentional injection boundary. Require a matching native POST count and suppressed-reply receipt on the physical phone before claiming the stimulus ran. A future long-lived event stream, different import path or endpoint shape needs a fresh fixture review.

The focused tests use Node HTTP to verify the stimulus and unchanged controller. They do not constitute physical iPhone acceptance. Run those tests and both the repository typecheck and this directory's typecheck before the native build. Normal browser export must remain unaffected. Keep native screenshots and runtime evidence in a fresh private evidence directory outside Git.
