---
title: "ADR 041: Cooperative Non-Inclusion Signaling for Aggregate Beacons"
---

# ADR 041: Cooperative Non-Inclusion Signaling for Aggregate Beacons

**Status:** Superseded by [ADR 042](042-fault-tolerant-beacon-output.md)

> This ADR's liveness framing rests on treating n-of-n MuSig2 as mandated by the specification. The specification only RECOMMENDS that example, so a fault-tolerant signing scheme is permitted. [ADR 042](042-fault-tolerant-beacon-output.md) adopts a hybrid Taproot output (optimistic MuSig2 key-path, k-of-n script fallback, timelock recovery) that handles liveness directly. The non-inclusion data-commitment design below (a member with no update is absent from the CAS map, or carries a non-inclusion leaf in the SMT) still stands and carries forward under ADR 042, decoupled from liveness.

**Date:** 2026-06-23

**Branch / PR:** `feat/aggregation-non-inclusion`

**References:** [ADR 008](008-aggregation-subsystem-inception.md), [ADR 017](017-optimized-smt-core-primitive.md), [ADR 027](027-aggregation-security-hardening.md), [ADR 036](036-zero-hash-smt-model.md), [ADR 038](038-musig2-key-custody.md), [ADR 039](039-cohort-condition-model.md), [ADR 040](040-multi-cohort-service-runner.md)

## Context

In an aggregate beacon, a cohort of participants jointly sign one Bitcoin transaction whose OP_RETURN commits to the batch of their DID updates (a CAS Announcement Map, or a Sparse Merkle Tree root). Not every member has an update every round: a participant may join a cohort and, when the round comes, have nothing to announce. Today there is no way to express that.

**The cohort cannot proceed until every member submits an update.** `AggregationCohort.hasAllUpdates()` returns `pendingUpdates.size === participants.length` (`cohort.ts:192`), and the service only advances `CollectingUpdates` to `UpdatesCollected` when that is true. Both aggregation builders refuse to run otherwise: `buildCASAnnouncement` and `buildSMTTree` throw `INCOMPLETE_UPDATES` (`cohort.ts:202`, `cohort.ts:223`). A member with no update never enters `pendingUpdates`, so the gate is never satisfied and the round stalls. There is no wire message for "no update this round", no participant phase for it, and a non-submitting member would in any case drop the distributed aggregated data (the participant requires a prior submitted update before it will validate).

**Two very different cases hide behind "a member did not submit an update", and this ADR addresses only the first:**

- **Cooperative non-inclusion (this ADR).** The member is online and has no update this round. It can say so and still take part in signing. This is cleanly solvable: the round proceeds, the transaction broadcasts, and nothing is left in a bad state.
- **A silent or uncooperative member (deferred, see the scope boundary below).** The member sends nothing at all (offline, crashed, or hostile). This is a liveness problem that non-inclusion signaling does **not** solve, for a structural reason rooted in the signature scheme.

**Why a silent member cannot simply be skipped.** The cohort signs with **n-of-n MuSig2** ([ADR 008](008-aggregation-subsystem-inception.md)): the aggregate public key is derived from all n members' keys, and the beacon address (the Taproot output the cohort funds and later spends) *is* that aggregate key. A valid key-path signature requires every member's partial signature. Dropping a signer yields a different aggregate key, hence a different address, so the funds already sitting at the original address can no longer be spent by the smaller cohort. The beacon spend is **key-path-only** Taproot ([ADR 038](038-musig2-key-custody.md); `cohort.ts:65-68` notes the key-path-only output has no script tree), so there is no fallback path to recover that UTXO without the full n-of-n. A non-updating member therefore still owes a nonce and a partial signature: non-inclusion saves an *update*, not a *signature*. A deadline timer can fail the round or trigger re-formation, but it cannot conjure the missing signature or skip the member and still produce a valid one. Closing the silent-member hole means a fund-recovery design (a Taproot script-path timelock) plus cohort re-formation economics, none of which the specification addresses. That is a separate, larger effort and is deferred.

