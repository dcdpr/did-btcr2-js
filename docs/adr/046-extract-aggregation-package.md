---
title: "ADR 046: Extract the Aggregation Subsystem into @did-btcr2/aggregation"
---

# ADR 046: Extract the Aggregation Subsystem into @did-btcr2/aggregation

**Status:** Accepted (implementation pending)

**Date:** 2026-06-24

**Branch / PR:** `refactor/aggregation-extraction`

**Implementation status:** This record fixes the design ahead of the move on this branch. At the time of writing the aggregation subsystem still lives under `packages/method/src/core/aggregation/`; the new package and the boundary changes described below are the accepted target, not yet in the code.

**References:** [ADR 001](001-monorepo-package-boundaries.md), [ADR 008](008-aggregation-subsystem-inception.md), [ADR 020](020-aggregation-layered-architecture.md), [ADR 028](028-http-transport-additive.md), [ADR 045](045-analytical-vsize-aggregation-fees.md)

## Context

The aggregation subsystem (`packages/method/src/core/aggregation/`) is the multi-party coordination layer for aggregate beacons: the `AggregationService` and `AggregationParticipant` state machines, `AggregationCohort`, `BeaconSigningSession`, the runner facades, the message factories and guards, and the transport adapters (Nostr, HTTP client and server, the in-memory bus, the DIDComm stub). It is highly cohesive and, unlike the rest of `method`, it is intended to run as a standalone service: aggregation servers will be long-lived processes with their own security and timing profiles operating under monetary contracts. A consumer that only needs the method's read or single-party broadcast path should not have to pull MuSig2, Nostr, and the HTTP transport into its bundle, and an aggregation operator should be able to depend on the protocol without the rest of `method`.

A dependency mapping of the current tree establishes the decisive facts:

