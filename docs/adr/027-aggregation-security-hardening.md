---
title: "ADR 027: Aggregation Protocol Security Hardening and Threat Model"
---

# ADR 027: Aggregation Protocol Security Hardening and Threat Model

**Status:** Accepted

**Date:** 2026-04-14

**Commit:** [`86e2f2b`](https://github.com/dcdpr/did-btcr2-js/commit/86e2f2b)

## Context

The initial aggregation subsystem ([ADR 020](020-aggregation-layered-architecture.md)) landed as a working multi-party protocol: cohort formation, update collection, aggregation, validation, MuSig2 signing. Getting it to pass happy-path scenarios came first.

The next step was identifying and mitigating the adversarial-scenario classes a real deployment would face: malicious participants, confused service operators, replay attacks, resource-exhaustion by unbounded message sizes, stale cohorts hanging open forever, etc. This ADR captures the named threat classes the hardening commit addressed and the mitigations chosen.

## Threat classes addressed

The regression-test suite at `packages/method/tests/aggregation-security.spec.ts` pins mitigations for each of the following:

### T1: Cohort-membership manipulation

- **T1.1: Duplicate opt-in by the same DID.** A participant opting in twice shouldn't get two slots in the same cohort.
- **T1.2: Re-opt-in from an already-accepted participant.** Once the service accepts a participant at a specific key, a later opt-in from the same DID with a different key must not change the cohort's key material.

**Mitigation:** Service state tracks accepted participants; re-opt-ins are idempotent: the cohort key for that DID remains the originally accepted one.

### T2: Message-content abuse

- **T2.1: Oversized updates.** A participant submits a `SUBMIT_UPDATE` with arbitrarily large payload, forcing the service to canonicalize, hash, and aggregate a megabyte-scale object. DoS.

**Mitigation:** `maxUpdateSizeBytes` enforced in `AggregationService.#handleSubmitUpdate` before any expensive processing. Oversized updates are dropped with a diagnostic.

### T3: Wire-protocol version skew

- **T3.1: Missing or mismatched wire version in service-inbound messages.**
- **T3.2: Missing or mismatched wire version in participant-inbound messages.**

**Mitigation:** `AGGREGATION_WIRE_VERSION = 1` is checked on every message at ingestion. Mismatched messages are rejected, not silently processed as a possibly-incompatible shape.

### T4: Cohort-lifecycle failure modes

- **T4.1: Cohort never reaches quorum.** Participants opt in but the service never receives enough updates to proceed. Without a timeout, the cohort hangs forever and the service leaks memory.
- **T4.2: Validation rejection from a participant.** If any participant rejects the aggregated data during validation, the cohort must transition to `Failed` cleanly, not partially complete.

**Mitigation:** Cohort TTL causes timed cohorts to transition to `Failed` and emit `cohort-failed` on the runner. A single `validation-ack` with `approved: false` transitions the phase to `Failed` on both sides.

### T5: MuSig2 signing-session hygiene

- **T5.1: Secret-nonce leak after partial signature generation.** MuSig2 secret nonces must be zeroed after their single use; leaking them enables key extraction.
- **T5.2: Corrupted partial signatures.** A malicious participant submits a syntactically valid but cryptographically invalid partial signature.
- **T5.3: Duplicate or out-of-order nonce contributions.** Signing-session state must reject nonce contributions received outside the expected phase.
- **T5.4: Duplicate partial signatures.** Same.

**Mitigation:**
- `BeaconSigningSession.generatePartialSignature()` clears the stored secret nonce immediately after signing.
- `generateFinalSignature()` validates every partial signature against the expected per-key aggregation before combining; the first bad partial throws `BAD_PARTIAL_SIG`.
- `addNonceContribution()` and `addPartialSignature()` are phase-gated; out-of-phase calls throw.

## Decision

Adopt the mitigations above. Encode each as a regression test in `aggregation-security.spec.ts`. The test suite is the durable contract: if any mitigation regresses, a named test fails with the associated threat label.

Runner-side behavior: on every rejection, emit a diagnostic event (`error`, `cohort-failed`) with enough context to debug.

## Consequences

**Positive**
- The threat model is concrete and testable. A future contributor changing a mitigation immediately sees which threat class is affected by the failing test name.
- Resource-exhaustion attacks (T2.1, T4.1) have bounded cost: oversized updates are dropped before expensive work; cohorts reap.
- MuSig2 hygiene issues (T5.1 – T5.4) that would silently corrupt signatures instead fail loudly at the exact point of violation.

**Negative**
- Tight validation can reject messages from buggy-but-benign implementations. Documented in the error diagnostics so operators can triage.
- The `maxUpdateSizeBytes` cap is a protocol parameter that interoperability-conscious implementations must agree on. Currently embedded in the service; a future protocol version may surface it.

**Explicitly not covered here**
- Transport-layer attacks (replay, spoofing, eavesdropping) are the transport's responsibility. Nostr handles them via NIP-44 / event signing; HTTP transport handles them via signed envelopes and nonce-replay cache ([ADR 029](029-tls-only-confidentiality.md)).
- Bitcoin-level attacks (front-running beacon funding, double-spend of the funding UTXO) are out of scope for this ADR and handled at the beacon broadcast layer.
- Malicious-service-operator scenarios where the operator refuses to relay are accepted as a liveness (not safety) risk; detection is at the protocol level by participants noticing their update never appears on-chain.

## References

- [`packages/method/tests/aggregation-security.spec.ts`](../../packages/method/tests/aggregation-security.spec.ts): durable regression contract.
- [`packages/method/src/core/aggregation/service.ts`](../../packages/method/src/core/aggregation/service.ts): most mitigations live here.
- [`packages/method/src/core/aggregation/signing-session.ts`](../../packages/method/src/core/aggregation/signing-session.ts): MuSig2 hygiene.
- [ADR 020](020-aggregation-layered-architecture.md): the layered architecture being hardened.
- [ADR 029](029-tls-only-confidentiality.md): transport-layer replay / spoof defenses (HTTP).
