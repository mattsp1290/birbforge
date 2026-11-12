# Durable Kubernetes target queue

Forge admits an approved request into one Temporal FIFO for a physical Kubernetes target. It invokes Verify's registered target activities and retains the request until an attributable closure receipt proves release. Beans remains the owner of authored work. The queue stores a Beans issue reference and authored revision, not an editable copy of the issue.

This is a bounded local account/auth target integration. The CLI trusts the operator who supplies the installed configuration. It does not authenticate arbitrary remote callers. A closed request means the target lifecycle ended. It does not mean application verification passed or authorize delivery. Every projected result remains delivery-ineligible.

[Account/auth result contract groundwork](account-auth-results.md) defines provisional consumer validation. It is not connected to this queue and does not enable promotion.

## Authority and ownership

`KubernetesAuthority` binds the physical cluster and namespace UIDs, target identity, approved Pod-template digest, producer revision, policy revision, candidate revision, image digest, and Beans issue revision. `installation_sha256` is the canonical digest of the producer's complete `KubernetesInstallation`. Admission can reference these values but cannot replace them. The Beans reference and hub commit are trusted operator inputs; this interface does not resolve or authenticate tracker records.

The canonical workflow ID hashes the physical cluster and namespace UIDs. Display-name aliases cannot create another queue. Startup and every CLI operation compare their configuration with durable workflow history. A changed policy, task queue, or candidate requires an explicit future installation lifecycle. This slice supports sequential requests for one approved candidate revision per installed workflow. It does not silently migrate active history or support live policy rotation. The default limit is 128 lifetime admissions, including closed and cancelled requests. Reaching the limit requires a future installation lifecycle, not a retry.

The workflow persists FIFO order, request payloads, idempotency receipts, command receipts, and one outstanding request. Successful execution enters `running` and keeps the target available for checks. An explicit completion command starts normal closure. Cancellation or the request deadline also starts closure. Deadlines start at admission. Dispatch requires enough remaining time for the full configured activity budget. A head without that budget expires without calling the producer. A queued request stays projected as queued until it reaches the head. An equal admission replay returns the original receipt. A conflicting key or request ID is rejected. Cancellation requires the current row revision. A queued cancellation never invokes the producer. A dispatched cancellation retains ownership until closure.

An activity result is transport evidence. Only the exact producer closure receipt clears the owner. Receipts larger than 8 KiB are rejected before retention so the 128-request state fits within the Temporal payload budget. Receipt validation uses the producer’s canonical `KubernetesReceipt` schema and digest validator. The consumer independently rebuilds the effect summary sealed by the pinned producer’s `KubernetesTarget.close`; that inline producer derivation has no exported helper. Validation binds the full request digest, image, installed target digest, policy, source revisions, target UIDs, Pod UID, operation summaries, and receipt digest. Unknown execution, invalid evidence, target quarantine, or unavailable closure retains the queue. The successor stays queued. Idle and running workflows wait for state changes, with the running deadline as a timed wakeup. Idle waits do not count toward Continue-As-New. Nonterminal closure retries use capped backoff. Producer `quarantined` and `sealed_unadmitted` observations set explicit errors and park the retained owner without further closure polling. A close before producer admission seals that exact request without a release receipt. The consumer conservatively retains its owner because it cannot prove acquisition and release. No recovery or reuse command exists for quarantine, exhausted admission capacity, or a new candidate. These require a replacement namespace or a future installation lifecycle feature. The consumer does not invent a release for this case.

`conversation_id` scopes operator command projections. It is not a project-chat identifier, and this CLI has no project-chat integration.

Terminating the canonical Temporal workflow does not release its target. Its UID-derived ID and `REJECT_DUPLICATE` reuse policy also prevent starting a replacement workflow for that namespace. Stopping and restarting the worker process is different and resumes durable history. Do not terminate a workflow as a recovery procedure.

The Kubernetes workflow has a separate type from the existing counter fixture workflow. It does not change legacy histories. Temporal remains the sole scheduler. The Verify target journal is the final authority for acquisition and release.

## Run the local operator interface

Install the exact producer revision recorded in `packaging/kubernetes-producer.json` with its locked Python dependencies. Worker and adapter startup compare the configured revision and installed producer source files with that pin before connecting to Temporal. This detects installation drift after Python imports; use trusted producer distributions. The runtime requires Python 3.13 and Temporal. Provision the producer target according to Verify's Kubernetes runtime documentation. Keep its credential and journal outside the Forge worker.

Create a private JSON file matching `KubernetesConfig`. Its `queue.authority` contains the immutable authority above. Set `queue.activity_task_queue`, `temporal_address`, `namespace`, and `workflow_task_queue`. The default Temporal namespace is `default`. These task queues must match the registered producer worker and the Forge workflow worker.

Start the workflow worker with the configuration path.

```sh
python -m verification.kubernetes_worker /private/queue.json
```

