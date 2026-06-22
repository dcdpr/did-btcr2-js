---
title: "ADR 036: Adopt the Zero-Hash SMT Model per algorithms.html"
---

# ADR 036: Adopt the Zero-Hash SMT Model per algorithms.html

**Status:** Accepted

**Date:** 2026-06-16

**Branch / PR:** `feat/scenario-orchestrator`

**References:** [ADR 017](017-optimized-smt-core-primitive.md), [ADR 035](035-smt-proof-base64url-wire-format.md), [ADR 016](016-sans-io-resolver.md)

## Context

[ADR 017](017-optimized-smt-core-primitive.md) adopted an Optimized (collapsing / path-compressing) Sparse Merkle Tree as the aggregate-beacon primitive. While building live test vectors that shadow danubetech's reference examples, we found the did:btcr2 specification describes the SMT **two different and incompatible ways**:

- **Appendix** ([`appendix/optimized-smt.html`](https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html)): a *collapsing* SMT: an empty sibling is skipped and a single-child node passes its child's hash up unchanged. The `collapsed` bitmap is read LSB-first (leaf at bit 0).
- **Algorithms** ([`algorithms.html#smt-proof-verification`](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification)): a *zero-hash* SMT: every one of the 256 levels is hashed, and an empty sibling contributes a precomputed `cachedZero` value. Read MSB-first (`i = 255 - n`).

The spec owner confirms **`algorithms.html` is the source of truth and the appendix is outdated.** These are not two views of one tree: a single-leaf tree collapses to the leaf hash under the appendix model but hashes up 256 levels under the zero-hash model, producing different roots. We verified three mutually incompatible root constructions in play: our implementation (a depth-byte-padding collapse), danubetech's driver (pure-skip collapse), and the spec's `algorithms.html` (zero-hash). The leaf formula (`hash(hash(nonce) || hash(update))`) and index (`hash(did)`) agree across all three; only the empty-sibling handling (and hence the root) differs.

The authoritative verification pseudocode (verbatim):

```
cachedZero = []; z = 0; for i in 0..=255 { z = hash(z‖z); cachedZero[i] = z }
candidate = hash(hash(proof.nonce) + proof.updateId);  index = hash(did)
for n in 0..=255 { i = 255 - n
  sib = collapsed[i]==1 ? cachedZero[n] : hashes.pop_front()
  candidate = index[i]==1 ? hash(sib‖candidate) : hash(candidate‖sib) }
return candidate == proof.id
```

## Decision

Implement the **zero-hash SMT** of `algorithms.html` in the did:btcr2 aggregate-beacon layer, replacing the collapsing model for protocol use.

- New `smt/src/zero-hash.ts`: `CACHED_ZERO` (the empty-subtree table), `zeroHashRoot`, `generateZeroHashProof`, and `verifyZeroHash`, the last a line-for-line implementation of the authoritative verification pseudocode.
- `btcr2-tree.ts` (`BTCR2MerkleTree`) builds the zero-hash root and emits zero-hash proofs; `btcr2-proof.ts` serializes/deserializes the wire format and verifies via `verifyZeroHash`. The public API (`BTCR2MerkleTree`, `serializeProof`/`deserializeProof`/`verifySerializedProof`, `SerializedSMTProof`) is unchanged, so the resolver and aggregation layers are untouched.
- `collapsed` is the empty-sibling bitmap, MSB-first (bit `i = 255` = leaf level), a full 32-byte value.
- The previous `OptimizedSMT` / `SMTProof` (collapsing) remain in the package as generic, self-contained utilities but are **decoupled from the protocol** (candidate for the dead-code sweep). This supersedes [ADR 017](017-optimized-smt-core-primitive.md) for aggregate-beacon use.

### Assumptions flagged for the spec owner

`algorithms.html` gives the *verification* but not the *construction*, and two details are underspecified. We resolved each defensibly and isolated it so a future spec clarification is a one-line change:

1. **`cachedZero` seed.** The spec writes `z = 0` with no byte width. We seed `z` with 32 zero bytes (the project's `NULL_HASH` convention). Only `CACHED_ZERO`'s seed changes if the spec pins a different value.
2. **Build algorithm.** We derived a top-down zero-hash build (empty subtree of height `h` = `cachedZero[h]`, split bit `256 - h`) and proved it consistent with the authoritative verifier by (a) round-trip over random trees and (b) re-verifying generated proofs with an **independent** re-implementation of the `algorithms.html` pseudocode.

## Consequences

**Positive**
- Our SMT proofs now conform to the source-of-truth verification algorithm. Generated cohort proofs verify under an independent implementation of the spec's verifier.
- The change is confined to the SMT package's BTCR2 layer; resolver, beacons, and aggregation consume the same API.

**Negative**
- SMT roots change (e.g. cohort signals became `da1c26e2…` / `799b3ecd…`). The to-be-anchored OP_RETURN payload changes; beacon **addresses are unchanged** (derived from the cohort key), so no re-funding is required, only re-anchoring the new root. No production data exists; only test vectors regenerate.
- Two SMT models now coexist in the package (zero-hash for the protocol, collapsing `OptimizedSMT` as a generic utility). Flagged for cleanup.

**Explicitly accepted / escalated**
- The `algorithms.html` (zero-hash) vs `appendix` (collapsing) conflict is a **spec-internal inconsistency**, and danubetech's driver implements the appendix model, so our spec-conformant SMT vectors will not resolve in danubetech's current driver, and vice versa. This is to be raised with the spec owner; we conform to the stated source of truth rather than to any implementation.
- The two underspecified construction details (seed, build) are our defensible choices pending spec-owner confirmation.

## Validation

- `@did-btcr2/smt`: 211 tests pass (zero-hash round-trip + format + negative cases; generic `OptimizedSMT`/`SMTProof` unchanged).
- `@did-btcr2/method`: 247 tests pass; all 16 scenarios resolve through the real resolver using the zero-hash `verifySerializedProof`.
- Independent oracle: each generated cohort proof verifies under a separate node-crypto re-implementation of the `algorithms.html` pseudocode.

## References

- [`packages/smt/src/zero-hash.ts`](../../packages/smt/src/zero-hash.ts): `CACHED_ZERO`, `zeroHashRoot`, `generateZeroHashProof`, `verifyZeroHash`.
- [`packages/smt/src/btcr2-tree.ts`](../../packages/smt/src/btcr2-tree.ts), [`btcr2-proof.ts`](../../packages/smt/src/btcr2-proof.ts): the BTCR2 layer.
- [`algorithms.html#smt-proof-verification`](https://dcdpr.github.io/did-btcr2/algorithms.html#smt-proof-verification): the authoritative algorithm.
- [`appendix/optimized-smt.html`](https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html): the outdated collapsing description.
- [ADR 017](017-optimized-smt-core-primitive.md): the superseded collapsing primitive. [ADR 035](035-smt-proof-base64url-wire-format.md): the base64url wire encoding (still applies to all hash fields).
