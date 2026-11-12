# Reach the disposable runtime through the existing private HTTPS proxy

The adapter reuses the owner's private HTTPS infrastructure and an authorized
SSH connection. Both application listeners stay on Linux loopback. It does not
deploy into k3s, create a TLS service, enroll a peer, or change account, DNS,
VPN, firewall, or device trust settings. The local owner exercised the private route and native/Mac functional journeys
at 5d333cda03a6b385b669f6025b248d4ba4272071. See [acceptance](evidence/acceptance.md)
for exact limits and deferred native accessibility.

## Reported owner-use boundary

Return handoff `birbforge-h-5mbs` reports an active private HTTPS service and a
native/Mac run, with an explicit owner decision to trust enrolled NetBird peers
and decline proxy-only bridge-port isolation/firewall changes for this setup.
That records an owner-use exception for friendly enrolled peers, not approval
of untrusted LAN or other-overlay reachability. Source/interface and direct-port
denial remain unverified. If such a caller reaches the bridge, it can spoof Host
and bearer authentication is its only per-person action gate. Acceptance of that
residual risk is unconfirmed and must be resolved in human authentication and
permission review before merge. Do not describe the bridge as proxy-only.

HTTPS, app bearer authentication, exact private interface-address binding and
private service access remain required. The SSH forward hides the original
caller, and a reachable caller can spoof Host. Bearer authorization is the action
gate. The earlier independent source review did not endorse this later trust
decision. Human authentication/permission review remains required before merge.
A public, untrusted-peer or production audience needs a new boundary review.

Any new or re-created bridge, including under owner use, must pass the LAN and
other non-NetBird ingress checks in step 7 or wait for explicit human
permissions review of that residual risk before owner tokens are sent. Only
segregation among friendly enrolled peers is waived. This documentation does
not stop or reconfigure the already retained session.

The stronger profile below remains documented for that future scope. Do not
apply declined firewall changes to the retained owner-use setup or relabel its
unperformed checks VERIFIED. Native OS Large Text and VoiceOver are separately
DEFERRED / NOT VERIFIED by the reported owner decision. Mac keyboard checks passed.

## One authenticated handler and a narrow transport boundary

The default listener keeps its existing loopback HTTP authority. The optional
proxy backend requires one exact external HTTPS Host and, when present, Origin.
Missing Origin is allowed for native clients. It accepts only socket source
127.0.0.1 and closes other sources before serving HTTP. Forwarded headers cannot
select a host, scheme, actor, or trusted source. The shared handler also checks
the source on every proxy request.

Bearer validation and per-conversation ownership remain mandatory at Forge
and Crew. A loopback connection is not a person or device identity. Local
processes and the authorized SSH endpoint remain in the same host trust boundary
as the original gateway. No IP or forwarded header grants conversation rights.
The action ID/version, durable decision, reconnect, and cancellation contracts
are unchanged.

The selected external service terminates normally validated TLS and enforces
NetBird peer access. It must preserve Host and path, forward Authorization,
and stream responses without buffering. Its target can be a specific port on
an existing NetBird-enrolled verification peer. An existing authorized SSH local
forward on that peer carries the request to Linux loopback. Under the stricter isolation profile, the route is acceptable only after the proxy connection is observed arriving
on the peer's NetBird interface from the actual proxy source, and direct access
to the bridge port is denied. Under those checked conditions the first hop uses
NetBird encryption and the final hop uses SSH encryption. Until then, encryption
and access isolation are activation preconditions, not established results.

The origin session observed a Tailscale CGNAT candidate but no established
NetBird interface in its process namespace. CGNAT alone does not prove NetBird
reachability. This adapter has no direct CGNAT, LAN, wildcard, or public bind
setting. It cannot silently select that interface.

## Configure the optional backend privately

Create an owner-only mode-0600 JSON file outside the checkout or under ignored
`.local`. Only these two fields are accepted. Keep the actual hostname and file
outside Git. No credential belongs in the listener configuration.

