# Historical Kubernetes queue acceptance

These receipts are historical evidence for an earlier implementation of `birbforge-yrnb` against producer `birbverify-r5rh`. They do not establish acceptance of the current review fixes. A fresh proof from clean, unchanged consumer and producer revisions is pending. Temporal is the only scheduler. Beans remains the authored-work owner. No shared staging deployment or delivery authorization occurred.

## Exact sources

- Runtime and live proof source `97ba00a6824985b4003c34a27ffa9e5f13c6cfb4`.
- Regression fixture follow-up `08a9fdb90bdd0099249e651c0f1a20b80e9ff6b8` adds one simulated API-discovery response. It changes no runtime, packaging or live-test code. It landed during the live run. All journeys record `birbforge_revision` as `97ba00a6824985b4003c34a27ffa9e5f13c6cfb4`, but the sealed `policy_revision` differs. The `restart` receipts use `97ba00a6824985b4003c34a27ffa9e5f13c6cfb4`; the `worker_lost` and `cancelled` receipts use `08a9fdb90bdd0099249e651c0f1a20b80e9ff6b8`. The final runner summary also reads the later HEAD. This mixed identity invalidates a claim that all journeys used one unchanged source revision. The historical source hashes do not certify the current tree.
- Birbverify `bc52efc30f7f8ca045cb40daa48fc4e5f1686cbd`, superseding the earlier development pin.
- Authored Beans hub reference `d91e2164f15bd92720441c82a41eb6320be2bd71`. This is operator-supplied authority, not a tracker authorization check.

## Historical observed results

The earlier regression suite passed 75 tests. It covers legacy queue behavior, immutable admission, replay, config drift, receipt validation, cancellation, deadlines and real Temporal execution with a simulated Kubernetes API.

The committed live proof passed three journeys in a newly created kind cluster. Each journey used the actual producer target journal, Unix service, registered activities and Kubernetes API. Each exercised account creation and login, rejected an unauthorized Pod, cancelled a queued request without execution, restarted the coordinator process, and proved successor dispatch after exact release. The worker-loss journey additionally killed the producer worker during an accepted API operation. The cancellation journey closed a running request. Continue-As-New histories contain exactly the two expected execute activities.

`receipts.json` contains projected request records and complete closure receipts, target identities, source pins, history digests and image digests. Full private histories and process logs remain in `.local/yrnb/final-proof`; regression results are in `.local/yrnb/regression-final-pin.xml`. Both test clusters were deleted and the proof kubeconfig was removed.

The consumer image built from the recorded producer image digest. With network disabled, both worker modules imported successfully as UID 10001. These are local build artifacts, not published images or deployment evidence.

## Review and limits

Claude Opus 5.5 reviewed the implementation and a follow-up revision. Its main finding led to a durable completion command, leaving the application running for checks after execute returns. Additional fixes bind closure effects and Pod identity, preserve the complete history chain, reject drift and clarify operator authority. The installed Temporal SDK confirms its worker context propagates fatal worker failures by cancelling the outer task.

This supports sequential requests for one candidate revision per target namespace, with 128 lifetime admissions. There is no recovery command for retained owners or exhausted installations. Closure proves lifecycle release, not a passing application verdict; every projection remains delivery-ineligible. The candidate pin identifies fixture source, while its Python image digest does not establish an application build provenance chain. Shared staging, Ferry enrollment and Flux-managed Deployment support remain outside this issue.

See [runtime contract](../../kubernetes-queue.md) for reproduction and operator usage.
