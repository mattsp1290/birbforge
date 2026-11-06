# Private phone access status

The local verification owner reports an active private HTTPS route and real
native/Mac journeys at `5d333cda03a6b385b669f6025b248d4ba4272071` in handoff
`birbforge-h-5mbs`. [Acceptance](acceptance.md) and the [redacted results](native-acceptance.json)
retain its limits. This Linux session verified package/source hashes and reconciled
prose; it did not activate or rerun the device route.

| Gate | Status and scope |
| --- | --- |
| Loopback backend, authority, source and bearer checks | Passed existing six-test Linux verification. Both app listeners remain loopback-only. |
| Private HTTPS to native app | VERIFIED by local native authentication, streamed decisions and reported normal certificate trust. |
| Mac browser route | VERIFIED through its loopback SSH path. Same-origin private HTTPS from the target peer returned 421 and is not claimed as passed. |
| Public-path denial | Reported diagnostic 403. This does not establish direct bridge-port isolation. |
| Proxy-only peer isolation | NOT VERIFIED; declined for friendly enrolled peers in the reported owner-use setup. No firewall changes were made. |
| LAN/other-ingress denial and residual-risk acceptance | NOT VERIFIED; the friendly-peer decision does not establish acceptance for these callers. Resolve in human authentication/permission review before merge. |
| Functional device journeys | Five functional journeys verified with race/API and recovery-count limits in acceptance.md. |
| Native OS Large Text and VoiceOver | DEFERRED / NOT VERIFIED by reported owner decision. Mac keyboard checks passed. |
| Human authentication and permission review | NOT VERIFIED; required before merge. |

The chosen private service targets an exact enrolled-peer interface-address port,
then uses an existing encrypted SSH bridge into runtime loopback. It is temporary
and depends on the owned peer and SSH session staying available. Configuration,
service identifiers, endpoint, private state and screenshots remain outside Git.
The retained runtime and bridge were left running by the local owner; no lifecycle
change is made by this documentation reconciliation.

The owner's trust decision is not new independent reviewer endorsement. A direct
caller reaching the bridge can supply the canonical Host, so source collapse
through SSH does not identify the proxy. Application bearer authentication remains
the action gate. LAN/other-overlay reachability could leave bearer authorization
as its only per-person action gate; that residual risk is not confirmed accepted.
Untrusted-peer, public or production use needs a new review.

The [procedure](../private-phone-access.md) distinguishes this reported owner-use
boundary from the earlier stricter isolation profile. The TLS fixture remains a
fixture; it is not the source of the native acceptance claim. The [receipt](native-evidence-receipt.json)
records 13 matching evidence hashes and 30 matching pinned Git source hashes.
No source/evidence hashes were regenerated to rebind native results to a new commit.
