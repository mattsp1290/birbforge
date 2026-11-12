# Open Forge through a trusted private network

A single-owner deployment can let every client on its private route use the configured owner account without entering an application credential. Enable this only when the private network is the intended access boundary and its peers are trusted. This is an explicit deployment choice, not automatic detection of NetBird membership.

Add the authentication setting to the private proxy configuration file outside Git. Keep that file owner-only.

```json
{
  "port": 8788,
  "origin": "https://factory.example.invalid",
  "authentication": {"kind": "private-single-owner", "principal": "owner"}
}
```

The principal must already exist in the gateway's private `tokens` configuration. Startup fails if it does not. Crew continues to require its internal bearer credential. The gateway forwards that credential server-side; clients receive only the access kind from `GET /api/access`. A client-supplied bearer cannot select another identity on this listener.

The private listener retains its loopback socket-source check, exact Host check and same-origin check for requests with an Origin header. Native clients may omit Origin. Keep the public-facing route private and forward it to this listener through the existing proxy. Do not expose the listener through an unrestricted public route.

The app discovers the access mode for its current endpoint. In private mode it automatically shows up to five conversations in the producer's recent order. Tap a conversation to open it. New conversation and manual identity entry remain available. Reconnect observes existing state and does not approve, cancel or resubmit a goal. **Back to conversations** disconnects observers; it does not revoke private-network access.

Native builds can set `EXPO_PUBLIC_BIRBFORGE_ENDPOINT` to a public endpoint URL at build time so the owner does not need to enter it. This setting contains no credential and does not enable single-owner access itself. Browser builds use their current origin. Endpoint changes clear discovered access and conversation results; failed discovery cannot enable commands.

Omit `authentication`, or set `{"kind":"bearer"}`, to retain credential entry on the private listener. The ordinary loopback listener always retains bearer authentication. Existing proof deployments therefore keep their owner/stranger behavior.

Changing this listener policy does not change conversation ownership, the approved goal, its revision, the durable delivery workflow or approval requirements. Runtime device verification and private-route checks remain deployment evidence; local HTTP tests and exported bundles do not establish physical iPhone acceptance.