Start the producer activity worker using the producer's own entry point. Give it only the target socket and Temporal connection settings.

```sh
python -m birbverify.kubernetes_worker \
  --address localhost:7233 --namespace default \
  --queue installed-target-activities --socket /private/target.sock
```

Send one JSON command on standard input to the local adapter.

```sh
python -m verification.kubernetes_adapter /private/queue.json < /private/command.json
```

An admission command has `op: "admit"`, `conversation_id`, and a `body` containing `request_id`, `idempotency_key`, `candidate_revision`, `authored_revision`, `beans_issue`, and `approved_plan_sha256`. A cancellation uses `op: "cancel"` and a body containing `request_id`, `command_id`, and `expected_revision`. A completion uses `op: "complete"` with the same body fields as cancellation. Send it only after the external checks finish. It requests closure and does not assert a passing verdict. A snapshot uses `op: "snapshot"` and an empty body. A client-supplied principal or target field is rejected.

The response contains `ok` and either a scoped projected value or an error code. Mutation responses also retain the durable command receipt. `phase: "closed"` and `eligibility.eligible: false` are compatible. They report released resources without claiming a verified candidate. `requested_closure_reason` records consumer intent; the producer seals the authoritative reason in `closure.reason`, which may differ after a timeout. `closure_trigger` records the consumer cause. The mapping is `complete` to requested `completed`, `cancel` to requested `cancelled`, and either `deadline` or `execution_unknown` to requested `worker_lost`. An execution timeout can reach the producer as cancellation and seal `closure.reason: "cancelled"`. Read the trigger and sealed reason together.

## Run the disposable proof

Use clean committed consumer and producer checkouts. The producer must match the pin. The runner captures both HEAD revisions before execution and checks both revisions and tracked and untracked cleanliness again at exit. Any drift invalidates the proof and produces a failing exit status with `source-integrity.json`. The final report uses the captured revisions. The proof creates its own kind cluster and deletes only that cluster afterward. It never selects the ambient Kubernetes context.

```sh
scripts/verify-kubernetes \
  --producer /path/to/birbverify \
  --python /path/to/birbverify/.venv/bin/python \
  --temporal /path/to/temporal \
  --authored-revision FULL_BEANS_HUB_COMMIT \
  --evidence /private/new-proof-directory
```

The proof imports the pinned producer's private `tests/test_kubernetes_journeys.py` helpers, including `installation`, `IMAGE`, and `command`. This coupling is intentional for the pinned test fixture and is not a supported producer runtime API. A producer test refactor requires updating this proof. The runner records kind, Temporal, Docker and Python versions in `tool-versions.json`. Direct live-test invocation requires every declared fixture environment variable and an explicit executable `TEMPORAL_CLI`; otherwise collection skips. The test never downloads a Temporal server. It uses the actual Kubernetes API, target journal, Unix transport, registered producer activities, and Temporal server. The normal and cancellation journeys exercise account creation and login after the execute activity returns. A response gate is used only in the worker-loss journey to prove the target can settle an accepted API call after its caller dies. Completion is a durable workflow command, not an alternate scheduler.

Each journey records exact consumer and producer revisions, request and candidate revision, Beans reference, target binding, closure receipt, projection, and Temporal history. The restart journey kills the workflow-worker process. The worker-loss journey kills the producer-worker process. The cancellation journey exercises both queued and dispatched cancellation. All journeys prove that the successor starts only after the predecessor's release. The separate account/auth fixture assertion is not promoted into delivery eligibility. The candidate identifies fixture source at the pinned producer commit. The image digest identifies its Python runtime, not an application image built from that candidate.

The proof follows the full Continue-As-New chain. Private logs and full histories remain in the requested evidence directory. The kubeconfig is removed after cluster cleanup. Unit and simulated-API Temporal tests remain under `tests/verification_python` and do not establish real-cluster acceptance by themselves.

## Package without deployment

`packaging/kubernetes-worker.Dockerfile` adds the consumer to an exact tested Verify image. Supply `BIRBVERIFY_IMAGE` as an immutable image digest. The worker runs as UID `10001` and needs only read-only configuration and a Temporal connection. It needs no kubeconfig, target socket, target database, or Beans write token.

Health requires a Temporal poller serving the configured queue and a successful query of the canonical workflow. Container liveness alone is insufficient. The current entry point does not provide a network health endpoint.

Ferry enrollment remains separate. An approved build runner must not hold kubeconfig or dispatch runtime work. Birbhomes desired state and Flux own any later deployment. This issue does not deploy shared staging, enroll a runner, change cluster desired state, or claim compatibility with a Flux-managed Deployment. The producer fixture uses a bounded bare Pod.

The reviewed workflow state uses one closure trigger and derives the requested producer reason from it. Start this revision with a fresh target installation; this bounded slice does not establish rolling replay compatibility for older Kubernetes workflow code. The configurable owner principal and conversation checks remain in place.
