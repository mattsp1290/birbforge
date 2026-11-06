# Local conversation action contract

Birbforge consumes Birbcrew revision
`88b219c18adeb352d2f291f099ede990a3190a58`.
The producer checkout and its unmerged branch remain unchanged.

## Authority

Birbcrew owns conversation identities, finalized messages, accepted input IDs,
Temporal execution, pending requests, and accepted decisions. Birbforge does not
store a second editable conversation or notes database. Beans remains the
source of authored fixture context. The launcher reuses the producer's fixture
hub setup, with explicit hub selection, no remotes, and scoped note capture.

Generated local bearer credentials identify an owner or stranger. Birbforge
validates the credential on every API call, then forwards that principal's
credential to Birbcrew. Birbcrew enforces conversation ownership and the expected
responder in its durable Update. The client cannot select an actor. This is an
isolated development identity system. Human authentication and permission
review is mandatory before merge.

## HTTP operations

All paths below are under `/api`. All require `Authorization: Bearer <test-token>`.
Credentials are entered interactively and never embedded in the exported bundle.
The gateway binds to IPv4 loopback and serves the exported web app at the same
origin. It rejects foreign Origin headers, unapproved Host headers, unknown
paths, query strings, methods, and invalid command bodies.

| Operation | Body | Producer operation |
| --- | --- | --- |
| POST /conversations | `{ "id": "<uuid>" }` | POST /conversations |
| GET /conversations/{id} | None | GET /conversations/{id} |
| POST /conversations/{id}/inputs | `{ "request_id": "<uuid>", "text": "<goal>" }` | POST /conversations/{id}/inputs |
| POST /conversations/{id}/decision | `{ "request_id": "<actual human request id>", "version": 1, "choice": "inspect" }` | POST /conversations/{id}/human |
| POST /conversations/{id}/events | Official AG-UI RunAgentInput with empty client state, messages, tools, and context | POST /conversations/{id}/events |
| POST /conversations/{id}/cancel | `{}` | POST /conversations/{id}/cancel |

The conversation and inbox render the same pending request and invoke
`ConversationClient.resolve`. They forward the ID and version that were displayed.
The only choices are `inspect` and `test`. These synthetic decisions grant no PR,
merge, production, notification, or dispatch permission.

The server rejects extra decision fields, including `actor`, before forwarding.
Unauthenticated calls return 401. A valid stranger receives 404 for another
owner's conversation. The producer returns 409 for stale versions, conflicting
answers, and closed conversations. Its 503 acknowledgement hint means the caller
must retain the original request identity. Identical accepted decisions are
idempotent. A conflicting choice never silently replaces an accepted decision.

## Observation and convergence

Official `@ag-ui/client` 1.0.4 owns SSE decoding and AG-UI message handling.
The native adapter selects `expo/fetch` and Expo Crypto for streaming and UUIDs.
Its JavaScript export passed. Native execution and runtime compatibility are NOT VERIFIED.
The shared controller observes state snapshots and message changes. GET and
stream state pass through the same consumer schema. GET responses omit native
framework messages and owner fields. The GET projection and shared controller retain note identities and hashes.
The authenticated SSE stream forwards the producer's scoped context, including
fixture note bodies and paths. No context filtering on the SSE wire is claimed.
Neither path creates another editable notes store.

Every attachment fetches fresh authoritative state and creates a new observation
agent. It sends no prompt. It does not use arbitrary token cursors. The producer's
snapshot cursor remains authoritative. Lower-revision snapshots cannot replace
newer state. Errors and foreground activation trigger fresh observation.
Disconnect aborts the upstream HTTP stream without cancelling the workflow.
Cancellation is an explicit action with acknowledgement and a later persisted
terminal state. Provisional streamed text may repeat on activity retry. Finalized
message snapshots replace it.

A pending prompt keeps its original ID and bytes for explicit retry. Reconnect
never calls submit. A server acknowledgement does not optimistically mark a
decision resolved. The next authoritative snapshot updates both views.

## Bounded compatibility

The producer accepts four inputs per conversation. This UI exposes that limit.
It does not request workflow replacement or Continue-As-New. It does not fork
the runtime. The second client enters the displayed conversation UUID. No
conversation-list API or extra discovery database is claimed.

CopilotKit OSS native package 1.84.1 was inspected through registry metadata.
Its stock input and human-response conventions do not match this observation-only
producer endpoint. It also requires presentation dependencies unused by this
single-card interface. This milestone reuses the official AG-UI SDK directly
and native React Native controls. No CopilotKit runtime, Intelligence, or A2UI
is added. See the independent design review disposition.

The executable compatibility fixture is `tests/runtime.test.ts`. It covers real
producer requests, two official observation clients, unchanged prompt retries,
a raced decision, stale versions, unauthorized reads and actions, forged actor
rejection, finalized messages, and reconnect. The browser fixture is
`scripts/browser-check.mjs`. Neither substitutes for native or Mac acceptance.
