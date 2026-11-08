# Birbforge

A shared native phone and browser interface for a durable goal conversation and
one synthetic input decision, plus a synthetic durable verification queue.
The first implementation consumes an exact pinned
Birbcrew runtime through AG-UI. Functional native iPhone and Mac journeys were exercised at the pinned tested
revision. Those results do not verify the later queue controls. Local queue execution and independent source review passed. Physical
iPhone execution for these changes remains pending. Native OS
accessibility is deferred and human merge review remains open. This proof
grants no PR or merge authority.

- [Read the durable verification queue contract and evidence status](docs/durable-verification-queue.md).
- [Run the disposable development proof](docs/development.md).
- [Run through an existing Linux guest on Mac](docs/host-execution.md).
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