| Field | Value |
| --- | --- |
| port | One nonprivileged backend port from 1024 through 65535, different from the default loopback port. |
| origin | The canonical external `https://<application-host>` origin with any required external port. No trailing slash, userinfo, path, query, or fragment. |

Relative paths, symlink files, group/world-readable files, and files in tracked
source locations fail startup. Configurable bind addresses, source lists, and
forwarded-header trust are deliberately unsupported. The file is opened once,
and its ownership and mode are checked through that descriptor.

```sh
BIRBFORGE_PROXY_CONFIG=/absolute/private/proxy.json scripts/dev
```

For the durable verification queue in the existing Linux guest, use the
[guest invocation](host-execution.md#optional-existing-private-https-route).
It sets the variable inside the guest boundary and records `proxy_origin` in
`.local/verification-session.json`. The same strict proxy configuration and
listener policies apply.


The launcher retains its default loopback URL for the Mac browser SSH path.
The configured external origin appears only in ignored `.local/session.json`.
A unique private readiness file is published atomically after both listeners
bind. Startup failure closes owned listeners. SIGTERM closes both listeners and
their observation sockets without sending a workflow cancellation command.

The backend port speaks HTTP only on Linux loopback. Phone and browser use the
external HTTPS URL, never a raw HTTP NetBird URL. Do not copy the proxy's TLS key,
disable certificate verification, or add an ATS bypass. A test CA is never
installed in device or OS trust.

## Prepare the exact private route

Birbhomes origin/main was inspected at
`8b9b636155fbd6f5a793e86db36ecf40cad689ca` after a fast-forward-only pull preserved
its clean feature checkout. Its existing private service pattern preserves Host
and path and supports a 600-second request timeout. That is source evidence,
not proof of a live route, certificate, or valid management credential.

For a new activation or expanded audience, the local infrastructure owner
prepares this scoped proposal in a private Beans handoff. Steps 6 and 7 are the
stricter isolation profile. The reported owner-use decision waives proxy-only
segregation among friendly enrolled peers, while LAN/other-ingress protection and
risk acceptance remain unverified. It does not authorize future unsafe activation.

1. Select a distinct application subdomain. Preserve the dashboard apex,
   management/proxy names, root wildcard, mail settings, and unrelated apps.
2. Discover the installed proxy release, Private capability, matching validated
   domain, intended peer group, target contract, and current route ownership.
   Reuse suitable existing resources rather than duplicating them.
3. Select an existing NetBird-enrolled verification peer that already has an
   authorized SSH connection to the runtime host. The Mac return handoff proves
   its SSH path; the local owner must identify its actual NetBird interface.
4. Bind one SSH local forward to that peer's exact NetBird address and a scoped
   nonprivileged port. Forward to the Linux proxy backend on 127.0.0.1. Do not
   bind all interfaces or a LAN address, or change SSH server settings.
5. Configure the existing private HTTPS service for that exact peer/port under
   the installed API contract. Require private peer access, explicit intended
   groups, preserved Host/path, and streamed responses. Prefer an existing narrow
   personal-device group. Leave the global Default mesh policy disabled.
6. Separately restrict reachability of the peer's bridge port to the proxy's
   NetBird source and that exact port. HTTPS service access groups do not prove
   backend port isolation. Check every broader existing NetBird policy that could
   also allow the port. The actual proxy connection must arrive on the peer's
   NetBird interface. A private destination address alone is insufficient on a
   host that accepts packets arriving through another interface.
7. From a different NetBird peer and from an authorized LAN probe host, require
   direct TCP access to the peer's bridge address/port to fail. Test the actual
   private destination through the LAN ingress path; failure to reach the peer's
   LAN IP is not equivalent. Include every other non-NetBird ingress, such as
   another overlay, if present. A 403 Host response is not reachability denial,
   since a caller can spoof Host. Use no owner credential for these probes.
   For any new or re-created bridge, LAN/other-ingress denial or explicit human
   risk review is required before tokens, including under owner use. For the
   additional proxy-only peer restriction in the stricter profile, if controls cannot
   establish this, do not activate or send tokens. The already retained owner-use
   session is reported evidence, not a new authorization; unresolved LAN/other
   ingress must go to human review rather than being silently accepted.
   Return a scoped source/interface firewall proposal for explicit approval, or
   a different existing protected target. Do not add firewall or route settings
   silently, and do not fall back to bearer-only exposure of this bridge.
8. Prepare only the exact application DNS change if necessary. A CNAME alone
   does not register a private HTTPS service. Follow Birbhomes' fresh snapshot,
   concurrency, full-field preservation, and scoped rollback procedure.
9. Verify the valid certificate chain and hostname at the external service.
   Do not export keys. Confirm enrolled-client access and public/non-enrolled
   denial without changing unrelated services.

Keep addresses, destinations, resource/group IDs, administrative credentials,
and actual endpoint configuration private. No management API or DNS mutation is
performed by the adapter. Do not run a bootstrap DNS helper unchanged, widen a
network resource CIDR, deploy a k3s app, or restart shared infrastructure.

## Start the existing peer's encrypted bridge

After the service-scoped activation and applicable trust profile are authorized,
the local owner can use this
pattern on the enrolled peer. Variables come from the reviewed private proposal.
The SSH alias must already be authorized, and the private bind must belong to
that peer's NetBird interface. Use a port different from the Mac browser's
existing loopback forward.

```sh
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "$BIRBFORGE_PEER_NETBIRD_IP:$BIRBFORGE_PEER_PORT:127.0.0.1:$BIRBFORGE_BACKEND_PORT" \
  "$BIRBFORGE_RUNTIME_SSH_ALIAS"
```

Keep the terminal, peer, and runtime awake during the disposable verification.
This is an owned development bridge, not a daemon or production route. Stopping
it should end phone observation while leaving the workflow and pending decision
intact. Restoring it must allow a fresh snapshot without another input POST.
Neither the existing loopback Mac forward nor this documented command alone
proves the external private service can reach the target. Test the complete path. Apply the separate bridge-port isolation checks above
when the stricter profile is required. The reported peer-only exception does
not establish protection from, or acceptance of, LAN/other-overlay callers.
The SSH forward hides the original TCP source from Forge. Consequently the
application cannot distinguish the real proxy from a direct caller reaching
that forward. Any claim of proxy-only port isolation must be proved at the peer/network
boundary. It is not claimed for the reported trusted-peer setup. Local
processes on the owned peer remain within its existing trusted host boundary.

## Verify before native acceptance

Use normal private DNS and normal certificate trust on the enrolled Mac and
phone. Forced IP resolution is diagnostic only. Record target/build identities,
revision, dependency versions, timestamps, and sanitized transitions. Keep
credentials and authenticated raw traces outside Git and Beans.

Check 401 for invalid bearer, 404 for a stranger, rejection of foreign Host and
Origin, and ignored spoofed forwarded headers. Confirm progressive AG-UI events
through the actual service and that disconnect closes observation without
cancelling the durable wait. Then reconnect and require unchanged request identity,
exactly one accepted decision, and no additional POST /inputs.

Run all six journeys in [Mac and iPhone verification](mac-iphone-verification.md).
The exercised Mac path is loopback SSH. Its request to the same private HTTPS
origin returned 421, so that origin is not a verified Mac alternative.
Use the existing native Release build procedure and approved signing prerequisites.
Inspect native certificate and ATS errors instead of disabling checks.

The disposable automated TLS proxy fixture uses a CA trusted only by its Node
client. It forwards to the real pinned producer. Tests cover rejected chain and
hostname, exact Host/Origin, actual socket rejection, authorization, one winning
raced decision, streamed authoritative state, and reconnect. It does not establish
live NetBird policy, proxy flushing, timeout behavior, or native compatibility.
The private backend uses a two-minute keep-alive timeout and a longer header
timeout; a service's 600-second stream limit can still trigger normal snapshot
recovery. Human authentication and permission review remains required before merge.
