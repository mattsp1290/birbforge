# Runtime and durable coordination recommendation

Researched November 5, 2026. The owner approved self-hosted Temporal and
Pydantic AI as the first Birbcrew runtime to validate. These choices authorize
readiness planning, not implementation. No factory account integrations,
workers, or restart behavior have been live-tested.

## Accepted direction and remaining proof

Use one self-hosted Temporal service for factory coordination and durable
coworker execution, with PostgreSQL persistence. Keep Birbforge's interface and
CopilotKit OSS runtime in TypeScript. Evaluate Python with Pydantic AI as the
preferred Birbcrew implementation because it has documented AG-UI and Temporal
integrations. Retain TypeScript with the pi SDK as the alternative if the
end-to-end proof shows lower integration or account-access cost.

This recommendation prioritizes existing integrations over using one language
everywhere. It does not replace Codex, Claude Code, or pi as coding tools. Cloud
authors and coding harnesses remain separately invoked execution backends.
Birbcrew's chief of staff uses constrained factory tools to coordinate them.
Birbcrew is the first implementation repository. Each repository gets its own
poteto-mode owner handoff.

## Why Temporal

Our durable unit is a delivery lifecycle: author a change, wait for review,
reserve staging, verify it, wait for human input where required, merge, and
observe deployment health. A model conversation is only part of that lifecycle.

