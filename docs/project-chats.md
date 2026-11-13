# GitHub projects and project conversations

This candidate adds local project import, project controls, and read-only project conversation. Chat-local implementation launch is incomplete. It requires accepted Ready producer pins. The installed documentation pilot cannot launch work for project chats.

## Ownership

Beans owns the stable project namespace, editable display name, ordered GitHub repository membership, archive state, revisions, and mutation receipts. Forge invokes `bn project apply`, `catalog`, and `inspect`. It does not edit the hub or keep an editable membership copy.

Forge owns one server-side GitHub connection, current access checks, repository discovery, and immutable operation intents. Octokit follows GitHub pagination into a complete catalog before replacing the previous catalog. Search and UI pagination operate on that complete metadata catalog. A failed refresh reports unavailable. Cached membership never authorizes a source read.

The adapter resolves stable numeric GitHub IDs before reading content. Canonical names can change without creating a second membership. Discovery and source access both verify the configured account through `GET /user`. Credentials stay on the server. The adapter uses GitHub.com and performs only GET requests. Import creates no GitHub repository and changes no remote repository.

Crew owns durable conversation and turn identities, finalized messages, immutable context, and recovery. Its separate planning workflow uses Pydantic AI, the maintained OpenCode Go integration, Temporal, PostgreSQL, and AG-UI. The planning agent has no tools. Messages cannot edit source, execute scripts, publish, or dispatch implementation.

## Private configuration

Add `projects` to the existing gateway configuration. All paths below are installation placeholders.

```json
{
  "owner_principal": "owner",
  "github": {
    "token_file": "/private/github-owner-token",
    "owner_login": "owner"
  },
  "beans": {
    "binary": "/application/bn",
    "hub": "/private/beans-hub",
    "home": "/private/service-home",
    "branch": "main",
    "actor": "birbforge-owner"
  },
  "service_token_file": "/private/crew-project-service-token",
  "intent_directory": "/private/project-operation-intents"
}
```

Use the reviewed Beans project contract candidate and Crew project-chat candidate together. The original released Beans CLI lacks these commands. This documentation does not supply an accepted Ready implementation-worker pin.

Provision both token files owner-only outside source control and client bundles. Configure Crew's `project_service_token_sha256` with the SHA-256 of the project service token. Retain the existing owner bearer credential between Forge and Crew. Configure an isolated service home with the reviewed Git identity and access needed by Beans. Do not inherit a developer's hub or credential configuration implicitly.

Run Crew's existing API and its separate `python -m birbcrew.project_worker` process. The project worker requires `project-live` or `project-test` configuration. Its queue defaults to the existing task queue with `-projects` appended. See Crew's `docs/project-chats.md` for the provider credential and exact context contract. `project-live` needs the provider key and no attestation. `scripts/project-journey.py --live` therefore needs a sibling Crew checkout at or after the removal of provider attestations, and it stops with a message on an older one. The gateway may keep its existing approved-goal deployment mode. Project conversation kind is persisted separately from that mode.

The phone and browser persist pending project commands and chat UUIDs with AsyncStorage before sending them. Reload restores an unchanged action for explicit retry. Credentials are never stored there.

The operation directory contains immutable runtime intents. They freeze the caller's original request, resolved membership metadata, or chat context before an external mutation. They are recovery records, not an authored project store. Keep them on durable owner-only storage across service restarts. The same operation identity with changed input conflicts. Retried chat creation reenters the trusted Crew creation boundary so an inserted projection with no started workflow can reconcile its original workflow identity. Retain the directory after an uncertain acknowledgement.

This local source candidate is not an installation procedure for shared staging. Homes must supply an authorized runnable staging package and reservation contract before installation or phone acceptance.

## Project behavior

The first selected repository supplies the default short project name. An explicit name overrides it. Later membership changes retain the display name. Forge limits each project to twenty repositories. Membership deduplicates by stable GitHub ID. The server rejects removal of the last repository.

