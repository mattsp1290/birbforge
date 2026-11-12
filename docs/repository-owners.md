# Repository owners and implementation order

Status: ownership model agreed. Crew is ready for its first implementation
run. Downstream briefs retain their dependency gates. The owner plans to start a separate poteto-mode agent for each repository
in Codex, with Claude CLI for independent review.

Each repository has one coordinating owner. An owner may delegate bounded work
inside that repository. A repository owner is a role that survives individual
agent sessions. It does not require one process or context window to live for
the duration of the project.

## Responsibilities

| Repository | Owner's first deliverable | Dependency |
| --- | --- | --- |
| Crew | Durable AG-UI conversation proof with Pydantic AI and Temporal | Isolated local development dependencies and an eligible subscription |
| Forge | Phone and browser conversation/inbox journey using the proven Crew contract | Crew contract and fixtures |
| Verify | Execute one repository verification plan and return attributable evidence | Factory verification contract and environment permissions |
| Birbhomes | Operate Temporal, persistence and worker integration within existing private infrastructure | Deployment requirements and pinned artifacts from product owners |
| Beans | Prove a shared-note update through a lost response and a stale writer, then fill demonstrated gaps | Existing CLI behavior and an agreed note-write acceptance journey |
| Birbparty | Emoji support and six creator-uploaded custom emojis, verified on deployed k3s staging | Final feature acceptance and staging readiness |

Crew goes first. Birbhomes can inspect deployment prerequisites while that
proof runs. The Beans owner can investigate write recovery independently while
Crew initially reads fixture notes. Forge and Verify can prepare their own tests and interfaces
once the relevant contracts are stable. The Birbparty feature is the complete
factory pilot, not a prerequisite for the first coworker-runtime proof.

The proposed Beans write journey uses two clients and one note in a disposable
hub. One client updates the note and loses the response. Retrying that operation
must recover its result. A stale client's different update must not overwrite
the newer note silently. Request, plan and issue integration follows this bounded
first write proof. Beans ownership of those authored records is now agreed.

## Contract ownership

Beans owns authored requests, plans, issues, shared notes and their mutation
formats, as agreed in [the Beans integration](beans-integration.md).
Crew owns its AG-UI compatibility behavior and persistent-conversation
contract. Forge owns goals, factory actions, approval records and delivery
policy. Verify owns the executable verification request and evidence schema.
Birbhomes owns infrastructure placement and lifecycle controls. Birbparty owns
application acceptance journeys and deployment procedures.

Forge's design docs record the cross-repository agreements. During
implementation, publish schemas and fixtures with the repository that owns
them. Consumers pin versions rather than copy independently changing contracts.
Prefer a package within an existing repository before creating another repo.

A producer proposes a contract change with examples and compatibility impact.
The coordinator identifies affected consumers. Owners agree the transition
before relying on it. Give each agent a separate checkout or worktree for its
changes. Do not have two owners write the same integration branch.

## Reporting and intervention

Each handoff must name the approved scope, exact dependency versions or their
selection gate, verification commands, evidence, and conditions requiring a
human decision. The owner reports blockers with evidence and a recommended
next action. Missing evidence stays visible.

The initial agent runs are human-started implementation sessions. The eventual
factory will automate comparable ownership through Crew and Forge.
Do not assume the factory is already running while building it.

Implementation owners do not approve their own work. Review and merge remain
separate roles. The current readiness task does not launch implementation
agents, grant production deployment access, or authorize messaging other tasks.

## First handoff

The [Codex launch guide](start-repository-owner.md) defines the selected host
mapping and first prompt. The [design checkpoint](design-checkpoint.md)
records the agreed design and explicitly deferred deployment choices.

The ready Crew handoff lives in `birbcrew/docs/first-milestone.md`.
It proves conversation durability and interaction behavior. Phone presentation,
real PR approvals, k3s deployment and native Mac acceptance have separate gates
in the downstream repositories. These gates remain part of the factory outcome.
