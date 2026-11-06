# Birbforge: agreed product decisions

Status: system design agreed. Recorded November 5, 2026. This document records
product decisions, not implemented capabilities. Infrastructure and provider
integrations still need validation. The owner has approved self-hosted Temporal
and Pydantic AI as the first Birbcrew runtime to validate. Beans owns authored
work and shared notes. Codex owners use Claude CLI for independent review.
Deployment choices remain subject to their documented gates.

## Purpose

Turn owner-approved goals into independently reviewed, verified changes, then
carry responsibility through merge, deployment, and production health. Follow
pstack's working practices while reusing existing software to minimize the
custom platform we maintain.

Prefer open-source components. Paid products remain candidates when they
remove substantial maintenance. Custom code is welcome where it implements
Birbforge's distinctive behavior; rebuilding an existing agent harness is not.

CopilotKit Intelligence is explicitly excluded, including hosted and self-hosted
editions. It is not an optional future dependency. CopilotKit open-source SDKs,
the standalone TypeScript runtime, and AG-UI remain candidates. Do not adopt
templates that require Intelligence or fork a large platform to remove it.
Conversation persistence and cross-device recovery must use independent
components and existing agent-session capabilities.

One human owns each installation initially. The public repository must be
reusable by other people without exposing any installation's private settings.

## Repository boundaries

