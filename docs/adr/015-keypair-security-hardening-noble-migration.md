---
title: "ADR 015: Keypair Security Hardening and Noble / Scure Migration"
---

# ADR 015: Keypair Security Hardening and Noble / Scure Migration

**Status:** Accepted

**Date:** 2026-03-20

**Commit:** [`5a9fbe5`](https://github.com/dcdpr/did-btcr2-js/commit/5a9fbe5)

## Context

`@did-btcr2/keypair` holds the project's most security-sensitive primitives: secp256k1 secret keys, the schnorr signing path used by DID-update proofs, and the PSBT signing path used by Bitcoin outputs. Prior to v0.11.0 the package had two distinct classes of problem.

**Library-stack concerns:**

- **`tiny-secp256k1`** was the secp256k1 implementation. It's a WASM wrapper around `libsecp256k1`: fast, but ~200 KB, with all the usual concerns of a bundled binary: harder to audit, non-trivial browser bundle impact, and a build-time compilation step in some package managers.
- **`multiformats`** supplied base encoding, but the package has a far wider surface than we needed (CID parsing, codec registries, DAG helpers). Only the base-encoding subset was in use. Aligning with the broader noble/scure stance ([ADR 019](019-browser-compat-and-noble.md)) would consolidate encoding on `@scure/base`.

**Security and API concerns (not all visible at the type level, but all live):**

- **No zeroization.** Secret key bytes were never cleared from memory when a keypair went out of scope. The `#bytes` field held on until GC, during which anything with a reference (including accidental `console.log`) could still read the key.
- **Timing-sensitive equality.** `equals()` did a byte-wise compare that short-circuited on the first mismatch. In a threat model where an attacker can observe relative timing of equality checks (rare for a pure library, but free to fix), this leaks information.
- **No defensive copies in the constructor.** The caller's `Uint8Array` was stored directly. If the caller later wrote into that array, the keypair's internal state changed from under it.
- **`toJSON()` exposed secret material.** `JSON.stringify(keypair)` serialized the secret key bytes in full. `console.log(keypair)` produced the same: any logging framework touching the object spilled the secret.
- **Constructor accepted mismatched `secretKey` / `publicKey` silently.** Passing a public key derived from a different secret would succeed; the keypair would then happily sign with the secret but advertise the wrong public key, producing signatures that failed verification against the advertised key.
- **`fromJSON()` mutated the caller's input** by calling `shift()` on the bytes array: a side effect with no warning in the signature.
- **Public-key-only pairs threw from basic getters.** The `raw`, `hex`, and `publicKey` setter paths all assumed a secret key was present, even on a keypair constructed with `publicKey` only.
- **`fromBigInt()` went via hex.** Converting a bigint to a key by stringifying to hex then parsing back was fragile: any formatting drift or leading-zero handling bug could produce a subtly wrong key.
- **Dead API.** `fromBytes()`, static `point()`, `toKeyPair()`, `fromSecretKey()` had zero callers anywhere in the monorepo.

The keypair package is too close to the crypto boundary to leave any of these alone.

## Options considered

1. **Incremental security fixes, keep `tiny-secp256k1`.** Address the security issues in-place; skip the library migration. Leaves the WASM / bundle-size concerns, and we miss the opportunity to consolidate on audited pure-JS primitives.
2. **Full rewrite: migrate to `@noble/curves` v2 + `@scure/base`, apply all security fixes together, break circular dependencies, remove dead code.** Everything in one breaking release. Higher risk of introducing new bugs during the rewrite; mitigated by the test expansion (50 to 80 tests, 77% to 90% statement coverage).

## Decision

**Option 2.** The v0.11.0 release ships all of the following as one coordinated change, versioned as a breaking release:

**Library stack:**
- Replace `tiny-secp256k1` with `@noble/curves` v2 (`secp256k1`, `schnorr` from `@noble/curves/secp256k1`). Pure JS, audited, ~9 KB minified: roughly 95% smaller than the WASM predecessor.
- Replace `multiformats` with `@scure/base` for hex / base58 / base64url encoding. Same author as `@noble/*`, consistent policy.
- Replace the `CURVE` constant from `@did-btcr2/common` with `secp256k1.Point.Fn.ORDER` from noble: one source of truth for curve parameters.

**Secret-key hardening (`Secp256k1SecretKey`):**
- `destroy()` zeroes the `#bytes` buffer, clears `#seed`, clears `#multibase`. The instance is unusable after `destroy()`: an explicit opt-in erase for callers who know a key's lifetime is ending.
- Constructor defensively copies the input `Uint8Array` (`new Uint8Array(entropy)`) before storing.
- Constructor validates that both representations match when both `secretKey` and `publicKey` are passed: mismatched pairs throw `CONSTRUCTOR_ERROR` immediately.
- `equals()` delegates to `equalBytes()` from `@noble/curves/utils`, which is a timing-safe byte compare.
- `toJSON()` returns `{ type: 'Secp256k1SecretKey' }`: no secret material. `exportJSON()` is the explicit escape hatch for callers that genuinely need to serialize the secret.
- `toString()` returns `'[Secp256k1SecretKey]'`. `[Symbol.for('nodejs.util.inspect.custom')]` returns the same. `console.log(secretKey)` can no longer leak the key.
- `random()` uses a retry loop on `secp256k1.utils.isValidSecretKey` to guarantee the result is in the valid scalar range `[1, n)`. Rejection-sampling rather than modular reduction, matching noble's own approach.
- `fromBigInt()` delegates to `toBytes()` directly: no hex round-trip.

**Keypair hardening (`SchnorrKeyPair`):**
- Watch-only (public-key-only) pairs no longer throw from `raw`, `hex`, or the `publicKey` setter.
- `hasSecretKey` predicate added so callers can branch cleanly on watch-only vs. full pairs (used by [ADR 012](012-kms-dual-signing-urn-identifiers.md)'s watch-only `KeyEntry`).
- `toJSON()` returns `{ publicKey: ... }` only: consistent with the `toJSON()` convention from [ADR 014](014-canonicalization-functions-and-toJSON-convention.md) where safe shapes are the default and secret material requires an explicit `exportJSON()` call.
- `[Symbol.for('nodejs.util.inspect.custom')]` returns `"[SchnorrKeyPair <publicKey.hex>]"`: identifies the pair by its public key without spilling the secret.
- `exportJSON()` throws `SERIALIZE_ERROR` on public-key-only pairs rather than silently returning partial data.
- `fromJSON()` no longer mutates the caller's input array.
- Circular dependency broken: `pair.ts` no longer calls back into `secret.ts` via `toKeyPair()` / `fromSecretKey()`; `types.ts` uses `import type` consistently.
- Dead API removed: `fromBytes()`, static `point()`, `toKeyPair()`, `fromSecretKey()`.
- `equals()` signature widened to accept the `PublicKey` / `SecretKey` interfaces rather than concrete classes, decoupling downstream callers from the specific implementation.
- Redundant cached fields removed: `#publicKeyMultibase`, `#secretKeyMultibase`. The `multibase` getter computes on demand; the caching saved nothing measurable and complicated the defensive-copy story.
- `BIP340_PUBLIC_KEY_MULTIBASE_PREFIX` now exported from `public.ts` (moved out of `@did-btcr2/common` along with the deletion of `common/src/constants.ts`: see [ADR 014](014-canonicalization-functions-and-toJSON-convention.md)).

**Test expansion:**
- 50 to 80 tests.
- 77% to 90% statement coverage. 44% to 80% function coverage.
- New tests: sign/verify round-trip across schemes, `fromJSON` round-trip, public-key-only getter coverage, mismatched-key rejection, `decode()` edge cases, `destroy()` behavior, serialization guards (`toJSON`, `toString`, inspect hook).

## Consequences

**Positive**
- The most security-sensitive package in the graph is now built on audited pure-JS primitives with a ~95% smaller footprint, and without a WASM runtime in the browser bundle.
- Four classes of accidental-leak vectors (`console.log`, `JSON.stringify`, `util.inspect`, `toString`) now return redacted output by default. The path to leak secret material is narrow and explicit: call `exportJSON()`.
- Constructor validation catches a whole family of silent-failure bugs (mismatched secret/public keypairs) at the point of construction instead of at signature-verification time.
- `destroy()` gives callers a tool to shorten secret-key lifetimes. Not a full memory-safety story: Uint8Arrays are still GC'd heap memory and an attacker with process memory access has other options: but it's a meaningful defense-in-depth improvement for long-lived processes.
- Watch-only pairs are a real first-class shape, which unlocks the HD-wallet story in [ADR 012](012-kms-dual-signing-urn-identifiers.md).

**Negative**
- Breaking release. Callers that serialized keypairs via `JSON.stringify` now get the redacted shape; they must switch to `exportJSON()` to retain behavior. The change is deliberate: silent serialization of secrets was the bug: but it is breaking.
- Removed APIs (`fromBytes`, static `point`, `toKeyPair`, `fromSecretKey`) need migration in any out-of-tree caller. In-tree, every caller was updated as part of the same commit; `grep` confirmed zero internal callers before removal.
- `destroy()` can only zero the bytes held by the instance. Any caller that pulled bytes out via `.bytes` has a copy that `destroy()` cannot reach. This is a fundamental limitation of defensive-copy semantics and is called out below.

**Explicitly accepted trade-offs**
- **`destroy()` is not transitive.** The `bytes` getter returns a defensive copy: good for preventing external mutation, but it means `destroy()` clears the instance's internal copy and leaves any previously-returned copy untouched. Callers who need true memory wiping either work against the instance directly or manage their own copies. The library-level tool does what the library can do; the rest is caller discipline.
- **Timing-safe equality applies only at the byte-compare layer.** Signing paths (`sign`, `verify`) are as timing-safe as `@noble/curves` makes them; the library does not add a second layer of timing-normalization. This matches the broader stance that we trust `@noble/*` at its security claims (see [ADR 019](019-browser-compat-and-noble.md)).
- **No formal threat model for the Node.js runtime.** JavaScript garbage collection, V8 internal buffers, and heap dumps are all out of scope. A caller operating in a hostile host has bigger problems than whether one library zeroes its buffers. This ADR's security posture targets the realistic threats: accidental logging, accidental serialization, accidental introspection, and timing-sensitive equality: not adversarial memory access.
- **The `libsecp256k1` performance lead held by `tiny-secp256k1` is given up.** For the operation rates this library sees (tens to hundreds of signatures per DID operation, not thousands per second), the `@noble/curves` JS implementation is fast enough. Auditability, bundle size, and toolchain simplicity win over microbenchmarks.

## References

- [`packages/keypair/src/secret.ts`](../../packages/keypair/src/secret.ts): `Secp256k1SecretKey` with `destroy()`, defensive copies, redacted `toJSON()`, inspect guards.
- [`packages/keypair/src/pair.ts`](../../packages/keypair/src/pair.ts): `SchnorrKeyPair` with `hasSecretKey`, redacted `toJSON()`, explicit `exportJSON()`, constructor pair validation.
- [`packages/keypair/src/public.ts`](../../packages/keypair/src/public.ts): `CompressedSecp256k1PublicKey`, BIP340 prefix now owned here.
- [ADR 019](019-browser-compat-and-noble.md): broader `@noble/*` / `@scure/*` policy this migration aligns with.
- [ADR 012](012-kms-dual-signing-urn-identifiers.md): watch-only `KeyEntry` that depends on public-key-only pairs being first-class here.
- [ADR 014](014-canonicalization-functions-and-toJSON-convention.md): `toJSON()` convention applied consistently to secret-bearing classes.
