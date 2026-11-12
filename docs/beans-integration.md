# Beans in the factory

Inspected November 5, 2026 at Beans commit
`5df68a6a325ec8181c5c58d266d08aad8b090188`. The installed CLI reports v0.3.0.
This is source inspection, not a live integration proof. No hub records were
read or changed, and the existing untracked milestone file was left untouched.

## Reuse shared knowledge

The owner selected separate goal conversations and shared repository notes.
Beans is the existing place for those notes. Crew should retrieve relevant
project memories and handoffs through `bn`, retain their identities and source
revisions, and make them available to the coworker. Keep conversation messages
in the conversation store. Do not put streamed tokens into Git or build another
wiki and memory product in Crew.

For the initial fixture proof, provenance means note keys, paths, updated
timestamps, content digests and the clean hub commit captured with those bytes.
Beans does not currently promise a per-note commit field in its read output.
Use a quiescent clean fixture snapshot. Do not attribute uncommitted note bytes
to a Git commit merely because that commit is currently HEAD.

The Beans source repository contains the software. Its hub is a separate Git
repository containing the authored records. A public Beans or Forge repository
does not make that hub public. Hub locations and remotes stay in private
installation configuration.

## Agreed record ownership

The owner selected Beans for authored work records and shared notes.

| Record | Authority |
| --- | --- |
| Requests, authored plans, issues, repository memories and handoffs | Beans hub |
| Coworker run attempts, durable waits and retries | Crew's Temporal workflows |
| Delivery attempts and environment reservations | Forge's Temporal workflows, exposed through supported queries and application projections |
| Accepted execution snapshot, approval decisions, PR revision bindings and deployment outcomes | Forge |
| Finalized conversation messages | Crew's conversation store |
| Large screenshots, logs and recordings | Private artifact storage, referenced by manifests |

Forge can index Beans records for its inbox, but indexes must carry source
IDs and revisions. Writes go through Beans. Do not maintain a second editable
copy of the same plan in PostgreSQL. An approved execution captures the authored
scope revision so later note or plan edits cannot silently expand active work.
Beans status changes describe work. They do not replace authenticated approval
records or prove a deployment healthy.

## Existing capabilities

Beans already provides structured CLI output, project selection, actors,
requests, plans, issues, memories and handoffs. The stored-format specification
describes handoff contents as immutable continuation snapshots while the CLI
supports attachment and archival operations. Mutations use its Git
transaction and recovery code. Plan updates reject stale authored revisions.
The CLI returns commit identifiers and whether a mutation was pushed.

Use the CLI first for capabilities that are not available over HTTP. The server
has no built-in authentication, and its current HTTP API makes requests and
plans read-only. Do not expose that server as the factory's trusted action API.
Forge's authenticated handlers can call narrowly scoped Beans operations
from a protected worker. Shared network access alone is not authorization.

Relevant inspected source files are `AGENTS.md`, `README.md`, `docs/cli.md`,
`docs/server.md`, `docs/format.md`, `src/ops/content.rs`, and `src/gitops/hub.rs`
in the Beans repository. Verify the installed CLI's help before implementing a
wrapper. The CLI and HTTP interfaces have different timestamp representations.

## Gaps worth proving before expanding Beans

The inspected `remember` operation treats identical content, type and tags at
the same key as a no-op. That helps repeat identical writes. It does not provide
a caller-visible expected-revision guard against a stale writer replacing newer
memory. Plans already have a stronger stale-update check worth reusing.

The inspected Git mutation code generates a new nonce inside each invocation.
Its internal retry protection does not establish deduplication across separate
Temporal retries that launch new CLI processes. Before permitting automated
creates or append operations, prove how a caller identifies and reconciles an
operation whose response was lost. A stable caller operation ID may be a useful
Beans addition. Do not assert that it already exists.

Keep expansions bounded and useful outside the factory. Candidates include
caller operation identity, conditional memory updates, and missing structured
mutation endpoints. Select only the gaps demonstrated by an acceptance journey.
Continue using Beans' existing transaction code rather than writing hub files
or committing them directly from Crew.

## First milestone impact

The Crew runtime proof remains first. Add a bounded read of project notes
from a disposable Beans fixture hub. Record the note identities and show the
same context survives reconnect. Do not consume unrelated private hub contents.

The benign effect used for the worker-interruption test remains an isolated
test fixture until automated Beans writes have a proven retry contract. This
avoids making the first runtime proof depend on a speculative Beans rewrite.
The Beans owner can independently investigate and implement the needed write
contract before the factory grants coworkers note-writing tools.

## Notes are context, not policy

Coworkers can cite shared notes and propose updates. A note cannot override
approved goal scope, credential restrictions, or human-review requirements.
Record provenance and revisions so stale or incorrect knowledge can be repaired.
Repository notes stay scoped to that repository unless the operator deliberately
uses hub-wide knowledge. Do not automatically promote every conversation into
shared memory.
