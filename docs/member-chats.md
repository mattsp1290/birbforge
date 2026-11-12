# Crew member chats

A crew agent can select an engine. A chat with that agent runs on a durable Crew TypeScript member through the Crew member gateway's [integration API v1](https://github.com/mattsp1290/crew/blob/main/docs/integration-api-v1.md). The supported engines are Codex and Pi. The Chief of Staff and agents without an engine keep the built-in workspace path.

## Configuration

Add `members` to the existing gateway configuration. The paths and profile names below are installation placeholders.

```json
{
  "members": {
    "url": "http://127.0.0.1:8790",
    "token_file": "/private/crew-members-token",
    "profiles": {
      "pi": "pi-go-glm-5.3-flash.v1",
      "codex": "chatgpt-gpt-5.4.v1"
    }
  }
}
```

`url` is the Crew member gateway on IPv4 loopback with an explicit port and no path. `token_file` is an absolute path to the owner bearer token for that gateway. Forge rereads it for each call. The file must be a regular file owned by the gateway user with no group or other permissions. Symbolic links are refused. Configure Crew's `tokenHashes` with the SHA-256 of the same token. Crew conversations belong to the owner that token maps to, so keep that mapping when rotating the token.

`profiles` maps each engine to a profile name registered by the Crew worker. Names use letters, digits, dots, underscores and hyphens, up to 128 characters. At least one engine is required. An engine without a profile is not offered in the Crew screen and new chats cannot use it.

Without a `members` block the feature is off. Chat, crew roster and catalog responses are unchanged for agents without an engine. An agent saved with an engine cannot open a new chat until its engine is configured again. Existing member threads stay readable, and sending in them returns `members_unconfigured`.

The members token stays on the gateway. It is never sent to the app, written to the chat database, logged, or included in an error code.

## Identity mapping

Member thread and turn IDs must be lowercase UUIDs, because Crew compares them in lowercase. Each chat thread is bound to its member when it opens. The binding stores the engine, the profile and the member spawn identity. Changing an agent's engine or a profile mapping affects new chats only. The chat list and the chat header show the engine of each thread.

| Forge | Crew |
| --- | --- |
| UUIDv5 of agent ID, engine and profile | `POST /v1/members` `requestId` |
| Thread ID | `conversationId` |
| Turn ID | `requestId` |
| Stored request text | `text`, compared by exact equality |

The returned member ID is stored and reused by every thread with the same agent, engine and profile.

The first request of a conversation starts with a delimited `<forge-agent-context>` preface. It contains the agent's name, instructions and the read-only project inspection text that workspace chats use. Later requests carry the message text only. Forge stores the exact request text with the turn, so a retry sends identical bytes.

## Delivery and recovery

Sending a message commits the turn row and its outbox row in one SQLite transaction before any network call. The request returns at once with the pending turn. The app refreshes the chat every five seconds until the turn finishes.

A background reconciler in the gateway process advances pending turns. It ensures the member, opens the conversation, looks up the request, and submits it only when Crew reports no such request. A lost acknowledgement, timeout, `401`, `503 retry_same_request` or `409 busy` keeps the turn pending. The next attempt looks the request up again and resubmits the same identity and text if it is still missing. Forge never creates a replacement request ID. Attempts back off from one to fifteen seconds and each call times out after thirty seconds. One reconciler runs per gateway process, and it resumes pending turns after a restart.

Forge requires `apiVersion` major `1` from `GET /v1/capabilities` and from every receipt. It does not submit while the capabilities are unavailable or report another major version.

A turn also stays pending while the token file is missing, unprotected or rejected with `401`, and while Crew reports the profile as `unknown_profile`. A worker can register its profiles after the gateway starts, so that turn proceeds once the profile exists. A `404` when opening the conversation clears the stored member ID, and the next attempt ensures the member again. The app shows these turns as waiting for a reply. The gateway does not yet report why a turn is waiting.

## What the app shows

| Crew status | Chat shows |
| --- | --- |
| `accepted`, `running`, `cancellation_requested` | Waiting for a reply. |
| `waiting` | The agent is waiting for a decision that Forge cannot answer yet. The turn stays pending. |
| `completed` | The reply text from `result.text`. |
| `failed` | Crew could not run this message. |
| `cancelled` | The message was cancelled before it ran. |
| `uncertain` | Crew could not confirm whether the reply finished, and it will not be retried. |
| `400`, or `409` other than `busy` with no request found, from member creation, conversation opening or submission | Crew rejected this message. |

Every outcome except a reply ends the conversation. The app asks the owner to start a new chat. Forge does not replay an ended turn under a new identity.

## Limits

Forge messages are at most 4,000 characters. Crew accepts at most 16 KiB of UTF-8 text per request. If the first message and its preface exceed that, Forge shortens the preface and marks it `[context truncated]`.

Crew reports the conversation turn limit as `rollover.maximumTurns` in its capabilities. When a thread reaches it, Forge does not submit the next message and shows that the chat reached Crew's message limit.

Human-decision cards, cancellation, and streamed AG-UI observation are not part of Forge member chats yet.

## Checks

`tests/members.test.ts` runs the chat service against an in-process fake of the Crew `/v1` API. It covers completion, early completion, lost acknowledgements, timeouts, transient and explicit errors, terminal outcomes, restart recovery, engine changes, the disabled feature, token handling, the turn limit, capability and receipt API versions, and backoff when the database cannot be written.

Run `npm run export:web` first. `npm run check:members` then drives the exported web app against the same fake at desktop and phone widths. Set `BIRBFORGE_SCREENSHOTS` to an absolute directory outside the repository. Set `BIRBFORGE_CHROMIUM` when Playwright's bundled browser is not installed. These checks do not exercise a real Crew gateway or a live provider.
