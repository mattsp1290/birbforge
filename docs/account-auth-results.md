# Account/auth result contract groundwork

For the deployment profile and its authenticated denial export, see [Recover a deployment result and read its promotion status](deployment-result-status.md).

Forge must distinguish an application pass from the release of a target. A completed activity or safe closure does not establish an application pass.

This change defines a provisional consumer contract and fixture checks for `birbforge-vsrd`. Production queue projections remain delivery-ineligible. No result submission command, verifier worker, publisher, scheduler, or deployment is added. Final integration depends on the reviewed deployment-compatible contract from `birbverify-bsmn`.

## Evidence and trust

An application result must identify the exact request, candidate revision, authored-work revision and Beans issue. It also binds the approved plan, policy, producer revision, installation, physical target, approved image, running image, workload incarnation, verifier implementation and assertion suite.

A content digest detects changes. It does not authenticate the author. A caller can invent a result and recompute its digest. The production integration must obtain results from a reviewed Verify activity over authenticated Temporal access restricted to authorized workers. Admission authority does not confer verifier authority. A task-queue name or verifier label alone does not establish identity.

Verify owns the assertion execution and target journal. Its operation must persist one immutable result for the request before replying. An ambiguous reply must recover that result or remain unknown. It must not rerun mutating account assertions automatically. Forge owns admission, FIFO state and eligibility evaluation. Beans owns the authored work. Birbhomes owns publication and promotion.

The proposed assertion suite requires successful account creation, login and session identity, plus rejection of an invalid password and an unauthenticated identity request. Startup, readiness and successful transport cannot substitute for those assertions. Results contain bounded outcomes and digests, not passwords, session tokens, account names or raw HTTP bodies.

## Outcome and closure

The application result and lifecycle receipt remain separate records. A passing result cannot release the FIFO owner. Only validated producer closure can release ownership. Unknown or quarantined closure retains the owner and blocks its successor.

Eligibility requires all approved assertions to pass for the admitted identities, a fresh result and safe completed closure of the same workload. Failure, missing evidence, unknown outcomes, cancellation, identity mismatch, replay across requests and stale results deny eligibility. Repeated evaluation of the same evidence must return the same evidence identity. Expiry changes whether that historical evidence may be used, without rewriting its contents.

The current subject is deliberately bounded to the existing bare-Pod contract. A Pod UID cannot represent a Helm release, controller reconciliation, hooks and multiple application images. The deployment-compatible subject and closure mapping must be reconciled with `birbverify-bsmn` before production use. The existing fixture image is a Python runtime image, not proof that an application artifact was built from the candidate source.

## Existing Birbhomes consumer

The existing shared promoter is `scripts/gitops/promote.py` in Birbhomes. The inspected revision is `c5c88007f875065c9bdd73b8eef0585f92f06b22`. It checks publication, trusted events and source freshness, but it does not consume this verification contract yet.

Its required integration must perform these checks before its existing promotion side effect.

1. Retrieve the result and closure through an authenticated Forge channel. Reject arbitrary JSON supplied by an untrusted workflow.
2. Require the supported version, bounded schema, canonical digests and independently approved verifier and assertion suite.
3. Compare the complete verification subject with the promotion intent and current installation. This includes source, authored-work revision, plan, policy, target, registry artifacts and observed runtime identities.
4. Require an application pass and matching completed safe closure. Reject missing, unknown, cancelled, quarantined, stale or mismatched evidence.
5. Check expiry and current source freshness immediately before promotion. Preserve the promoter's existing source and policy rechecks around its Git update.
6. Deduplicate the stable evidence identity durably with the existing promotion record. Repeated retrieval must not mint a second promotion grant.

The shared promoter must retain its existing publisher and desired-state ownership. This contract does not authorize a second deployment path.

## Candidate updates and restart

The installed queue pins one candidate and compares its complete configuration with durable history. This remains unchanged. A new candidate, image, policy or verifier installation cannot silently repin old requests. A second workflow for the same physical namespace is not a supported transition.

A future transition must prove the previous ownership has settled, preserve historical evidence, and install the new authority without two concurrent owners. Until that transition is reviewed, a changed installation remains blocked.

The eventual production integration must persist the verification operation identity, result and eligibility evidence through worker restart and Continue-As-New. It must prove one dispatch and one stable evidence identity across restart. The consumer fixtures in this change do not establish producer journaling, durable workflow integration or real application acceptance.

## Remaining qualification

The complete issue requires the following evidence before promotion can be enabled.

- A reviewed producer contract and assertion implementation, with exact clean producer and consumer commits.
- Approved Helm, Flux, controller and admission identities, workload inventory, and image transition rules.
- Passing and negative application journeys against those workloads, including cancellation, worker loss, result-reply loss, coordinator restart and unknown closure.
- Complete sanitized result and closure receipts, with source, registry and running-image bindings.
- Packaged runtime requirements and authenticated worker/exporter access controls.
- Independent review of the integrated producer, queue and existing promoter validation.

No shared-staging deployment is part of `birbforge-vsrd`. The current producer pin and worker package remain unchanged. The existing runtime requirements are documented in [Durable Kubernetes target queue](kubernetes-queue.md).

## Consumer model reference

`verification.kubernetes_results` defines the provisional model. Its schema files are under `server/contracts/birbforge.account-auth.provisional.v1`. They describe data, not an authenticated endpoint.

`VerificationProfile` pins the verifier identity and revision, reviewer identity, suite digest and maximum result age. These fields are trusted installation inputs. Their presence is not proof of review or worker authentication.

`accept_application_result` compares a bounded result with the expected `VerificationBinding` and profile. It rejects mismatches, incomplete assertion sets and invalid times. It returns a recorded result for passed, failed or unknown assertions. Acceptance of the record does not mean application success.

`ApplicationState` distinguishes pending, verifying, recorded and unavailable evidence. Its JSON roundtrip is covered by fixture tests. It is not connected to the durable production queue in this change.

`promotion_evidence` evaluates a recorded result and the complete producer closure observation. It reuses the existing closure validator. It returns an immutable `PromotionEvidence` only when every required assertion passes and the evidence is fresh, uncancelled and bound to a matching completed release. Otherwise it returns no evidence.

The evidence ID is the canonical digest of the normalized exported envelope with `evidence_id` omitted. The digest includes its schema version. The result digest covers the normalized application result. The closure digest covers the normalized complete closure receipt, including its producer receipt digest. Consumers must use the same canonical serialization as the pinned producer's `digest` function.

Fixture tests recompute the evidence ID after JSON serialization. They also mutate and rehash every subject field, reject negative assertions and stale results, reject unsafe closure, and confirm the production projection remains ineligible when fixture evidence is injected.

## Verify the groundwork

Run the contract and existing queue tests with the pinned producer source and its Python environment.

```sh
PYTHONPATH="$PWD:/path/to/pinned-birbverify/src" \
  /path/to/birbverify/.venv/bin/python -m pytest \
  tests/verification_python/test_kubernetes*.py -q
```

An installed Temporal CLI is required for the existing queue integration tests. The reviewed local run passed 87 tests. The 50 result tests use synthetic evidence. They do not prove an authenticated verifier, application execution, deployment compatibility, or promoter integration.
