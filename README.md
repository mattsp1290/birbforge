# Forge

Forge is a React Native workspace for a Forge server. Use the same five screens on a phone or in a browser.


Canonical repositories: [Forge](https://github.com/mattsp1290/forge),
[Crew](https://github.com/mattsp1290/crew), and
[Verify](https://github.com/mattsp1290/verify).

## Repository rename compatibility

These repository and product names replace Birbforge, Birbcrew and Birbverify.
This change does **not** upgrade the pinned Crew/Verify revisions or migrate their
published APIs. Python imports (`birbcrew`, `birbverify`), versioned contracts,
Temporal activities, environment variables, the project-token header, machine
error codes, native app identifiers, persisted settings and installation paths
retain their existing identifiers. Existing Beans actor/issue IDs and recorded
evidence are unchanged. Repository membership uses GitHub's stable numeric IDs.

New local checkout defaults use sibling `crew` and `verify` directories.
`scripts/dependency` accepts `CREW_SOURCE`, with `BIRBCREW_SOURCE` retained as a
fallback. Guest setup accepts `--crew-source`/`--verify-source` and matching
`--crew-export`/`--verify-export` options; their old `--birbcrew-*` and
`--birbverify-*` spellings remain aliases. Guest producer selection accepts both
sets of names. Existing saved guest configuration keys and dependency export
paths remain valid. No private installation or native application is renamed.

## Workspace

- **Factory** shows the selected machine's runtime and verification queue. Open a goal workflow here to send a goal, answer a decision, or continue it from another device.
- **Projects** supports GitHub-backed projects and their contextual chats on configured gateways. For a standalone Beans workspace, it reads the gateway's Beans hub. Create a `bn` project and link its GitHub repositories.
- **Crew** manages agent profiles, their instructions, their assigned projects, and their engine. An agent can use the built-in workspace or, when the gateway configures Crew members, a Codex or Pi member.
- **Chat** pins the Chief of Staff above your other conversations. Ask the chief about the factory or start a thread with a crew agent. Local inspection works without a live provider. A thread with a Codex or Pi agent runs on a durable Crew member and keeps the engine it started with. See [Crew member chats](docs/member-chats.md).
- **Settings** manages machine connections, server-side secrets, theme, and text size.

On a phone, connect to the server's private network, open **Settings**, and enter its HTTPS URL. Bearer-authenticated gateways also require an owner credential. The public mobile app ships with an empty server field. In a browser, open the gateway's own address. The app remembers machine profiles on the device and keeps the owner credential in memory.


- [Read the durable verification queue contract and evidence status](docs/durable-verification-queue.md).
- [Run the disposable development proof](docs/development.md).
- [Run through an existing Linux guest on Mac](docs/host-execution.md).
- [Prepare private phone access](docs/private-phone-access.md).
- [Deploy the production image](docs/production-deployment.md).
- [Verify on Mac and iPhone](docs/mac-iphone-verification.md).
- [Read the authenticated action contract](docs/action-contract.md).
- [Check milestone acceptance and review gates](docs/evidence/acceptance.md).
- [Open the existing dark documentation site](docs/index.html).

The implementation is under `app` and `server`. `scripts/verify` exercises the
shared action and Linux browser with disposable Temporal, PostgreSQL, generated
test credentials, and an explicitly selected fixture Beans hub. It never reads
the private hub. Credentials, fixture logs, host configuration, and screenshots
stay outside Git. Authentication and permission changes require human review
before merge.

[Contextless closure integration](docs/contextless-closure-integration.md) documents the fresh v2 queue profile, supervisor commands and isolated proof.