[Birbcrew](https://github.com/mattsp1290/birbcrew) is the selected name and
repository for a replacement for crabber-coworkers. The owner has reopened the
programming-language and runtime choices. The owner subsequently approved
Python with Pydantic AI as the first integration path to validate and self-hosted
Temporal as the shared durable execution engine. TypeScript with pi remains an
alternative if the proof fails. Reuse an existing agent runtime.

The agreed boundary is Birbcrew for reusable persistent coworkers and
Birbforge for the factory interface, goal policy, and delivery workflows.
crabber-coworkers remains a behavior and migration reference. crabber-channels
remains a reuse candidate; its coupling to Crabber and suitability for the
agreed notifications-only Slack flow require evaluation.

[Birbverify](https://github.com/mattsp1290/birbverify) is the selected repository
for reusable verification execution and evidence collection. It checks exact
candidate revisions using repository-owned tests and deployment procedures,
coordinates workers with the required Linux or Mac capabilities, and returns
evidence tied to the commit, deployed artifacts, and environment. Birbforge
retains acceptance policy, approval gates, and merge authority. Application
tests stay in their application repositories; infrastructure stays in birbhomes.

The intended distribution is public reusable code with private installation
configuration and private verification artifacts by default. Worker credentials
must be scoped to the permitted environment. Birbverify must reuse existing
test tools and the selected durable execution system rather than introduce a
new agent harness or scheduler. Its progress is surfaced through Birbforge's
AG-UI interface; the internal worker transport remains to be selected.

The first proposed Birbverify delivery is a Birbparty candidate deployed to k3s
staging with a reviewable evidence bundle. Missing or inconclusive checks must
remain explicit. Execution contracts, isolation, artifact storage, and the
boundary between workflow coordination and worker execution still need design.

The first version will queue verification runs against the existing shared k3s
staging environment rather than create a preview environment for every PR.
The proposed execution and evidence details are recorded in
[the verification contract](verification-contract.md). Those details remain a
design proposal. Temporal is now the selected engine. Worker transport details
and artifact storage still require design.

## Implementation readiness goal

The current goal is to prepare the repositories for implementation with
poteto-mode. Birbcrew is the first repository. The owner intends to start one
owning agent with poteto-mode for each repository. Prepare separate bounded
handoffs with dependencies, verification evidence and escalation rules.
Do not interpret this as starting all implementation agents now.

Use the first Birbcrew milestone to validate the selected runtime and durable
AG-UI interaction before dependent product work. Each repository owner can
delegate within its scope. Cross-repository contract changes require explicit
coordination. The owner has agreed the consolidated design and authorized HTML.

## Coworker continuity and Beans

Each repository coworker has a stable identity. The owner selected separate
conversations per goal and shared, reviewable repository notes. A coworker role
can continue through fresh agent sessions. Conversation history and shared
knowledge are different records.

Reuse the existing Beans project for shared notes. Its `bn` CLI already manages
project memories and session handoffs in a separate Git-backed hub. Expand
Beans where a demonstrated integration gap warrants it. Do not create another
general-purpose memory or wiki service in Birbcrew. Record the Beans project,
note key and source revision used to inform a conversation.

The owner selected Beans for requests, authored plans, issues and shared notes.
Birbforge stores accepted scope snapshots, approvals and delivery records.
Temporal remains responsible for execution.
No arbitrary memory text or generic issue status can grant merge authority.

## AG-UI is required; A2UI is optional

AG-UI is a required interface for Birbcrew and a central part of Birbforge,
including its phone and browser clients. It must carry agent conversations,
run/tool progress, shared user-facing state, and human-interaction requests.
The chief-of-staff conversation and agent-facing parts of the inbox must use
the same identities and authoritative task/decision records.

Use existing AG-UI SDKs and CopilotKit OSS components. Do not invent a competing
agent event protocol or require CopilotKit Intelligence. AG-UI does not replace
durable execution, storage, authentication, or server-side authorization.
Administrative APIs may handle operations outside the agent interaction
contract, such as configuration and artifact transfer.

A2UI is optional presentation over that foundation. Core phone/browser
functionality and approval flows must work without it. Runtime and language
selection should be evaluated against the required AG-UI contract.

## Two interfaces to one factory

The human acts as CTO/CEO. A chief-of-staff agent helps shape goals, coordinates
specialists, explains evidence, and surfaces decisions. A structured inbox
provides direct access to the same work and actions. Users can move between
conversation and inbox without losing state.

The chief of staff can execute explicit human decisions, but cannot substitute
its own judgment for a required human approval. Both interfaces must enforce
the same authorization rules and record decisions against the relevant work.

The proposed chief-of-staff scope is all connected repositories, with shared
priorities and per-repository work queues. Exact scheduling remains open.

## Phone, browser, and desktop setup

- The phone supports the full everyday workflow: goal creation, planning,
  approvals, inspection, intervention, review, and evidence.
- The initial Mac interface can run in a browser and share code with the phone.
- React Native is the selected interface direction. Expo with React Native Web
  is the recommended implementation approach, pending integration validation.
- Desktop-only setup is acceptable where local CLI tools or credentials require
  it. A browser cannot directly execute installed CLIs; guided terminal setup
  is the initial proposal. Tauri remains an optional later desktop shell.
- Execution and notification delivery continue when the phone and desktop
  interfaces close.

## Private access

The initial Birbforge interface and API are accessible through private NetBird
access from phone and desktop. A public repository does not imply a public
installation. Actual hostnames and network configuration remain private.

Application identity and authorization still need to be designed. External
provider integrations and notification delivery must work with this private
access boundary; callback or polling mechanisms remain to be selected.

## Goals and autonomy

Only approved goals enter execution. Agents may choose implementation details,
repair failures, and retry within approved scope. Material scope expansion
requires a human decision.

Agents may propose follow-up goals in the inbox. They cannot start those goals
until the human approves them.

## Delivery ownership and approval

Each PR has an owner agent responsible for implementation, feedback, merge,
and post-merge follow-through. Independent reviewer agents assess changes and
verification evidence. The owner cannot approve its own work.

AI approval and merge are separate actions. The owner agent may merge when
required approvals and checks pass for the current revision. Relevant checks
and reviews must be refreshed after changes.

Human approval is always required for changes involving:

- Authentication and permissions.
- Destructive database migrations.
- Secrets and credential handling.
- Production infrastructure.

Any agent can additionally request human review. The request must explain the
risk, present evidence, and identify the decision needed. Required human review
blocks merging until resolved.

## Concurrency and execution

Implementation and review can run in parallel. Merge, deployment, and production
verification are serialized per deployment environment. A regression pauses
that environment's delivery queue while health is restored.

The intended topology combines provider-hosted cloud authors with local
validators and durable coordination on existing k3s infrastructure. A Mac is
already joined to the k3s setup, as confirmed by the owner. Birbhomes documents
two execution paths on that hardware: a Linux guest participating in k3s and a
native macOS runner for Apple tooling. Reuse its existing lifecycle controls;
do not propose onboarding a new Mac or treat an older preparation report as
current enrollment status. Native toolchain readiness still needs a live proof.
Temporal is the selected durable execution software. Exact worker placement
and provider adapters remain to be validated.

Existing Codex, Claude, and OpenCode Go subscriptions are approved resources;
pi is an available harness. Automatic fallback between approved providers is
desired. Preserve progress and independent-review requirements during fallback.
Do not incur paid overage without authorization. Actual entitlement, automation
support, and usage visibility must be verified per integration.

## Staging and the first pilot

Agents may deploy automatically to private k3s staging for verification.
Birbparty is the first pilot. It already has livestream chat; the selected
feature is emoji support and up to six creator-uploaded custom emojis.

Reuse Birbparty's existing deployment guidance and the infrastructure
repository's private-deployment skill. Dev and staging refer to the same
existing private environment. Current health and support for the complete
livestream stack still require verification.

Feature acceptance must exercise the deployed k3s application. Unit tests or
local Compose alone are insufficient. The pilot's pre-merge verification
target is not its production environment.

## Post-merge production responsibility

Existing GitHub, GitLab, or Forgejo CI may deploy after merge. Routine deployment
through that existing pipeline does not introduce a blanket extra human
approval; the mandatory review categories above still apply.

The owner agent follows the relevant pipeline and deployed revision, then uses
the pup CLI to inspect Datadog production health. Completion requires passing
the repository's observation window and health criteria. Missing telemetry is
incomplete verification, not evidence of health.

Repository policies must identify deployment pipelines, health signals,
environment filters, observation windows, and approved recovery procedures.
Exact policy format remains open.

Agents may execute human-approved rollback procedures automatically unless
repository guidance restricts them. Check applicability and prerequisites;
escalate if a procedure is inapplicable, uncertain, conflicting, or unsuccessful.
Verify the recovery deployment and production health before proceeding with a
corrective PR. A source revert alone is not proof of production recovery.

## Observability

Use Datadog for both factory operation and production-service verification.
Track goal progress, stalled work, human-review requests, agent attempts,
provider failures and fallback, reported usage, verification outcomes,
deployments, and rollback outcomes.

Correlate goals, runs, agent attempts, PRs, commits, deployments, and evidence.
Distinguish reported usage from estimates and unavailable data. The proposal is
to keep authoritative workflow state in a durable backing store and use
Datadog for telemetry and alerts. Temporal is selected for execution history.
PostgreSQL is the proposed application store. Beans owns authored work records
and shared notes. Birbforge can index them without creating a second editable
source of truth.

## Notifications and private configuration

Deliver actionable notifications through phone push and a configurable Slack
destination. Slack initially contains notifications and links into Birbforge;
decisions and approvals happen in Birbforge.

Do not commit real workspace/channel destinations, credentials, infrastructure
access coordinates, or private installation settings. Public documentation and
configuration examples use placeholders. Store installation configuration
privately and credentials in the chosen secret store.

Slack CLI availability on the desktop is an accepted setup assumption. Login
and app setup may be desktop-only. Unattended notification delivery must not
depend on a running desktop or assume CLI login alone provides bot permissions.
No Slack messages or account changes were authorized as part of this design
recording step.

## Remaining design decisions

- Specify the selected Temporal deployment and the remaining state components.
- Validate cloud dispatch, local worker, and provider fallback integrations.
- Establish chief-of-staff tools and the shared inbox/action contract.
- Validate CopilotKit/AG-UI integration for the phone and web clients.
- Define installation authentication and secret storage within private NetBird
  access, including external integration callbacks or polling.
- Define repository policy precedence and enforceable approval/merge gates.
- Define artifact retention, recovery after interrupted work, and notification
  delivery behavior.
- Confirm pilot acceptance details and the live staging prerequisites.

## Documentation deliverable

After agreement on system behavior and components, produce dark-themed HTML
documentation and diagrams under this repository's docs directory. Write for a
senior software engineer with ADHD: clear hierarchy, short summaries,
progressive detail, concrete flows, and explicit evidence and limitations.

The owner approved HTML documentation after reviewing the design checkpoint.
This does not authorize scaffolding or deploying the factory in this task.