- The **only** edge from `method` into the aggregation subtree is the re-export barrel in `src/index.ts` (a block of `export *` lines). No beacon, resolver, updater, facade, or other `method` runtime module consumes an aggregation symbol. `method`'s own logic is completely independent of aggregation.
- The aggregation subtree reaches back into `method` at exactly **four** touchpoints: `Identifier` from `core/identifier.ts` in the HTTP transport client and server (a runtime use, resolving a KEY-DID sender's public key); the `CASAnnouncement` type from `core/types.ts` in `cohort.ts` (type-only); and the `FeeEstimator` interface plus the `DEFAULT_FEE_ESTIMATOR` value from `core/beacon/fee-estimator.ts` in the runner (a type plus a runtime default).
- No import cycle exists today, because these are intra-package relative imports. Extracting the subtree without resolving the four touchpoints would create a hard cycle: `method` would depend on `@did-btcr2/aggregation` (it re-exports it) while `@did-btcr2/aggregation` depended back on `@did-btcr2/method`. `tsc -b` project references forbid reference cycles and would fail the build. Resolving the four touchpoints yields a clean DAG: `method` to `aggregation` to `{common, keypair, cryptosuite, smt, bitcoin}`.

Because `method`'s runtime does not consume aggregation, this is a packaging move rather than an API redesign. The work is to sever the four back-edges, lift the subtree into a new package, and have `method` re-export it so the public surface is preserved.

## Decision

### 1. Extract the aggregation subtree into `@did-btcr2/aggregation`; `method` re-exports it

The entire `core/aggregation/` subtree moves into a new workspace package `@did-btcr2/aggregation`. `method` keeps a single `export * from '@did-btcr2/aggregation'` line in place of the current per-module barrel, so every aggregation symbol (`AggregationService`, `AggregationParticipant`, `AggregationCohort`, both runners, `BeaconSigningSession`, `TransportFactory`, the transport adapters, the message factories and guards, and the recovery, fallback, and condition types) remains importable from `@did-btcr2/method` unchanged. The `api` and `cli` packages import no aggregation symbols, so they are unaffected.

### 2. Sever the runtime DID coupling with an injected sender-pubkey resolver

The HTTP transport's two identical `Identifier.decode` call sites resolve a KEY-DID sender's public key, and each already tries a peer map first. They are replaced by an injected `resolveSenderPk` callback on the transport options: given a DID, the callback returns the sender's public key or nothing. When `method` wires the transport it supplies a callback that decodes the identifier and returns the genesis key for a KEY-type DID; when no callback is supplied, resolution degrades to the peer-map path that already runs first. This removes the aggregation transport's only runtime dependency on `method` and makes the transport DID-method-agnostic: it no longer names did:btcr2's `Identifier` and could carry another DID method's sender resolution.

### 3. The fee contract moves to `@did-btcr2/bitcoin`; `CASAnnouncement` stays method-owned

The two type touchpoints are resolved by ownership that follows where each type genuinely belongs, not by relocating both into aggregation.

- **`FeeEstimator` and `StaticFeeEstimator` move to `@did-btcr2/bitcoin`.** A fee estimator (satoshis-per-vbyte applied to a transaction vsize) is a Bitcoin-transaction primitive, and `@did-btcr2/bitcoin` is already a shared dependency of both `method` and `aggregation`. Moving the interface and the static implementation there gives them a single owner with no duplication, severs the runner's fee touchpoint as `aggregation` to `bitcoin` (not back into `method`), and avoids the layering inversion that would result from `method`'s beacon layer importing its fee interface from `aggregation`. `method`'s `core/beacon/fee-estimator.ts` re-exports `FeeEstimator` and `StaticFeeEstimator` from `@did-btcr2/bitcoin` so the `@did-btcr2/method` public surface is preserved.

- **`CASAnnouncement` stays in `method`.** It is a resolution type, not an aggregation artifact: method's resolver consumes it across the read path (the `NeedCASAnnouncement` data need, the `casMap`, and the CAS sidecar types in `core/types.ts`). Aggregation merely produces one. Aggregation's `cohort.buildCASAnnouncement` therefore returns a local structural type (the DID-to-update-hash record) that is compatible with method's `CASAnnouncement` at the boundary without importing it. This keeps the type owned by the read path that consumes it and removes the `aggregation` to `method` type edge.

A shared `@did-btcr2/types` package was considered and rejected for this extraction (see Rejected alternatives).

### 4. The aggregation runner builds its own default fee estimator

The runner can no longer read `method`'s `DEFAULT_FEE_ESTIMATOR`. It constructs its own default from `@did-btcr2/bitcoin`'s `StaticFeeEstimator` (the same fixed 5 sat/vB rate), so the runner keeps its `feeEstimator ?? default` ergonomics and existing callers need no change. `method` retains its own beacon-layer default for the single-party broadcast path.

### 5. Transport sub-entry-points are deferred

`nostr-tools` is imported only in `transport/nostr.ts`; the HTTP transport is pure crypto over the workspace packages. Splitting the package into `transport/nostr` and `transport/http` entry points so an HTTP-only consumer never pulls `nostr-tools` is deferred to a follow-up, because it requires reworking `TransportFactory` to lazily import the Nostr adapter (an eager factory that statically imports every adapter defeats the split). This extraction ships the whole transport surface from the package root and stays a pure packaging move.

### 6. The aggregation tests move with the code

The aggregation spec files move into the new package. They exercise aggregation logic and already import only through the public surface, so they re-point from `method`'s barrel to the new package's. `method` keeps a single back-compat smoke test asserting that the re-export barrel resolves the aggregation symbols, which guards the preserved surface without duplicating the suite. The few method-core end-to-end specs that drive aggregation together with `Resolver`, `Updater`, and the `DidBtcr2` facade keep importing both packages.

### 7. Build wiring and package shape

`packages/aggregation` is a `composite` TypeScript project with references to `common`, `keypair`, `cryptosuite`, `smt`, and `bitcoin`. Output is ESM-only (matching `method`, `cryptosuite`, `api`, and `cli`), producing `dist/esm` and `dist/types`. `method`'s `tsconfig.json` gains a reference to `../aggregation` and a `workspace:^` dependency on it; the root solution `tsconfig.json` adds the new package. After the four touchpoints are severed, `tsc -b` sees a clean DAG with no reference cycle.

## Consequences

- **The public surface is preserved.** Consumers importing aggregation symbols from `@did-btcr2/method` keep working through the re-export, so the change is additive for them. `api` and `cli` are untouched.
- **The aggregation HTTP transport becomes DID-method-agnostic.** This is a reusability gain. The cost is a new optional `resolveSenderPk` option; `method` supplies it by default, so method-driven usage is unchanged. A standalone caller that relied on automatic KEY-DID decoding now passes the callback or accepts peer-map-only resolution.
- **`method` gains a dependency** on `@did-btcr2/aggregation`, which is versioned on its own line. `method`'s bump is additive as long as no public symbol is dropped.
- **`FeeEstimator` gains a single owner in `@did-btcr2/bitcoin`**, its natural home, and `CASAnnouncement` stays method-owned as a resolution type. Neither is duplicated, and method's beacon layer keeps its fee interface without depending on aggregation.
- **Full `nostr-tools` isolation waits on the deferred sub-entry-point split.** Until then an HTTP-only consumer of the new package still resolves `nostr-tools` through the package root.

## Rejected alternatives

- **A shared `@did-btcr2/types` package for the boundary types.** Over-engineering for these contracts, and it cannot absorb the runtime `Identifier` coupling, since `Identifier` is a runtime class that cannot move cheaply. The `FeeEstimator` interface has a natural home in `@did-btcr2/bitcoin` and `CASAnnouncement` belongs with the resolver that consumes it, so no new types package is warranted. Worth revisiting only if broader cross-package type sharing emerges.
- **Relocating `CASAnnouncement` and `FeeEstimator` into aggregation with `method` re-importing them.** This would invert method's layering: `CASAnnouncement` is consumed across method's resolver (the read path) and `FeeEstimator` by method's beacon broadcast, so making aggregation their owner would force method's core to import core types from the higher-level aggregation package. Keeping `CASAnnouncement` in method and moving `FeeEstimator` to `bitcoin` resolves both touchpoints without the inversion.
- **A type-only import of `method` from `aggregation`.** The runtime edges (`Identifier`, the fee default) are not type-only, and even a pure `import type` edge would force `aggregation`'s `tsconfig` to reference `method`, recreating the `tsc -b` cycle.
- **Moving `Identifier` into a shared package.** A large refactor of `method`'s core for one transport helper; the injected callback achieves the decoupling with near-zero change and a reusability bonus.
- **Splitting the transports into sub-entry-points now.** Couples a build-time tree-shaking optimization (a lazy `TransportFactory`) to a packaging move; deferred to keep this change a clean lift.
- **Leaving the tests in `method`.** They test aggregation logic; the new package should own its suite, with a method-side smoke test guarding the re-export.