Every edit sends the stable project ID, caller operation UUID, and observed Beans revision. A stale edit conflicts. A failed mutation retains the original operation for unchanged retry. A failed publication reports uncertainty. A local authored receipt does not prove remote publication. New chat context requires a clean hub and matching HEAD and upstream before capture.

Removing a project archives it from the active catalog. It preserves membership, authored history, conversations, local checkouts, and GitHub repositories. Existing chats remain readable by identity and in conversation history. Archived projects reject new chats and new turns. This candidate cannot admit project execution. It rejects the old pilot delivery endpoint for all project chats. Ready integration must serialize its admission and archive check before enabling execution, and must reject archive while execution is active or termination is uncertain.

## Conversation context

New chats freeze the current Beans project revision, ordered repository IDs, canonical URLs, exact GitHub commits, actual source bytes and SHA-256 digests, and scoped Beans note identities. The bounded source selection is `README.md`, `AGENTS.md`, `docs/architecture.md`, and `docs/design-decisions.md`, when present and at most 24,000 bytes each. Missing, oversized, unsupported, invalid UTF-8, and budget-excluded files remain explicit context gaps. A repository can remain a member with no selected readable file. The assistant must disclose missing evidence. This candidate does not provide arbitrary file exploration.

Beans notes come from the selected namespace only. Global and unrelated notes are excluded. Capture records the clean hub commit, note path, timestamps, whole-file digest, and body digest. Notes are frozen with the chat. They confer no authority.

Historical chats retain their original context after project edits. The UI compares the frozen project revision to current Beans state. A new chat adopts current membership. Before a new provider turn, Forge checks current repository access and read access to a frozen source file in each repository that supplied source text. An already accepted unchanged request reconciles through a read-only Temporal receipt query before fresh access checks, including when the PostgreSQL projection lags. Explicit GitHub permission loss returns a rejected unavailable state rather than an uncertain dispatch acknowledgement. Reconnect observes finalized state and does not resend a turn.

Project chats permit up to sixteen accepted inputs. A 32 KiB accepted-user-text budget and 64 KiB native-history budget can require a new chat sooner. Frozen context is limited to 128 KiB of serialized JSON. An unchanged request retains its identity beyond that limit. New inputs then require a new chat. Provider model activities have one attempt. The underlying OpenAI SDK also has retries disabled. A rejected preflight records that no inference was dispatched and keeps the chat open for a new explicit request after account evidence is refreshed. An interrupted provider turn retains its request and unconfirmed attempt, closes the conversation, and never automatically dispatches a replacement. Cancellation acknowledgement describes a request. It does not establish remote provider termination.

## Local checks

Run the affected checks with explicit candidate dependencies.

```sh
npm ci
npm run check
BIRBFORGE_TEST_BN=/application/bn node_modules/.bin/tsx --tsconfig tsconfig.node.json --test tests/projects.test.ts tests/github.test.ts
npm run export:web
node tests/projects-ui-smoke.mjs
npm run export:native
```

The UI smoke uses simulated API responses in Mac Chrome. Exports verify bundles. Neither proves an installed phone journey. `scripts/project-github-proof.ts` exercises the authorized server connection without remote writes. It requires an explicit private `PROJECT_CHATS_EVIDENCE` directory containing the owner-provisioned token and login files. Its receipt omits credentials and private catalog membership.

Run Beans `make ci` and Crew's full pytest and Ruff checks for their candidates. Run the assembled local journey separately. Physical phone, authorized queued shared staging, chat-local Ready implementation, cancellation of that implementation, independent candidate verification, and cross-device implementation result acceptance remain open until their producers and installation approvals are available.

## GitHub references

GitHub documents [repository metadata and permissions](https://docs.github.com/en/rest/repos/repos) and [Link-header pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api). The adapter uses the maintained [Octokit SDK](https://github.com/octokit/octokit.js). Import/read access does not establish worker eligibility or merge authority.
