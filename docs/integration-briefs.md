# Existing repository integration briefs

Status: draft scopes for human-started repository owners. These briefs do not
launch agents, mutate a Beans hub or authorize deployment during planning.
Each owner reads the destination repository's current instructions first.

## Beans

Prove shared-note writes using two clients and one note in a disposable hub.
Commit a first update, lose its response, and retry from a fresh caller process.
Recover the existing result. Then submit a different stale update and verify
that it cannot silently replace the first client's note.

Inspect existing transaction and plan revision machinery before adding code.
Implement only demonstrated gaps, such as caller operation identity or a
conditional memory update. Beans also owns authored requests, plans and issues.
Integrate those records in a later milestone after the bounded note-write proof. Do not change a real private
hub as test data. Use bn for repository work tracking as its AGENTS.md requires.

Acceptance includes the lost-response journey, stale-write conflict, structured
CLI behavior and the repository's required verification. Native formal proof
requires its documented Linux environment. Publish the contract for Birbcrew
consumers. Never claim macOS compilation proves the Linux formal checks.

## Birbhomes

Inspect readiness for self-hosted Temporal, PostgreSQL, private application
access, artifacts and Datadog collection. Reuse existing private configuration
and lifecycle controls. Return a concrete deployment proposal with dependencies,
resource needs, backup and recovery procedures, and validation evidence.

The Mac is already enrolled in the k3s setup per the owner. Verify current Linux
guest and native macOS capabilities through the existing onboarding guidance.
Native Apple tools run on macOS. Durable worker processes must respect the
documented lifecycle gates. A worktree does not isolate untrusted native code.

Select native isolation and external mutation fencing before granting candidate
execution. Use placeholders in public cross-repository docs. Keep real coordinates
and credentials private. Infrastructure changes follow this repository's review
and deployment rules. This initial brief is an inspection and deployment-design
handoff, not authorization for a production change.

## Birbparty

The pilot extends existing livestream chat with emoji support and six
creator-uploaded custom emojis. Before implementation, settle the emoji ownership
scope, supported formats and size limits, replacement and deletion behavior,
and native-client acceptance. Record these as explicit assertions.

Read the current root instructions, application design guidance and environment
runbook. Never read .env files. Use the prepared staging target and repository
deployment tooling. Avoid ambient cluster selection. Prove the exact deployed
candidate on shared k3s staging. Production is not the pre-merge test target.

The acceptance journey must cover creator management, the six-item limit,
authorization, viewer sending and receiving during a livestream, and the agreed
native behavior. Preserve failures and missing evidence. Confirm cleanup before
releasing staging. Birbverify collects these observations; the application repo
owns the tests and user journeys.

The broader factory pilot later exercises PR ownership, independent approval
and post-merge follow-through. A successful emoji test alone does not prove the
complete delivery system.