Temporal workers poll queues and can run outside the service. That lets the
same workflow coordinate k3s workloads and the existing Mac execution paths.
Long waits need not keep a model generating or an agent process busy.
[Worker model](https://docs.temporal.io/workers)

Use existing SDK primitives for workflows, activities, timers, cancellation,
messaging and versioning. The custom work is expressing delivery policy and
reconciling external effects. Temporal does not supply our PR approval model or
guarantee exactly-once deployments.
[TypeScript SDK](https://docs.temporal.io/develop/typescript)

Self-hosting requires backups, schema upgrades, monitoring and restricted
network access. Deploy a sustained-workload service, not a development server.
Keep infrastructure definitions in Birbhomes. PostgreSQL application records
and Temporal persistence must have separate ownership and migrations even if
they share an operated PostgreSQL installation.
[Deployment guidance](https://docs.temporal.io/self-hosted-guide/deployment),
[persistence](https://docs.temporal.io/temporal-service/persistence)

## Two viable Birbcrew paths

| Concern | TypeScript + pi SDK | Python + Pydantic AI |
| --- | --- | --- |
| Agent execution | Reuse pi's sessions, tools and context handling | Reuse the existing agent loop and selected harness capabilities |
| AG-UI | Implement and maintain a pi event adapter | Use the documented AG-UI adapter |
| Durability | Integrate session recovery with Temporal activity lifecycles | Use the documented Temporal capability inside actual workflows |
| Language footprint | Shares TypeScript with Birbforge | Adds Python across a versioned interface |
| Work still ours | Stream translation, session ownership, replay/reconnect, tool authorization | Durable-stream integration, conversation persistence, reconnect, tool authorization |
| Selection gate | No recreated pi internals; reliable recovery and AG-UI semantics | Supported account access; existing capabilities rather than a new coding harness |

Pi already exposes persistent sessions, custom tools and lifecycle events. Its
session-settled signal matters: a lower-level run-end event may precede automatic
recovery or queued work. A correct AG-UI bridge must preserve those semantics.
[Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)

Pydantic AI provides an AG-UI adapter and a Temporal durability capability. Its
documented workflow-stream integration can carry live agent events without
adding a separate message broker. These are available building blocks, not
proof that our phone reconnect and cross-device history already work. A direct
HTTP agent invocation is not automatically a durable background workflow.
[AG-UI](https://pydantic.dev/docs/ai/integrations/ui/ag-ui/),
[Temporal](https://pydantic.dev/docs/ai/capabilities/durable_execution/temporal/)

Its existing harness also includes skills, repository context, context-management
and instrumentation capabilities. Adopt only those we need. This makes it a
credible existing-runtime choice rather than an invitation to recreate pi in
Python. Datadog remains the observability destination; a new hosted observability
product is not part of this recommendation.
[Harness capabilities](https://pydantic.dev/docs/ai/harness/)

The standalone CopilotKit runtime stays TypeScript even if Birbcrew is Python.
That runtime can connect to an AG-UI agent without Intelligence. Do not confuse
a Python agent backend with CopilotKit's Python runtime, which has a different
service dependency.
[CopilotKit OSS boundary](https://docs.copilotkit.ai/concepts/oss-vs-enterprise)

## Where pi-durable fits

Pi-durable documents persisted conversations, model/tool execution and process
recovery, but explicitly marks its API experimental. It is a distinct harness,
not simply a persistence switch on the coding-agent SDK. Do not initially stack
it under Temporal without a specific benefit and clear ownership for retries,
cancel, tools and state. Revisit it if it removes more code than it adds.
[Pi-durable](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)

## Recovery boundaries

| State or effect | Proposed authority |
| --- | --- |
| Delivery progress, waits and retries | Temporal workflow history |
| Authored requests, plans, issues and shared notes | Beans hub |
| Accepted scope snapshot, policy and approval records | Birbforge application records |
| Conversation and finalized messages | Chosen Birbcrew framework/session store |
| Workspace contents and code changes | Isolated workspace plus version control |
| Verification observations and artifacts | Birbverify manifests and private artifact storage |
| Cloud task lifecycle | Provider's task ID and status, reconciled by factory adapters |

A restarted workflow must reconnect to existing external work where possible.
It must not resubmit an entire coding task just because a polling activity died.
Model/tool work belongs in supported durable activities or framework adapters,
not arbitrary nondeterministic calls in workflow code. Coordinate one active
writer per session. Stream disconnection is separate from cancellation.

## Reuse the enrolled Mac

The owner confirms that the Mac is already joined to the k3s setup. Birbhomes
documents a Linux guest for cluster/container work and a native macOS runner
for Apple tooling, with existing lifecycle and network gates. Respect both
paths. Do not introduce an always-on Temporal worker that bypasses those gates.

First evaluate dispatching native checks through the existing runner. If a
dedicated Temporal activity worker removes meaningful integration work, it
must be supervised by the same lifecycle controls. The choice is still open;
neither approach is implemented or qualified here. Do not copy private host,
account or network coordinates into these public docs.

## Proof needed before implementation commitment

1. A coworker uses an eligible existing account to call one authorized factory
   tool, with no accidental API billing or custom token broker.
2. The run streams through AG-UI to phone and browser; disconnecting both leaves
   work running, and reconnecting recovers coherent state.
3. Restart a worker during a tool call. Recover or explicitly reconcile the
   outcome without duplicate external action.
4. Pause for a durable human-input request and resolve it from another client.
   Birbforge later proves revision-bound approvals through the phone interface.
5. Recover finalized conversation history after process restart.
6. In the later Birbverify integration milestone, dispatch a real check through
   the existing Mac path. Respect its lifecycle gates and preserve the
   shared-staging reservation through interruption.

Framework provider documentation is not proof of our accounts' entitlement or
unattended operation. Pydantic AI documents subscription-related integrations,
so do not dismiss it as necessarily requiring paid API keys; verify the selected
path against provider documentation and the actual deployment before adoption.
[Pydantic provider documentation](https://pydantic.dev/docs/ai/models/openai-codex/)

Temporal is the selected shared engine. The first implementation milestone
validates Pydantic AI using the bounded proof above. Do not build both stacks or
a general-purpose runtime abstraction. A local Temporal development service is
appropriate for this isolated proof. Birbhomes owns the subsequent sustained
k3s deployment. The Birbparty acceptance milestone still requires deployed k3s
verification.
