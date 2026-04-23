---
title: "ADR 017: Optimized Sparse Merkle Tree as the Aggregate-Beacon Primitive"
---

# ADR 017: Optimized Sparse Merkle Tree as the Aggregate-Beacon Primitive

**Status:** Accepted

**Date:** 2026-03-27

**Commit:** [`0fe4e32`](https://github.com/dcdpr/did-btcr2-js/commit/0fe4e32)

## Context

did:btcr2 aggregate beacons need a Merkle structure that lets many DID controllers commit their updates into a single root and prove inclusion efficiently at resolution time. The initial design used a classic Merkle-Sum tree from an earlier `@did-btcr2/smt` package. As the aggregate-beacon work matured, three problems with that choice emerged:

1. **Proof size and complexity.** Merkle-Sum proofs carry both hashes and cumulative sums at every level. The sum dimension isn't needed for aggregate beacons (we're not doing amount accounting), so it's overhead the protocol doesn't use.
2. **External-dependency footprint.** The initial `@did-btcr2/smt` package vendored a third-party Merkle-Sum implementation. Core crypto primitives pulling in external dependencies conflict with the codebase's "own our crypto primitives" stance, which is already applied across keypair, hashing, and canonicalization.
3. **Sparse-tree semantics.** did:btcr2 update commitments are sparse by nature (the vast majority of possible leaf positions are empty). A Sparse Merkle Tree with collapse-on-empty optimization yields materially smaller proofs than a full Merkle-Sum tree populated with default leaves.

## Options considered

1. **Keep Merkle-Sum, live with the overhead.** Lowest change cost.
2. **Switch to an off-the-shelf SMT library.** Several candidates exist in TypeScript, but all bring their own tree semantics, API surface, and supply-chain weight.
3. **Implement our own Optimized SMT**: collapse empty subtrees, encode non-empty paths as a bitmap, reuse our existing `@noble/hashes` primitives.

## Decision

**Option 3.** Replace the Merkle-Sum tree with an Optimized Sparse Merkle Tree implemented in `@did-btcr2/smt`:

- `optimized-smt.ts` holds the core tree.
- `btcr2-leaf.ts` / `btcr2-tree.ts` / `btcr2-proof.ts` expose aggregate-beacon-specific wrappers with the exact leaf and proof shapes the protocol needs.
- `smt-proof.ts` carries the collapsed bitmap + sibling hashes + root id, which the resolver consumes via `NeedSMTProof`.

No third-party Merkle library; only `@noble/hashes` (SHA-256) and `@noble/curves` for the aggregate-beacon key material.

## Consequences

**Positive**
- Proofs are materially smaller: one collapsed bitmap + the sibling hashes for occupied paths, instead of full-path hashes and sums.
- All crypto stays inside the `@noble/*` / `@scure/*` stack we're already auditing for other reasons ([ADR 019](019-browser-compat-and-noble.md)).
- The tree code is narrow enough to code-review locally: no transitive dependency tree to inspect.

**Negative**
- We own the correctness proof of the optimization. The test suite covers inclusion, non-inclusion, and bitmap collapse explicitly; regressions here are subtle.
- Interop with non-TypeScript did:btcr2 implementations now requires them to match our exact bitmap serialization. Documented in the SMT package; must stay stable or bump a protocol version.

**Explicitly accepted trade-offs**
- Rolling our own Merkle structure rather than borrowing one is extra responsibility. Offset by the fact that the surface is small and the semantics are completely pinned to aggregate-beacon needs, not general-purpose Merkle use.

## References

- [`packages/smt/src/optimized-smt.ts`](../../packages/smt/src/optimized-smt.ts): core tree.
- [`packages/smt/src/btcr2-proof.ts`](../../packages/smt/src/btcr2-proof.ts): proof shape used by the resolver.
- [ADR 020](020-aggregation-layered-architecture.md): the aggregation layer that consumes this primitive via the SMT beacon.
