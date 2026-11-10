# Reviewed Kubernetes queue acceptance

The final review fixes passed all three real Kubernetes journeys on clean, unchanged consumer revision `2d532285b7f35636009cac8a44165df655541bcb` and producer revision `bc52efc30f7f8ca045cb40daa48fc4e5f1686cbd`. Every closure receipt names that same consumer revision. [Reviewed receipts](reviewed-receipts.json) contain the projected closures, exact source and image identities, source-integrity result, and artifact hashes.

The restart, worker-loss and cancellation journeys passed in 278.96 seconds. Each exercised account authentication, admission denial, queued cancellation, coordinator restart and successor dispatch after release. The owned cluster was deleted and the private kubeconfig removed. Full private histories and logs remain in `.local/review-gauntlet/final-live`.

Two independent standard reviews produced 21 fixed findings and one deferred item. The thermonuclear pass produced 15 fixed findings and two deferred items; the final follow-up verdict was **APPROVE**, with no blockers. Its upstream rubric is pinned to Cursor plugins revision `de8ee15dd1194627d21eb5fcd41cb1873208dabb`. Standard and thermonuclear checkpoints were separately committed and pushed at `a30fe901198f511fab9f35d31da81df622d6997e` and `2d532285b7f35636009cac8a44165df655541bcb`.

Validation passed 90 Python tests, 51 portable JavaScript tests, TypeScript checking, Ruff, documentation checks and the packaged worker smoke check as UID 10001 without network access. Four opt-in Beans tests were skipped. Full `npm test` did not pass in this environment: three unchanged tests require a running conversation fixture and one requires a Linux Python export. Those tests are excluded from the portable subset.

The image digest is `birbforge-yrnb@sha256:e6e7896c4ac2278ab086a12f0e066045418a0b5d18fa1d7fab419aecc28202e2`; its revision label matches the tested consumer. This is a local build, not a published image or deployment. Fresh installations are required for the revised experimental workflow state. The limits described below still apply.

---

## Historical Kubernetes queue acceptance

These receipts are historical evidence for an earlier implementation of `birbforge-yrnb` against producer `birbverify-r5rh`. They do not establish acceptance of the current review fixes. The reviewed acceptance above supersedes them. Temporal is the only scheduler. Beans remains the authored-work owner. No shared staging deployment or delivery authorization occurred.

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
