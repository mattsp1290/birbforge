# Recover a deployment result and read its promotion status

Birbforge can recover a deployment's account verification result after the verifier loses its reply. Birbhomes can read the status over authenticated Temporal access. Every response in this version denies promotion. Birbverify's closure progress v1 can report a seal and outstanding obligations. It cannot authorize a release.

## Install one request

Use an isolated Temporal namespace and one Birbforge workflow per physical cluster UID and namespace UID. The workflow ID comes from those two UIDs. Retain the workflow history and producer journal across restarts. Replacing the namespace, resetting workflow history, starting another owner, or rotating to another candidate or epoch requires a separate transition protocol. This version rejects a changed configuration on the existing workflow.

Use the [Kubernetes queue configuration](kubernetes-queue.md) as the base. The optional deployment profile adds the following installer-owned inputs.

| Field | Source |
| --- | --- |
| `queue.deployment.request_id`, `request_sha256`, `deadline` | The ID, canonical digest and deadline of the installed Birbverify activity request. |
| `queue.deployment.activity_installation_sha256` | The digest of the full validated producer activity installation. This binds the source and Beans revision, chart and dependency hashes, rendered manifests, five image roles, verifier and suite, and expected Pods, controllers and nodes. |
| `queue.deployment.epoch` | The existing epoch from the producer installation. |
| `queue.deployment.verifier_task_queue` | The producer worker's restricted Temporal activity queue. |
| `queue.deployment.producer_package_sha256` | The package digest computed by `verification.deployment_runtime.producer_package_sha256()` on independently reviewed Birbverify source. It covers a map from each package-relative Python path to its file digest. |
| `queue.deployment.ownership_server_cert_sha256` | The SHA-256 digest of the ownership server's DER leaf certificate. |
| `temporal_tls` | `server_ca` (PEM file), `server_ca_sha256` (digest of the file bytes), `server_name`, `client_cert` and `client_key`. Use a host and port for `temporal_address`. |
| `deployment_runtime` | Coordinator only. Set `activity_installation` to the approved installation JSON file and `ownership` to the ownership client's `host`, `port`, `server_ca`, `server_cert_sha256`, `client_cert` and `client_key`. |

The coordinator pins Birbverify `3688810cd229befa853c2d569669a7eb74b937f2`, its package digest and the assertion suite digest in `verification/deployment_runtime.py`. This revision has a reviewed negative release decision. [Producer qualification and remaining obligations](https://github.com/mattsp1290/birbverify/blob/3688810cd229befa853c2d569669a7eb74b937f2/docs/deployment-producer.md)

Use Birbverify's canonical `digest` on the validated request and installation. The queue authority's image is the installed API image. The complete image set, chart set, verifier profile, and runtime workload pins are bound through the activity installation. The coordinator checks the full installation before polling. Configuration sent to Temporal contains only the queue model. Credentials and private paths stay with each client.

Give the coordinator exclusive access to start the canonical workflow and poll its workflow and ownership activity queue. Give only the reviewed verifier access to poll and complete tasks on its activity queue. Restrict workflow updates to the admission principal. Reserve workflow reset, termination, deletion and native cancellation for administrators. Use the queue's cancel command to journal cancellation. A Temporal namespace or a task queue name alone grants no identity assurance. Configure and test server-side permissions for each client certificate before using private installations.

Start the coordinator with `python -m verification.kubernetes_worker /private/coordinator.json`. Install the producer worker, journal, audit and ownership services from the same reviewed producer revision. Keep producer review, immutable images, workload observations, restoration and application qualification with that installation. The bare-Pod producer pin does not supply the deployment modules.

## Recover the result

Admit the installed request through the existing Kubernetes adapter. The canonical owner checks the authenticated producer epoch before scheduling the account assertion activity. Its operation ID binds the invocation to the full installation digest. The workflow schedules the mutating activity once and reads the immutable result from the producer journal through mutual TLS. It checks the request, epoch, operation, verifier, suite, timestamps, workload identities and runtime image digests.

The workflow records the result in Temporal history. Cancellation, an unavailable worker, a lost reply or an unverifiable observation leave the target held. Sealing and result lookup are separate producer operations. Pending results can be recovered after seal. A result recovered later can differ in time from the first seal observation. The export carries the digest of that first validated observation. Its contents are historical and do not describe later controller settlement or storage restoration.

## Read the status from Birbhomes

Install the validator from a reviewed Birbforge revision in the trusted promoter environment. Give its reader a dedicated certificate with query access to the installed workflow. The reader needs the approved queue configuration, the Temporal connection and its own TLS files. Omit the coordinator runtime and ownership credentials.

```sh
python -m verification.deployment_export /private/reader.json
```

The client checks the workflow installation and queries `deployment_evidence_v1` with the request ID, request digest and epoch. It validates the version, invocation, operation ID and denial. Exit 1 returns the authenticated `birbforge.deployment.evidence-status.v1` denial. Exit 2 reports an unavailable or invalid status. A missing result or seal appears as a null digest. Neither exit code permits a push. The operation ID identifies a verification operation and must never be used as a promotion grant.

## Requirements for a future grant

Birbverify must first supply a reviewed completed release that binds the same request, workloads and restored target to the application result. The positive validator must check cancellation, every required assertion, the trusted issuer, the evidence ID and an explicit expiry against its own clock. It must bind the grant to the independently validated Birbhomes publication and destination. This includes source repository and SHA, authored work, plan, policy, installation, target, chart and image set, builder and toolchain, publication run, destination repository, branch and owned path.

Birbhomes must retrieve and validate that grant inside each existing promotion retry and immediately before the Git push. It must record the evidence ID and exact intent in the same commit as the desired-state update. After an ambiguous push it must read the destination and compare both values. Reusing a grant for a different intent must fail. No current status can satisfy this check. [Birbhomes promoter at the inspected revision](https://github.com/mattsp1290/birbhomes/blob/73f2abcb3402a29324a6f5493f0e2e6a7e80764f/scripts/gitops/promote.py)

## Reproduce the consumer journey

Set `BIRBVERIFY_SOURCE` to the exact Birbverify checkout under test, and `TEMPORAL_CLI` to a local Temporal CLI binary. Use a Python environment with that producer's locked dependencies, pytest and OpenSSL. Add the Birbforge root and the producer's `src` directory to `PYTHONPATH`. Run the following from Birbforge.

```sh
python -m pytest -q tests/verification_python/test_deployment_*.py
```

To include the real account and login endpoints, also set `BIRBPARTY_SOURCE` to a local repository containing commit `503d3bc238e2093eb0e098ecbe87b7e11ed16b4f`. Docker Compose starts a fresh project on loopback. The tests check the account and session counts in PostgreSQL after repeated admission. The five-Pod topology and its Kubernetes observations in this journey are fixtures.

The combined journey runs the producer activity, ownership HTTPS service, SQLite journal, Birbforge coordinator and reader CLI on loopback. The local TLS frontend authenticates the test clients. Production namespace and task-queue permissions require separate qualification. The isolated workflow tests exercise reply loss, cancellation, restart, Continue-As-New, and rejected closure. This proof cannot qualify shared staging.

The [sanitized result, seal and export receipts](evidence/deployment-result-status.json) record the clean Birbforge and Birbverify revisions. In the real application run, all five assertions passed and PostgreSQL contained one account and one session after repeated admission. Dropping the registration response after the write left one account and zero sessions. The recovered result was unknown. The validator denied promotion in both cases.
