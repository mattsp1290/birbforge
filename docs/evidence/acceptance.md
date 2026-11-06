# First UI milestone acceptance

The implementation and executable Linux checks are delivered for review.
The full milestone is NOT VERIFIED. The Mac and iPhone are available to a separate local owner, as confirmed by the
user after the Linux checks. This SSH session has not executed either target. Authentication and permissions still require
human review before merge.

## Journey results

| Required journey | Required-target status | Executed evidence |
| --- | --- | --- |
| Phone to browser | NOT VERIFIED | Two Linux browser clients and two Node AG-UI clients shared a conversation, pending input, and finalized messages. No native phone or Mac browser ran. |
| Inbox to conversation | NOT VERIFIED on required targets | Linux browser B resolved the inbox request with keyboard activation. Browser A's conversation converged to that choice. |
| Racing answers | NOT VERIFIED on required targets | Two clients sent different choices for the actual producer request ID and version. Exactly one succeeded and one received HTTP 409. |
| Connection loss | NOT VERIFIED on required targets | Network-offline simulation and automatic fresh observation restored one input and one decision. Reconnect never submitted a prompt. |
| Unauthorized action | NOT VERIFIED on required targets | Missing/invalid bearer credential returned 401, another principal returned 404, forged client state did not grant action rights, and an actor field returned 400. |
| Accessibility | NOT VERIFIED on required targets | Linux Chromium keyboard activation, application large text, and labelled web controls ran. Native assistive controls, OS font scaling, and Mac keyboard acceptance remain open. |

The observable transitions and identities are recorded in
[browser-checks.json](browser-checks.json) and [runtime-checks.json](runtime-checks.json).
The additional [command fault checks](command-checks.json) and
[transport recovery checks](transport-checks.json) record lost acknowledgements,
failed refreshes, explicit cancellation, interrupted streams, and a failed
reconnect GET. The browser counts input POSTs and fresh observations.
These reports use deterministic producer model fixtures. They are not live-account
validation. No live model call was made by this UI implementation session.

## Target inventory

The host is Linux ARM64. `adb`, `xcrun`, and the NetBird CLI were absent.
No SSH configuration file or configured private destination was available.
The connected tool inventory exposed no browser or native-device controller.
The user authorized a project-scoped Beans handoff to the Mac owner.
Target identity and the existing private device route must be checked there.
Existing cached Chromium was used without installing browsers or OS packages.
The exercised browser returned version 153.0.8010.12 at 1280 by 1000.
No responsive screenshot is claimed as native acceptance.

Native JavaScript exports passed for iOS and Android. The packaged Linux
Hermes compiler was x86-64 and could not run on this ARM64 machine. The documented
export uses `--no-bytecode`. No simulator, native binary, or native stream ran.

## Commands exercised

- `scripts/setup` restored the locked JavaScript dependencies locally.
- `scripts/dependency` extracted the pinned producer revision and ran its setup.
- `python3 scripts/check-dependency.py <isolated-root>` recomputed all 24 producer source hashes without mismatches.
- `scripts/npm exec expo install -- --check` accepted the selected dependency versions.
- `scripts/npm run check` passed strict TypeScript checking.
- `scripts/npm test` exercised the actual disposable runtime through the gateway.
- `scripts/npm run export:native` produced iOS and Android JavaScript bundles.
- `scripts/npm run export:web` produced the React Native Web build.
- `BIRBFORGE_CHROMIUM=<existing-chrome> scripts/verify` ran the reproducible launcher, runtime and browser checks, exports, documentation build, and structural checks.
- `.local/bin/node docs/build.mjs` rebuilt the existing 15-page dark site without tracked changes.
- `python3 docs/check.py` passed links, fragments, IDs, headings, image labels, and offline assets for all 15 pages.

The existing producer checkout was inspected at the pinned revision and left
unchanged. The UI runtime used a new isolated source copy, fresh local Temporal
and PostgreSQL, generated private test credentials, and an explicit disposable
Beans hub. The launcher cleaned up its own services after verification. Private
fixture files and screenshots remain outside the public diff.

## Compatibility and remaining gates

Birbcrew revision `88b219c18adeb352d2f291f099ede990a3190a58` passed the exercised
consumer contract without a producer code change. All 24 pinned source hashes
were recomputed from the revision and checked against the isolated source.
The producer command schemas are published under `tests/fixtures`.
The action fixture forwards actual request IDs and versions. Snapshot-based
reconnect, finalized authoritative messages, four inputs, and explicit separate
cancellation remain the producer contract. There is no workflow replacement,
Continue-As-New, or arbitrary token resume.

The second device enters the displayed conversation UUID. The bounded proof
does not depend on a producer list API. Future conversation discovery requires
an owner-scoped producer contract rather than a second conversation store.
Native runtime compatibility remains unproven until the native transport and
crypto adapter run on an authorized target. No producer incompatibility has been
reproduced in the exercised Linux paths.

Fresh independent Claude review and its disposition are recorded in
[review-resolution.md](../review-resolution.md). The reviewer did not execute
the tests, inspect private account settings, or grant merge approval.
Human authentication and permission review and the missing native/Mac journeys
remain explicit delivery gates. No merge, force-push, deployment, or production
access is authorized by these checks.
