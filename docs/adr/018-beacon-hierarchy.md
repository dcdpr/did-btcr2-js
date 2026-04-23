---
title: "ADR 018: Beacon Hierarchy (Singleton, CAS, SMT)"
---

# ADR 018: Beacon Hierarchy: Singleton, CAS, and SMT Beacon Types

**Status:** Accepted

**Date:** 2026-03-28

**Commit:** [`bb8aee7`](https://github.com/dcdpr/did-btcr2-js/commit/bb8aee7)

## Context

In did:btcr2, a beacon is how a DID controller announces updates to their DID document on-chain. The protocol supports three distinct shapes: each with different trust, throughput, and resolution-complexity trade-offs:

- **Singleton.** One beacon address per DID. The controller publishes an update hash directly in an OP_RETURN. Single-party; simple resolution; maximal block-space cost per DID.
- **CAS (content-addressed store).** Many DIDs share a beacon address; the on-chain signal is a content-addressed announcement hash. The announcement itself lives off-chain (IPFS), listing updates for multiple DIDs. Multi-party; shared block-space cost; resolution requires CAS retrieval.
- **SMT (Sparse Merkle Tree).** Many DIDs share a beacon address; the on-chain signal is a Merkle root. Each participant gets back an inclusion proof they keep as a sidecar. Multi-party; shared block-space cost; resolution requires proof verification.

Before this landed, the codebase had an earlier experiment where beacon types were modeled as configuration flags on a single class. That made the factory logic gnarly (many `if (type === 'x')` branches) and obscured the fundamentally different resolution paths each type implies.

## Options considered

1. **Configuration flags on a single `Beacon` class.** Lowest file count; highest per-type branching at every call site.
2. **Union type with discriminated variants.** Works for pure-data beacon records but awkward for the stateful `broadcastSignal()` / `processSignals()` methods each type needs.
3. **Class hierarchy: abstract `Beacon` base + three concrete subclasses + a factory.**

## Decision

**Option 3.** `Beacon` is an abstract base class encoding the common contract (fee estimation, PSBT construction, signal broadcast). Three concrete subclasses: `SingletonBeacon`, `CASBeacon`, `SMTBeacon`: implement their type-specific behavior. `BeaconFactory.establish(service)` dispatches on the service record to instantiate the correct subclass.

Each subclass owns:

- Its own `broadcastSignal()`: Singleton signs directly; CAS invokes an optional `casPublish` callback for off-chain; SMT builds a single-entry Merkle tree as a trivial root.
- Its own `processSignals()`: returns `BeaconProcessResult = { updates, needs }` with the type-appropriate `DataNeed` emissions. Singleton emits `NeedSignedUpdate`; CAS emits `NeedCASAnnouncement`; SMT emits `NeedSMTProof`.

Aggregate beacons (CAS, SMT) ship a second multi-party path via the `AggregationService` subsystem ([ADR 020](020-aggregation-layered-architecture.md)).

## Consequences

**Positive**
- Each beacon type's resolution contract is expressed once, in its own file, close to its `processSignals` implementation. Future contributors find the right file by DID-document service type.
- Adding a fourth beacon type (hypothetical, e.g., a zk-rollup commitment beacon) is a new file + a factory case, not a refactor.
- The abstract base carries the fee-estimation pattern (two-pass sign-to-measure-vsize-then-rebuild) so every beacon type inherits the same behavior.

**Negative**
- Three files to keep aligned when the shared base changes (e.g., adding a new fee estimator parameter).
- The factory has to know every beacon type; new types require a factory edit in addition to the new file.

## References

- [`packages/method/src/core/beacon/beacon.ts`](../../packages/method/src/core/beacon/beacon.ts): abstract base.
- [`packages/method/src/core/beacon/factory.ts`](../../packages/method/src/core/beacon/factory.ts): dispatch.
- [`packages/method/src/core/beacon/singleton-beacon.ts`](../../packages/method/src/core/beacon/singleton-beacon.ts),
  [`cas-beacon.ts`](../../packages/method/src/core/beacon/cas-beacon.ts),
  [`smt-beacon.ts`](../../packages/method/src/core/beacon/smt-beacon.ts).
- [ADR 017](017-optimized-smt-core-primitive.md): the Merkle primitive SMTBeacon consumes.
