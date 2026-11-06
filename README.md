# Birbforge

A shared native phone and browser interface for a durable goal conversation and
one synthetic input decision. The first implementation consumes an exact pinned
Birbcrew runtime through AG-UI. Native phone and Mac browser acceptance remain
open. This proof grants no PR or merge authority.

- [Run the disposable development proof](docs/development.md).
- [Prepare private phone access](docs/private-phone-access.md).
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
