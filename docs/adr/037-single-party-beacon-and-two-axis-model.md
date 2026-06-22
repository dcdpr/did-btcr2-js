---
title: "ADR 037: Rename Beacon to SinglePartyBeacon and the Two-Axis Beacon Model"
---

# ADR 037: Rename Beacon to SinglePartyBeacon and the Two-Axis Beacon Model

**Status:** Accepted

**Date:** 2026-06-19

**Branch / PR:** `refactor/single-party-beacon`

**References:** [ADR 018](018-beacon-hierarchy.md), [ADR 008](008-aggregation-subsystem-inception.md), [ADR 020](020-aggregation-layered-architecture.md)

## Context

[ADR 018](018-beacon-hierarchy.md) established the beacon class hierarchy: an abstract `Beacon` base with three subclasses (`SingletonBeacon`, `CASBeacon`, `SMTBeacon`). The base class name is generic, but what it actually provides is specific: **single-party broadcast machinery**, `buildSignAndBroadcast` and the P2PKH / P2WPKH / P2TR single-input build-sign-broadcast phases (`packages/method/src/core/beacon/beacon.ts`). One party holds one key and broadcasts one 32-byte signal.

The real design space is two **orthogonal** axes, not one inheritance chain:

- **Beacon type**: what the on-chain signal commits to: `singleton` (one DID's update hash), `CAS` (a content-addressed announcement map), `SMT` (a Sparse Merkle Tree root).
- **Broadcast mode**: who produces the transaction: **single-party direct** (one key, P2PKH/P2WPKH/P2TR, via the base class) or **aggregation cohort of N** (N ≥ 1 participants, a MuSig2 P2TR key-path spend, via `AggregationService` per [ADR 020](020-aggregation-layered-architecture.md)).

CAS and SMT beacons are first-class on **both** axes: a CAS or SMT beacon can be broadcast single-party (the subclass's own `broadcastSignal`, which builds a single-entry announcement/tree and spends solo) **or** through an aggregation cohort of any N ≥ 1, including a **cohort of one**. Singleton is single-party only (aggregation is incompatible by design). The generic name `Beacon` hides this two-axis structure and invites the wrong refactor, e.g. merging `Beacon` and `SingletonBeacon`, which would conflate "the single-party broadcast base" with "the singleton beacon type."

The aggregation path does **not** live in the class hierarchy: it is `buildAggregationBeaconTx` plus the `AggregationService` state machine, and it produces an *unsigned* tx because the signature comes from a MuSig2 round rather than a local key. The inheritance shape therefore already expresses the matrix correctly; only the base class's *name* is wrong.

|         | single-party direct (P2PKH / P2WPKH / P2TR) | aggregation cohort of N ≥ 1 (P2TR MuSig2) |
| ------- | ------------------------------------------- | ----------------------------------------- |
| singleton | `SinglePartyBeacon.buildSignAndBroadcast`  | N/A (incompatible by design)              |
| CAS     | `SinglePartyBeacon.buildSignAndBroadcast`   | `AggregationService` (any N ≥ 1)          |
| SMT     | `SinglePartyBeacon.buildSignAndBroadcast`   | `AggregationService` (any N ≥ 1)          |

## Decision

Rename the abstract base class `Beacon` to **`SinglePartyBeacon`** and adopt the two-axis model as the design vocabulary for ongoing aggregation work.

1. **Rename `Beacon` to `SinglePartyBeacon`** (`beacon.ts`). The three subclasses extend it for their single-party broadcast path. The name now states what the base provides (single-party broadcast), not the general beacon *concept*.
2. **The concept "Beacon" is unchanged.** `BeaconService`, `BeaconSignal`, `BeaconFactory`, `BeaconUtils`, `BeaconError`, and all prose about "a beacon" keep the name. `SinglePartyBeacon` names a *broadcast role*, not the beacon abstraction.
3. **`extends SinglePartyBeacon` does not mean "cannot aggregate."** It means "this beacon type has a single-party broadcast implementation." Aggregation is the orthogonal axis, handled by `AggregationService`, available to CAS and SMT regardless of the base class.
4. **Add `AggregationRunner.solo()`**: a cohort-of-1 wrapper over `AggregationService` that exercises the BIP-341 P2TR MuSig2 path with a single participant. It makes single-participant aggregate broadcasts first-class (and reproducible for aggregate test-vector generation).

### Rejected alternatives

- **Merge `Beacon` and `SingletonBeacon`.** The three subclasses genuinely reuse the base's broadcast plumbing; merging would either bloat one class with all variants or reintroduce a `type` discriminator that reinvents polymorphism.
- **Extract a `Broadcaster` strategy class.** A composition refactor is churn for no win under the two-axis framing: the matrix is already expressed by the current inheritance; only the name was wrong.
- **Keep a deprecated `Beacon` alias.** Pre-1.0, and this change bumps `method` anyway; a clean break is clearer than a lingering alias.

## Consequences

**Positive**
- The name states the contract (single-party broadcast), and the two-axis matrix provides a precise vocabulary so later work (running multiple cohorts on a single service, the cohort-condition model, non-inclusion signaling) can reason about *broadcast mode* and *beacon type* independently.
- `solo()` removes the special-case status of a cohort-of-1, unblocking single-participant aggregate vectors.

**Negative**
- Breaking export rename of `Beacon` from `@did-btcr2/method` (a `method` version bump). The audit found **zero** references to the base class in `packages/api` and `packages/cli`; the change is confined to `method` (the base, its three subclasses, the factory return type, and JSDoc links).

**Accepted**
- This is an early stage of the broader aggregation effort; subsequent work adds the MuSig2 key-custody story (wiring key management into the aggregation signing path), the remaining cohort conditions, advertising multiple cohorts on a single service, and non-inclusion signaling, each in its own ADR.

## References

- [`packages/method/src/core/beacon/beacon.ts`](../../packages/method/src/core/beacon/beacon.ts): the renamed `SinglePartyBeacon` base.
- [`packages/method/src/core/beacon/factory.ts`](../../packages/method/src/core/beacon/factory.ts): `BeaconFactory.establish` returns a `SinglePartyBeacon`.
- [ADR 018](018-beacon-hierarchy.md): the beacon hierarchy this refines. [ADR 020](020-aggregation-layered-architecture.md): the aggregation layer that owns the cohort broadcast mode.