**What the specification mandates** (did:btcr2 [Aggregate Beacons](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html) and [Algorithms](https://dcdpr.github.io/did-btcr2/algorithms.html)):

- Non-inclusion is an **in-cohort state, not removal**. Every member participates in every signing phase regardless of update status; their partial signature is required for finality.
- The SMT **non-inclusion leaf** is `SHA-256(SHA-256(nonce))` when a nonce is used, or the literal zero hash when it is not. This codebase always generates a per-slot nonce ([ADR 036](036-zero-hash-smt-model.md); `cohort.ts:235`), so the applicable form is `SHA-256(SHA-256(nonce))`, which is exactly `nonInclusionLeafHash(nonce)` (`btcr2-leaf.ts:25`), versus the inclusion leaf `SHA-256(SHA-256(nonce) || SHA-256(signedUpdate))` (`btcr2-leaf.ts:17`). Inclusion and non-inclusion share one proof and one verifier (the zero-hash collapsed bitmap); the non-inclusion proof simply omits the update.
- **CAS non-inclusion is absence**: a member with no update has no entry in the Announcement Map. There is no CAS non-inclusion proof; a resolver finds no entry for that DID.

**The SMT primitive already supports all of this.** The [ADR 017](017-optimized-smt-core-primitive.md) tree accepts an entry with an absent update and emits a non-inclusion leaf and a verifiable non-inclusion proof for it. The entire gap is in the aggregation orchestration layer, which never feeds the tree a slotted-but-empty leaf for a non-updating member.

## Decision

Model **cooperative non-inclusion** as a first-class in-cohort state across the two state machines and the wire format, gating aggregation on "every member has responded" rather than "every member has submitted an update". Leave the signing rounds untouched (all n members still sign). Record the silent-member liveness hole as explicitly out of scope.

1. **Non-inclusion is a response, not a removal.** A member that declines to update stays in the cohort, keeps its slot in the aggregate key, and still contributes a nonce and a partial signature. The aggregate key, the beacon address, and the n-of-n signing flow are unchanged.

2. **New `SUBMIT_NONINCLUDED` message.** A Step-2 message alongside `SUBMIT_UPDATE`, body `{ cohortId }`, carrying no update. Membership is already proven by the signed transport envelope ([ADR 027](027-aggregation-security-hardening.md)), so no extra proof field is needed for this version. Add the factory, a guard (asserts no update is present), and route it in the update phase.

3. **Gate on responses, not updates.** `AggregationCohort` gains a `nonIncluded` set and `addNonInclusion(did)` (the same membership validation as `addUpdate`). A new `hasAllResponses()` returns `pendingUpdates.size + nonIncluded.size === participants.length` and replaces `hasAllUpdates()` at the collection gate. This mirrors the existing `hasAllValidationResponses()` (`cohort.ts:267`), which already counts approvals plus rejections against the participant count. `pendingUpdates` stays clean (real updates only), so CAS correctness is preserved by construction.

4. **Slot every participant in the SMT; omit decliners from CAS.** `buildSMTTree` iterates the full participant list, not just `pendingUpdates`: an inclusion leaf for submitters, a non-inclusion leaf (`SHA-256(SHA-256(nonce))`) for decliners, with a per-slot nonce generated for every member as today. Each member, included or not, gets a verifiable proof. `buildCASAnnouncement` continues to iterate only `pendingUpdates`, so decliners are naturally absent from the map, matching the spec. Both builders' preconditions relax from `hasAllUpdates()` to `hasAllResponses()`.

5. **Participant `NonIncluded` phase and `declineUpdate()`.** `ParticipantCohortPhase` gains `NonIncluded` as a sibling of `UpdateSubmitted`, reachable from `CohortReady`. A new `declineUpdate(cohortId)` emits `SUBMIT_NONINCLUDED` and moves to `NonIncluded`. The distribute-data handler is relaxed to accept a `NonIncluded` member, who **validates its own slot** (verifies its non-inclusion proof for SMT, or asserts its DID is absent for CAS) rather than dropping the message, then proceeds through the normal validation and signing rounds unchanged. `ServiceCohortPhase` needs no new state; the gating moves into `hasAllResponses()`.

6. **Validation distinguishes a valid decline from a dropped update.** The SMT strategy, for a decliner, skips the update-id requirement and recomputes `SHA-256(SHA-256(nonce))` before verifying the proof. The CAS strategy treats "absent for a member that declined" as valid and "absent for a member that submitted" as a failure, keyed on the participant's own recorded intent rather than map presence alone.

7. **Runner ergonomics.** `OnProvideUpdate` widens to return `SignedBTCR2Update | null`; returning `null` means "no update this round" and the runner calls `declineUpdate` instead of `submitUpdate`. `CohortCompleteInfo` gains an explicit `included: boolean` so a resolver consuming the sidecar is never left inferring inclusion from an absent proof.

8. **Scope boundary: the silent member is out of scope.** This change fixes the cooperative case. It does **not** fix a member that sends neither `SUBMIT_UPDATE` nor `SUBMIT_NONINCLUDED`: that member still stalls the cohort at `hasAllResponses()`, and because n-of-n requires their signature, no deadline can skip them and still finalize. The deadline-and-recovery track (a signing deadline, a Taproot script-path timelock so funds are recoverable when a member vanishes, and cohort re-formation) is a separate effort with its own ADR. It pairs naturally with the time-between-announcements cadence modeled but staged in [ADR 039](039-cohort-condition-model.md).

### Rejected alternatives

- **Remove the non-updating member from the cohort.** Breaks n-of-n: a smaller cohort has a different aggregate key and beacon address, stranding the funded UTXO at the original key-path-only address, and the member's signature is still required to spend it. Non-inclusion must be an in-cohort state.
- **Use the literal zero-hash non-inclusion leaf.** That is the spec's nonceless variant. This codebase uses a nonce per slot ([ADR 036](036-zero-hash-smt-model.md)), so the leaf is `SHA-256(SHA-256(nonce))`. Switching forms would fork interop for no benefit.
- **Add the signing deadline and recovery now.** That addresses the silent member, not the no-update member, and forces fund-recovery (script-path) and re-formation choices the spec does not cover. It is deferred so cooperative non-inclusion can land cleanly on its own.
- **Skip the validation round for a decliner.** A member that does not verify its own slot could blindly sign a tree that misrepresents it. A decliner validates its non-inclusion proof before signing.
- **A separate `onDeclineUpdate` callback instead of `onProvideUpdate` returning `null`.** The `null` return is terser, and this release is already a breaking wire change, so the widened return type is absorbed rather than avoided.

## Consequences

**Positive**
- A cooperative member with no update no longer blocks its cohort: the round collects responses, builds the aggregated data, and broadcasts.
- The SMT primitive's non-inclusion support is finally exercised end to end; decliners receive a verifiable non-inclusion proof, and CAS decliners are correctly absent from the Announcement Map.
- `hasAllResponses()` follows the existing `hasAllValidationResponses()` pattern, so the collection and validation gates read consistently.

**Negative**
- This is a state-machine-deep change, unlike the prior runner-layer refactor: it touches both sans-I/O state machines and their shared cohort data class (`service.ts`, `participant.ts`, `cohort.ts`), the phase enum (`phases.ts`), the beacon strategies (`beacon-strategy.ts`), the message layer (`messages/*`), and the participant runner plus its events.
- A new wire message is a backward-incompatible protocol addition for strict older peers, and `OnProvideUpdate` is a public callback whose return type widens. The `validateParticipantView` change ripples to any custom beacon strategy. This is a `method` version bump (a deliberate breaking change recorded at release time).
- SMT trees for a cohort that contains a decliner are now fully slotted and re-root relative to the old absent-slot behavior; existing SMT scenario fixtures regenerate.

**Accepted**
- A silent or uncooperative member remains a liveness hole until the deferred deadline-and-recovery work. This is stated plainly so no reader assumes the denial-of-service surface is fully closed: cooperative non-inclusion is closed, silent non-response is not.
- Nonces stay mandatory, so the non-inclusion leaf is always `SHA-256(SHA-256(nonce))` and never the literal zero. The specification presents both variants; conforming to nonce-always (matching [ADR 036](036-zero-hash-smt-model.md)) is a deliberate choice worth confirming with the spec maintainers so this implementation does not diverge later.
- The `SUBMIT_NONINCLUDED` message carries only `cohortId` for this version; the service owns the SMT nonce as it does today. Participant-owned nonce persistence (the spec notes participants persist their nonces) is a later refinement, not part of this change.

## References

- [`packages/method/src/core/aggregation/cohort.ts`](../../packages/method/src/core/aggregation/cohort.ts): `hasAllUpdates()` (the collection gate to replace), `buildCASAnnouncement` / `buildSMTTree` (the builders to re-slot and relax), `hasAllValidationResponses()` (the response-counting pattern to mirror), and the key-path-only Taproot note.
- [`packages/method/src/core/aggregation/service.ts`](../../packages/method/src/core/aggregation/service.ts): the update-collection dispatch and gate to extend with a `SUBMIT_NONINCLUDED` handler.
- [`packages/method/src/core/aggregation/participant.ts`](../../packages/method/src/core/aggregation/participant.ts): `submitUpdate` and the distribute-data handler, alongside which `declineUpdate` and the non-inclusion validation path land.
- [`packages/method/src/core/aggregation/phases.ts`](../../packages/method/src/core/aggregation/phases.ts): `ParticipantCohortPhase`, gaining `NonIncluded`.
- [`packages/method/src/core/aggregation/beacon-strategy.ts`](../../packages/method/src/core/aggregation/beacon-strategy.ts): the CAS and SMT `validateParticipantView` branches for a valid decline.
- [`packages/smt/src/btcr2-leaf.ts`](../../packages/smt/src/btcr2-leaf.ts): `inclusionLeafHash` and `nonInclusionLeafHash`, the spec-cited leaf forms.
- [ADR 008](008-aggregation-subsystem-inception.md): the n-of-n MuSig2 trust model that makes non-inclusion an in-cohort state. [ADR 017](017-optimized-smt-core-primitive.md): the SMT primitive that already supports non-inclusion proofs. [ADR 027](027-aggregation-security-hardening.md): the signed envelope that proves membership. [ADR 036](036-zero-hash-smt-model.md): the nonce-always zero-hash leaf model. [ADR 038](038-musig2-key-custody.md): the key-path-only spend behind the fund-locking constraint. [ADR 039](039-cohort-condition-model.md): the announcement-cadence conditions the deferred deadline work pairs with. [ADR 040](040-multi-cohort-service-runner.md): the multi-cohort runner this protocol change runs underneath.
