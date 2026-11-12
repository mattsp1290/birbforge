# What we take from pstack

Research and design interpretation, November 5, 2026. This page separates
published working practices from our proposed factory implementation.

## Lauren Tan's contribution

Lauren Tan publishes pstack as poteto. Its README emphasizes engineering quality,
less code, verification and parallel work built on agents whose work can be
trusted. The reusable artifact is a set of skills, principles and playbooks.
It is not an installed durable factory service.
[pstack repository](https://github.com/cursor/plugins/tree/main/pstack)

Our goal is to reproduce those working disciplines with the tools we have.
We are not claiming to reproduce Lauren's private infrastructure or measured
throughput. The linked profile is secondary reporting, not an architecture
specification. Reported PR volume does not establish correctness or a capacity
target for Forge.
[Original profile link](https://x.com/mvanhorn/status/2111481455906103390)

## Practices translated into the factory

| Practice | Forge consequence |
| --- | --- |
| Prove the result by using it | Verify retains deployed user-journey evidence tied to the candidate |
| Give each PR an accountable owner | Ownership continues through feedback, merge, deployment and health observation |
| Review independently | A separate reviewer evaluates the exact revision; the author cannot approve itself |
| Keep scope and progress reviewable | Beans stores authored work; accepted scope and approval records remain explicit |
| Prefer smaller code ownership | Reuse Temporal, existing agent runtimes, protocol SDKs and repository test tools |
| Turn recurring lessons into structure | Improve a check, type or policy when evidence shows a recurring failure |

These are our design applications of the published practices. Specific workflow
procedures remain in the installed skill and repository policies.
[Poteto mode](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/SKILL.md)

The published full-autopilot playbook carries work through merge. The stacked
variant prepares a reviewed stack for an operator to land. Forge's agreed
target permits owner-agent merges after independent and required human approval.
Our current implementation sessions do not inherit unrestricted deployment
authority from a playbook name.
[Full autopilot](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/autopilot-full.md),
[stacked autopilot](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/autopilot-stack.md)

## The broader software-factory idea

Ben Holmes's published framework includes shared configuration, conversation
history, evaluation, conversational access, artifacts, computer-use verification
and an action timeline. This is a useful coverage check for our design. Our
mapping uses repository policies, Crew history, repeatable acceptance,
Forge conversation, Verify evidence and Datadog correlation. Model
benchmarking remains a later capability rather than a prerequisite to the first
runtime proof.
[Ben Holmes's article](https://www.warp.dev/blog/7-ways-to-build-a-software-factory),
[original post](https://x.com/bholmesdev/status/2115862731610107965?s=46)

StrongDM describes a loop of an initial specification, end-to-end validation and
feedback until holdout scenarios pass. The useful lesson here is to define the
observable outcome before an author optimizes its implementation. Our staging
plan cannot be silently weakened by candidate changes to tests. We retain the
human review gates and subscription constraints agreed for this installation.
[StrongDM principles](https://factory.strongdm.ai/principles)

## Harness portability

The installed poteto-mode skill contains Cursor-specific tools and model names.
The chosen implementation host is Codex with Claude CLI for fresh independent
review. The [launch guide](start-repository-owner.md) records that adaptation.
No global model configuration or upstream skill was changed during planning.

## What the research does not prove

Documentation establishes candidate integrations. It does not prove account
entitlement, unattended cloud dispatch, phone reconnect, native Mac isolation,
safe rollback or current staging health. Each has a named implementation gate.
The first milestone resolves the durable-conversation dependency before we
expand the factory.
