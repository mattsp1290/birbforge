# Private phone access status

The implementation provides an exact-authority loopback backend for an existing
private HTTPS service. It does not activate that service or establish device
acceptance. The user-selected infrastructure and existing Mac SSH access provide
a candidate route. The entire route and its bridge isolation still require
observed local checks.

| Gate | Status and evidence |
| --- | --- |
| Default loopback behavior | Passed existing real-runtime and Linux browser checks. |
| Canonical HTTPS authority and optional Origin | Passed validating TLS proxy fixture against the pinned producer. |
| Socket source and spoofed forwarded headers | Passed connection-level and per-request real-socket rejection checks. |
| Authenticated action and authoritative SSE | Passed 401/404 rejection, stale version, one winning raced decision, and an official observer receiving final state. |
| Private config and startup | Passed owner-only config, unsupported options, symlink rejection and both-listener startup checks. |
| Public scan | Reproducible script checks fixture credentials and a synthetic PKCS8 marker from scripts/verify. |
| Actual private proxy, normal DNS and phone certificate trust | NOT VERIFIED. |
| Bridge ingress, other-peer denial and LAN denial | NOT VERIFIED. Required before the bridge receives owner credentials. |
| Mac browser and native iPhone at the new revision | NOT VERIFIED. Prior Mac-only results are bound to 9fa6bc419e7eb0ee7602246d26b85509074ca109 and cannot verify this new route. |
| All six complete device journeys | NOT VERIFIED. |
| Human authentication and permission review before merge | NOT VERIFIED. |

Run `BIRBFORGE_CHROMIUM=<existing-browser> scripts/verify` after repository setup.
The command performs TypeScript checking, native JavaScript and web exports,
six tests, Linux browser transitions, all 15 existing documentation checks, the
public credential/key-marker scan, and source hashing. It uses disposable
Temporal, PostgreSQL, fixture credentials and an explicit fixture Beans hub.
It makes no live model call and never reads the private Beans hub.

[Private access procedure](../private-phone-access.md) defines the actual route
preconditions. [Fixture evidence](private-access-checks.json) describes a test
proxy, not a live NetBird endpoint. The implementation owner ran the checks;
independent Claude reviews inspected source and evidence without executing them.
No application TLS key, new OS package, global setting, infrastructure write,
merge, force-push, or production access was part of this implementation.
