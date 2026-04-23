---
title: "ADR 014: Canonicalization as Standalone Functions, toJSON() Convention, and base64urlnopad Default"
---

# ADR 014: Canonicalization as Standalone Functions, toJSON() Convention, and base64urlnopad Default

**Status:** Accepted

**Date:** 2026-03-17

**Commit:** [`11477d3`](https://github.com/dcdpr/did-btcr2-js/commit/11477d3)

## Context

Three concerns around object-to-bytes conversion came due at the same time and were resolved together in the `@did-btcr2/common` v6.0.0 refactor:

1. **Canonicalization shape.** A `Canonicalization` class had accumulated static methods (`canonicalize`, `hash`, `encodeHash`, `decodeHash`) plus a small amount of state: options, cached output: that nothing actually used. It was a class in name only, and the import shape (`Canonicalization.canonicalize(obj)`) was noisier than a free function for a fundamentally stateless pipeline.

2. **JCS + class instances + `toJSON()`.** JCS (RFC 8785) sorts object keys before serialization, and its implementation enumerates the object's own enumerable keys. When a class instance is passed in, those are the class's *instance fields*, not the JSON shape the class advertises via `toJSON()`. Two class instances with identical public JSON shapes could therefore hash to different canonical bytes because their internal field sets differed. This turned up as sporadic hash-mismatch bugs when a DID document was passed through canonicalization as a class instance in one path and as a JSON round-trip in another.

3. **Encoding policy.** The previous canonicalization utilities only exposed hex and a base58 encoder named `base58btc`. The did:btcr2 spec uses `base64urlnopad` as the default encoding for document hashes, and distinguishes between raw base58 (`base58`) and base58 with a multibase prefix (`base58btc`). The existing code conflated the two. `multiformats` was in the dependency graph purely for encoding strings, which is a heavy package for a lightweight need.

Two smaller issues rode along:

- The `@context` URI was set to `https://www.w3.org/TR/did-1.1` (a human-readable spec page), not `https://www.w3.org/ns/did/v1.1` (the versioned namespace URI). Technically a bug, conceptually an encoding/serialization concern.
- A `HashHex` type and several unused constants (`CURVE`, `CONTEXT_URL_MAP`, `RpcConfig`, `OP_RETURN`, BIP340 prefix bytes) lived in `common/src/constants.ts` without any consumers in `common`.

## Options considered

1. **Keep the class; patch the JCS bug by requiring callers to pass POJOs; keep hex/base58btc; skip base64url.** Minimal churn. Leaves callers responsible for remembering to round-trip class instances before canonicalization: exactly the kind of invariant that will be forgotten in some code path and surface as a bug months later.
2. **Functional API (`canonicalize`, `hash`, `encode`, `decode`, `canonicalHash`); fix the JCS bug inside `canonicalize`; swap `multiformats` for `@scure/base`; add `base64urlnopad` as default encoding.** Addresses every concern directly, aligns with browser-compat policy ([ADR 019](019-browser-compat-and-noble.md)).
3. **Option 2 + elevate `toJSON()` as a package-wide serialization contract.** Codifies that every class with a canonicalization-relevant representation implements `toJSON()`, and that the canonical hash pipeline always passes through a `JSON.parse(JSON.stringify(...))` round-trip before JCS.

## Decision

**Option 3.** Four coordinated changes:

- **Canonicalization as standalone functions** in `common/src/canonicalization.ts`: `canonicalize(object, algorithm='jcs')`, `hash(canonicalized)`, `encode(bytes, encoding='base64urlnopad')`, `decode(encoded, encoding='base64urlnopad')`, `canonicalHash(object, options?)`, `canonicalHashBytes(object)`. No class, no state, no imports under a class namespace.
- **JCS round-trip fix.** Inside `canonicalize()`:
  ```ts
  const plain = JSON.parse(JSON.stringify(object));
  return jcsa(plain);
  ```
  The stringify/parse pair forces the input through `toJSON()` if present, producing a plain object whose own enumerable keys are exactly the class's advertised JSON shape. JCS then sorts and serializes those keys deterministically. Class instances and hand-built POJOs with identical public shapes now hash identically: which is the invariant the cryptosuite and resolver depend on.
- **Encoding defaults and library swap.** `base64urlnopad` is the default for `encode()` / `decode()` / `canonicalHash()`. `base58` is raw base58 (no multibase `z` prefix); `base58btc` as a name is removed from the canonicalization layer (multibase prefixing stays the keypair package's responsibility, since the prefix bytes are BIP340-specific). `multiformats` is replaced by `@scure/base`: same author as `@noble/*`, smaller, browser-first, consistent with the broader dependency policy.
- **`toJSON()` convention.** Every class across packages with a canonicalization-relevant representation implements `toJSON()`: `Btcr2DidDocument`, `Multikey`, `SignedBTCR2Update`, `CompressedSecp256k1PublicKey`, `SchnorrKeyPair`, and so on. `toJSON()` returns the stable, hashable JSON shape. Instance fields are private (`#field`) or not enumerable, so they don't leak into canonicalization even when a caller forgets the round-trip. For secret-bearing classes, `toJSON()` returns a redacted shape and a separate `exportJSON()` returns secret material explicitly (see [ADR 015](015-keypair-security-hardening-noble-migration.md) for the keypair application of this rule).

Carried along with the refactor:
- `@context` corrected to `https://www.w3.org/ns/did/v1.1`.
- `common/src/constants.ts` deleted; truly unused symbols removed, BIP340 prefixes moved into the keypair package where they're actually used, `HashHex` removed as unused.

## Consequences

**Positive**
- One canonicalization path. Callers don't have to know whether their input is a class instance, a POJO, or a mixed object graph; the pipeline handles all three identically.
- Tree-shakeable: consumers importing `canonicalize` don't pay for `decode`, and vice versa. The class form bundled everything.
- `base64urlnopad` is the default everywhere. Spec-compliant output by default; hex/base58 remain available as explicit overrides.
- `toJSON()` as a package-wide convention means any future class can be passed to canonicalization and "just work": the invariant is a single line of code in `canonicalize()` plus a `toJSON()` on the class.
- `@scure/base` aligns with the noble/scure stack already in use ([ADR 019](019-browser-compat-and-noble.md)); dropping `multiformats` removes a large dependency with a wide surface area that was being used for a narrow task.

**Negative**
- Breaking change. Every caller of the old `Canonicalization` class updates imports. The rename surface is small and contained to the `common` package's public exports, so the migration is mechanical.
- The `JSON.parse(JSON.stringify(...))` round-trip is an extra allocation per canonicalization call. Measured overhead is under a millisecond on DID documents of realistic size; protocol rates don't care.
- `toJSON()` is a convention, not a type-system guarantee. A class without `toJSON()` still canonicalizes: it just canonicalizes against its own enumerable fields, which is the old bug. Code review is the enforcement mechanism; a future lint rule could check for `toJSON()` on classes passed to canonicalization.

**Explicitly accepted trade-offs**
- **No padding tolerance in `base64urlnopad.decode()`.** Input with trailing `=` is rejected outright. The did:btcr2 spec mandates `base64urlnopad`; silently stripping padding would tolerate non-conformant producers and delay the bug instead of surfacing it. Cross-implementation interop is handled by byte comparisons (`equalBytes()`) on decoded `Uint8Array` instances, not by loosening the encoding.
- **No RDF canonicalization yet.** `CanonicalizationAlgorithm` is a typed union including `'rdfc'`, but only `'jcs'` is implemented. RDFC support would add a large dependency; JCS is sufficient for every current codepath, and the spec defaults to JCS. When a consumer needs RDFC, the function-based API makes adding a second branch straightforward.
- **`toJSON()` is not forced by the type system.** A class could implement `toJSON()` wrong: returning a shape that doesn't round-trip through `fromJSON()`, or omitting a field. The canonicalization pipeline doesn't check. Tests and code review catch these; a `Serializable<T>` interface could formalize the contract if it ever becomes a recurring source of bugs.

## References

- [`packages/common/src/canonicalization.ts`](../../packages/common/src/canonicalization.ts): standalone `canonicalize`, `hash`, `encode`, `decode`, `canonicalHash`, `canonicalHashBytes`.
- [`packages/common/src/index.ts`](../../packages/common/src/index.ts): public exports after the refactor.
- [ADR 002](002-jcs-canonicalization-and-cryptosuite.md): JCS as the canonicalization algorithm for `bip340-jcs-2025`.
- [ADR 019](019-browser-compat-and-noble.md): `@scure/base` / `@noble/*` dependency policy.
- [ADR 015](015-keypair-security-hardening-noble-migration.md): `toJSON()` applied to secret-bearing classes with redacted output and a separate `exportJSON()` path.
- did:btcr2 spec [JSON Document Hashing](https://dcdpr.github.io/did-btcr2/algorithms.html#json-document-hashing): the canonicalize to hash to encode pipeline this implements.
