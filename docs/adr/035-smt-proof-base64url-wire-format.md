---
title: "ADR 035: SMT Proof Wire Format: base64url no-pad and the Zero-Node Collapsed Bitmap"
---

# ADR 035: SMT Proof Wire Format: base64url no-pad and the Zero-Node Collapsed Bitmap

**Status:** Accepted

**Date:** 2026-06-15

**Branch / PR:** `feat/scenario-orchestrator`

**References:** [ADR 017](017-optimized-smt-core-primitive.md), [ADR 014](014-canonicalization-functions-and-toJSON-convention.md), [ADR 016](016-sans-io-resolver.md)

## Context

The `@did-btcr2/smt` package serializes a Sparse Merkle Tree inclusion proof into the wire shape the resolver consumes via `NeedSMTProof` (see [ADR 016](016-sans-io-resolver.md)) and that a DID controller distributes as sidecar data. ADR 017 already flagged the consequence we are now paying down:

> Interop with non-TypeScript did:btcr2 implementations now requires them to match our exact bitmap serialization. Documented in the SMT package; must stay stable or bump a protocol version.

The committed serializer emitted **hex** for every hash field and encoded `collapsed` as a minimal big-integer (in string form). Cross-checking against the did:btcr2 specification's [SMT Proof data structure](https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof) and against danubetech's real reference proofs (examples 11a and 12a) showed both choices are wrong on the wire:

1. **Encoding.** The spec's hash fields (`id`, `nonce`, `updateId`, `hashes`) are `base64url` [RFC4648] with no padding, exactly the project's canonical default encoding ([ADR 014](014-canonicalization-functions-and-toJSON-convention.md)). The spec examples carry the phrase "Hexadecimal of ..." in the field descriptions, but that wording is an acknowledged spec error: see [dcdpr/did-btcr2#318](https://github.com/dcdpr/did-btcr2/issues/318). The actual example values are 43-character base64url strings, not 64-character hex.

2. **`collapsed` semantics.** The spec defines `collapsed` as a bitmap of the **zero (empty) nodes** along the path, read right to left (LSB to MSB). Our internal tree carries the opposite bitmap, `converge`, where a set bit marks a **real sibling hash**. The committed serializer leaked `converge` directly and trimmed it to a minimal integer. Decoding danubetech's real `collapsed` value (`v_________________________________________8` decodes to `0xBF…FF`, 255 set bits for a depth-256 path with one occupied sibling) confirmed two things: `collapsed` is the bitwise complement of `converge`, and it is always the **full 256 bits** (32 bytes), never a minimized integer.

These are silent interop breakers: a conforming resolver from another implementation would reject our proofs, and we would reject theirs.

## Decision

Pin the SMT Proof wire format to the spec, and treat the serializer/deserializer as the single conversion boundary between the internal tree representation and the wire representation.

1. **All hash fields are base64url no-pad (43 chars).** `id`, `nonce`, `updateId`, and every entry of `hashes` are encoded with `base64urlnopad`. Added `hashToBase64Url` / `base64UrlToHash` helpers in `smt/src/hash.ts`; the latter enforces a 32-byte length check so malformed input fails fast rather than producing a short hash.

2. **`collapsed` is the full 256-bit zero-node bitmap, base64url no-pad.** `serializeProof` emits `collapsed = base64url( complement(converge) )` over the full 32 bytes (`MASK_256 ^ converge`). `deserializeProof` inverts it back: `converge = MASK_256 ^ bigint(decode(collapsed))`. The bitmap is never minimized: it is always 43 base64url characters.

3. **The internal tree keeps `converge`.** No change to the in-memory `OptimizedSMT` / `BTCR2MerkleTree` representation or to the verification walk. The complement lives only in the serialize/deserialize boundary, so the optimization's bit conventions (leaf = bit 255, root = bit 0) are untouched.

4. **The resolver's `smtMap` stays keyed by hex.** The on-chain OP_RETURN `signalBytes` are hex (they mirror the raw bytes in the signal). The resolver keys `smtMap` by `hex(decode(proof.id, 'base64urlnopad'))` so a base64url proof id still matches the hex on-chain root without a second encoding hop. The same normalization is applied in `provide(NeedSMTProof)`. This keeps one rule consistent across all three sidecar maps (`updateMap`, `casMap`, `smtMap` are hex-keyed; byte comparisons are over raw bytes), per the encoding note in the method package docs.

Reads of `nonce` / `updateId` in the resolver (`smt-beacon.ts`) and in the aggregation participant validation (`aggregation/beacon-strategy.ts`) decode via `base64UrlToHash`; the participant's `expectedUpdateId` is produced with `hashToBase64Url` so a base64url value is compared against a base64url value.

## Consequences

**Positive**
- Our SMT proofs are byte-shape compatible with the spec and with danubetech reference vectors. Cross-implementation interop no longer silently fails on encoding.
- One encoding convention (base64url no-pad) now spans canonical hashing ([ADR 014](014-canonicalization-functions-and-toJSON-convention.md)), CAS content addressing ([ADR 023](023-cas-read-path.md)), and SMT proofs. Fewer special cases for readers of the codebase.
- The complement is confined to the serialization boundary, so the tree's bit math and proof walk are unchanged and still locally reviewable (the ADR 017 property).

**Negative**
- This is a breaking change to `serializeProof` / `deserializeProof` output. Any persisted hex proofs from before this change are unreadable and must be regenerated. We accept this: there are no production proofs, only test vectors, which are regenerated as part of the scenario pipeline.
- We now own a non-obvious inversion (`collapsed = ~converge`). It is documented at both ends of the boundary and covered by round-trip tests, but it is a place where a future edit on one side without the other would silently corrupt proofs.

**Explicitly accepted trade-offs**
- `collapsed` is always 32 bytes on the wire even when a minimal integer would be shorter. Matching the spec and danubetech exactly is worth the handful of extra bytes; a variable-width encoding would reintroduce an interop ambiguity.

## Note: encoding fixed, verification still divergent

With the encoding now confirmed correct, danubetech's real example-12a proof still does **not** verify against our `SMTProof.isValid` under either `collapsed` interpretation. That isolates the open SMT interop issue to the **verification algorithm** (leaf formula, `didToIndex`, or the path bit-order of the walk), not the wire format. Our leaf is `SHA256(SHA256(nonce) || updateId)` at index `didToIndex(did)`. This is recorded here as the next thread to pull, separately from the serialization decision this ADR settles.

## References

- [`packages/smt/src/btcr2-proof.ts`](../../packages/smt/src/btcr2-proof.ts): `serializeProof` / `deserializeProof` with the `MASK_256` inversion.
- [`packages/smt/src/hash.ts`](../../packages/smt/src/hash.ts): `hashToBase64Url` / `base64UrlToHash`.
- [`packages/method/src/core/resolver.ts`](../../packages/method/src/core/resolver.ts): hex-keyed `smtMap`, `NeedSMTProof` normalization.
- [`packages/method/src/core/beacon/smt-beacon.ts`](../../packages/method/src/core/beacon/smt-beacon.ts) and [`aggregation/beacon-strategy.ts`](../../packages/method/src/core/aggregation/beacon-strategy.ts): base64url reads.
- [did:btcr2 SMT Proof data structure](https://dcdpr.github.io/did-btcr2/data-structures.html#smt-proof) and [dcdpr/did-btcr2#318](https://github.com/dcdpr/did-btcr2/issues/318) (the "Hexadecimal of" wording error).
- [ADR 017](017-optimized-smt-core-primitive.md): the Optimized SMT primitive whose serialization this ADR pins.
