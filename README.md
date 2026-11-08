# Birbforge

A shared native phone and browser interface for a durable goal conversation and
one synthetic input decision, plus a synthetic durable verification queue.
The first implementation consumes an exact pinned
Birbcrew runtime through AG-UI. Functional native iPhone and Mac journeys,
including the later queue controls, now have revision-bound fixture evidence.
The [native queue record](docs/durable-verification-queue.md#physical-iphone-acceptance)
distinguishes historical checks, fresh device checks and the cancellation
qualification. Native OS accessibility remains deferred; staging and human
merge review remain separate gates. This proof grants no PR or merge authority.

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

[Contextless closure integration](docs/contextless-closure-integration.md) documents the fresh v2 queue profile, supervisor commands and isolated proof.
