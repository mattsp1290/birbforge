# Bounded implementation workflow

The done predicate is all six first-milestone journeys exercised on a native
phone target and a Mac browser, with authoritative state convergence, a reviewed
authenticated action, reproducible disposable setup, and a pushed review branch.
Missing target evidence keeps that predicate false.

The work needs high rigor at the authentication and request-identity boundaries.
It adds one shared Expo interface, one forwarding gateway, compatibility tests,
and a disposable development launcher. It preserves the existing docs site.

## Playbook checklist

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop. Independent implementation and executable Linux checks passed. Required native/Mac journeys remain open.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back. Linux checks and review delivered. The native/Mac done predicate remains NOT VERIFIED.

## Executable units

1. Validate pinned Expo, React Native Web, and official AG-UI SDK bundles before expanding presentation.
2. Exercise authenticated forwarding against an isolated pinned Birbcrew runtime.
3. Implement one shared snapshot controller and native controls for conversation and inbox.
4. Exercise races, reconnect, isolation, and web keyboard controls against real local services.
5. Run native and Mac journeys when authorized targets are available.
6. Obtain fresh Claude CLI review, fix material findings, scan the public diff, and push a review branch.

## Throughput checkpoint

The main risk is target access and native SSE behavior, followed by convergence
after ambiguous command acknowledgements. Verify bundles and runtime contract
first. Avoid a second editable store or a second UI controller. Independent
Claude review uses the explicit Codex host mapping. Cursor-only control, Task,
and deslop tools are unavailable. The substitute is executable local checks and
fresh read-only Claude review. No global model settings change.


## Principles that changed implementation choices

Model the Domain kept conversation and inbox on one typed snapshot controller.
Boundary Discipline concentrated credential and command validation in the gateway.
Type System Discipline put unknown response parsing at the consumer boundary and
reused official AG-UI schemas. Prove It Works kept native and Mac gates open
despite successful JavaScript exports and Linux browser transitions.
