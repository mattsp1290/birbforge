# Durable Kubernetes target queue

Birbforge admits an approved request into one Temporal FIFO for a physical Kubernetes target. It invokes Birbverify's registered target activities and retains the request until an attributable closure receipt proves release. Beans remains the owner of authored work. The queue stores a Beans issue reference and authored revision, not an editable copy of the issue.

This is a bounded local account/auth target integration. The CLI trusts the operator who supplies the installed configuration. It does not authenticate arbitrary remote callers. A closed request means the target lifecycle ended. It does not mean application verification passed or authorize delivery. Every projected result remains delivery-ineligible.

## Authority and ownership

`KubernetesAuthority` binds the physical cluster and namespace UIDs, target identity, approved Pod-template digest, producer revision, policy revision, candidate revision, image digest, and Beans issue revision. `installation_sha256` is the canonical digest of the producer's complete `KubernetesInstallation`. Admission can reference these values but cannot replace them. The Beans reference and hub commit are trusted operator inputs; this interface does not resolve or authenticate tracker records.

The canonical workflow ID hashes the physical cluster and namespace UIDs. Display-name aliases cannot create another queue. Startup and every CLI operation compare their configuration with durable workflow history. A changed policy, task queue, or candidate requires an explicit future installation lifecycle. This slice supports sequential requests for one approved candidate revision per installed workflow. It does not silently migrate active history or support live policy rotation. The default limit is 128 lifetime admissions, including closed and cancelled requests. Reaching the limit requires a future installation lifecycle, not a retry.

The workflow persists FIFO order, request payloads, idempotency receipts, command receipts, and one outstanding request. Successful execution enters `running` and keeps the target available for checks. An explicit completion command starts normal closure. Cancellation or the request deadline also starts closure. Deadlines start at admission, so queued requests can expire before dispatch; their projection remains queued until they reach the head. An equal admission replay returns the original receipt. A conflicting key or request ID is rejected. Cancellation requires the current row revision. A queued cancellation never invokes the producer. A dispatched cancellation retains ownership until closure.

An activity result is transport evidence. Only the exact producer closure receipt clears the owner. Receipt validation binds the full request digest, image, installed target digest, policy, source revisions, target UIDs, Pod UID, operation summaries, and receipt digest. Unknown execution, invalid evidence, target quarantine, or unavailable closure retains the queue. The successor stays queued. A close before producer admission seals that exact request without a release receipt. The consumer conservatively retains its owner because it cannot prove acquisition and release. No recovery or reuse command exists for quarantine, exhausted admission capacity, or a new candidate. These require a replacement namespace or a future installation lifecycle feature. The consumer does not invent a release for this case.

The Kubernetes workflow has a separate type from the existing counter fixture workflow. It does not change legacy histories. Temporal remains the sole scheduler. The Birbverify target journal is the final authority for acquisition and release.

## Run the local operator interface

Install the exact producer revision recorded in `packaging/kubernetes-producer.json` with its locked Python dependencies. The runtime requires Python 3.13 and Temporal. Provision the producer target according to Birbverify's Kubernetes runtime documentation. Keep its credential and journal outside the Birbforge worker.

Create a private JSON file matching `KubernetesConfig`. Its `queue.authority` contains the immutable authority above. Set `queue.activity_task_queue`, `temporal_address`, `namespace`, and `workflow_task_queue`. The default Temporal namespace is `default`. These task queues must match the registered producer worker and the Birbforge workflow worker.

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

The response contains `ok` and either a scoped projected value or an error code. Mutation responses also retain the durable command receipt. `phase: "closed"` and `eligibility.eligible: false` are compatible. They report released resources without claiming a verified candidate. `requested_closure_reason` records consumer intent; the producer seals the authoritative reason in `closure.reason`, which may differ after a timeout.

## Run the disposable proof

Use clean committed consumer and producer checkouts. The producer must match the pin. The proof creates its own kind cluster and deletes only that cluster afterward. It never selects the ambient Kubernetes context.

```sh
scripts/verify-kubernetes \
  --producer /path/to/birbverify \
  --python /path/to/birbverify/.venv/bin/python \
  --temporal /path/to/temporal \
  --authored-revision FULL_BEANS_HUB_COMMIT \
  --evidence /private/new-proof-directory
```

The proof imports the pinned producer's real fixture setup. It uses the actual Kubernetes API, target journal, Unix transport, registered producer activities, and Temporal server. The normal and cancellation journeys exercise account creation and login after the execute activity returns. A response gate is used only in the worker-loss journey to prove the target can settle an accepted API call after its caller dies. Completion is a durable workflow command, not an alternate scheduler.

Each journey records exact consumer and producer revisions, request and candidate revision, Beans reference, target binding, closure receipt, projection, and Temporal history. The restart journey kills the workflow-worker process. The worker-loss journey kills the producer-worker process. The cancellation journey exercises both queued and dispatched cancellation. All journeys prove that the successor starts only after the predecessor's release. The separate account/auth fixture assertion is not promoted into delivery eligibility. The candidate identifies fixture source at the pinned producer commit. The image digest identifies its Python runtime, not an application image built from that candidate.

The proof follows the full Continue-As-New chain. Private logs and full histories remain in the requested evidence directory. The kubeconfig is removed after cluster cleanup. Unit and simulated-API Temporal tests remain under `tests/verification_python` and do not establish real-cluster acceptance by themselves.

## Package without deployment

`packaging/kubernetes-worker.Dockerfile` adds the consumer to an exact tested Birbverify image. Supply `BIRBVERIFY_IMAGE` as an immutable image digest. The worker runs as UID `10001` and needs only read-only configuration and a Temporal connection. It needs no kubeconfig, target socket, target database, or Beans write token.

Health requires a Temporal poller serving the configured queue and a successful query of the canonical workflow. Container liveness alone is insufficient. The current entry point does not provide a network health endpoint.

Ferry enrollment remains separate. An approved build runner must not hold kubeconfig or dispatch runtime work. Birbhomes desired state and Flux own any later deployment. This issue does not deploy shared staging, enroll a runner, change cluster desired state, or claim compatibility with a Flux-managed Deployment. The producer fixture uses a bounded bare Pod.
