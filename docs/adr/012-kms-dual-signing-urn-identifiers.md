---
title: "ADR 012: KMS Dual Signing, URN Identifiers, and Watch-Only KeyEntry"
---

# ADR 012: KMS Dual Signing Schemes, URN-Style Key Identifiers, and Watch-Only KeyEntry

**Status:** Accepted

**Date:** 2026-03-13

**Commit:** [`656de39`](https://github.com/dcdpr/did-btcr2-js/commit/656de39)

## Context

The KMS (`@did-btcr2/kms`) sits at the junction of two different signature needs in did:btcr2:

- **DID-update proofs** use BIP340 Schnorr signatures (per the `bip340-jcs-2025` cryptosuite: see [ADR 002](002-jcs-canonicalization-and-cryptosuite.md)).
- **Bitcoin transaction inputs** use ECDSA for non-Taproot spends. Taproot key-path spends use Schnorr, but the PSBT signer API still dispatches ECDSA in many paths.

Prior to v0.4.0, the `KeyManager` interface exposed a single `sign()` method that was Schnorr-only. To produce ECDSA signatures for Bitcoin PSBT inputs, the KMS shipped a separate `Signer` class that held a keypair plus a `NetworkName` and produced ECDSA output through a second path. The `SingletonBeacon` imported both `Kms` (for update-proof signing) and `Signer` (for PSBT signing), which bled `NetworkName`: a concern that belongs in the Bitcoin/transaction layer: into the KMS package.

Three other issues compounded the problem:

1. **Singleton state.** `Kms` kept a static `#instance` with a `static initialize()` entry point. Tests leaked state between specs because nothing ever reset the singleton; order-dependence hid bugs.
2. **Raw `KeyBytes` storage.** The store value type was `KeyBytes` (32-byte secret key). There was no representation for a *watch-only* entry: public-key-only: which future HD-wallet callers (e.g. the planned Rolohex app, see Rolohex context memory) need in order to import an xpub subtree and derive child public keys without signing capability.
3. **Pubkey hex as `KeyIdentifier`.** The default key identifier was the compressed pubkey as a hex string. That has three failure modes: it leaks key material into logs and error messages (e.g. `"Key not found: 02a1b2..."`), it couples key identity to key material (so rotation changes identity), and it collides visually with DID-document key-IDs elsewhere in the codebase.

Each of these individually was tolerable. Together, the KMS interface could not honestly serve a production wallet.

## Options considered

1. **Keep `Signer` for ECDSA, keep the singleton, keep raw `KeyBytes`.** Zero migration cost, but every downstream consumer still has to import both `Kms` and `Signer` for any non-Schnorr signing, and the test-isolation and watch-only gaps remain.
2. **Add a `scheme` option to `sign()` / `verify()` but leave the singleton and storage format alone.** Removes the need for `Signer` but leaves test-isolation and HD-wallet concerns unaddressed.
3. **Overhaul: add `scheme` option, kill the singleton, replace `KeyBytes` storage with a structured `KeyEntry`, issue URN-style identifiers, and make `exportKey` concrete-only.**

## Decision

**Option 3.** The v0.4.0 changes, taken together:

- **`SignOptions.scheme: 'schnorr' | 'ecdsa'`** added to `KeyManager.sign()` and `verify()`, defaulting to `schnorr`. One interface handles both signature schemes; `Secp256k1SecretKey.sign(data, { scheme })` in the keypair package already supports both, so this is a pass-through.
- **`Signer` class removed.** `SingletonBeacon` now uses an inline PSBT signer object derived from the keypair for ECDSA PSBT signing. `@did-btcr2/bitcoin` and `@did-btcr2/cryptosuite` are no longer KMS dependencies.
- **Singleton removed.** `static #instance`, `static initialize()`, `static getKey()` are gone. The API layer (see [ADR 024](024-api-facade-lazy-and-layered-config.md)) holds a `KeyManager` instance in its config: no global state.
- **`KeyEntry` replaces raw `KeyBytes`** as the store's value type:
  ```ts
  type KeyEntry = {
    secretKey?: KeyBytes;                 // absent for watch-only
    publicKey: KeyBytes;                  // always present
    tags?: Record<string, string>;        // arbitrary metadata
  };
  ```
  `sign()` throws `KEY_NOT_SIGNER` for watch-only entries. `tags` gives HD-wallet callers a place for derivation path, account, chain, DID association without the KMS knowing about BIP-32.
- **URN-style identifiers.** Auto-generated IDs are `urn:kms:secp256k1:<fingerprint>` where the fingerprint is the first 8 bytes of SHA-256(compressed pubkey), hex-encoded. Callers can still supply custom IDs via `ImportKeyOptions.id`. For HD keys, callers can pass derivation-aware IDs such as `urn:kms:secp256k1:<master-fp>/86h/0h/0h/0/3`.
- **`ApiConfig.kms` type narrowed** from concrete `Kms` to `KeyManager`. Custom KMS implementations (HSM, hardware-backed) can now plug in at the API layer.
- **`exportKey` kept on concrete `Kms` only**, not on `KeyManager`. HSM-backed implementations cannot export key material; forcing them to implement `exportKey` would make the interface a lie. Software callers who know they're holding a `Kms` instance can call it directly for backup/migration.
- **`importKey` / `generateKey` default `setActive: false`.** Importing a second key no longer silently switches the active key.
- **`has()` added to `KeyValueStore`** so `#exists()` can be a real check rather than `get()` + truthiness.

## Consequences

**Positive**
- One signing interface for both Schnorr (DID proofs) and ECDSA (Bitcoin PSBT). `SingletonBeacon` no longer juggles two KMS import shapes.
- Watch-only entries unlock HD-wallet integrations without requiring BIP-32 awareness inside the KMS.
- URN identifiers are human-scannable, don't leak key material into logs/errors, and survive key rotation cleanly.
- Tests are isolated: each spec constructs its own `Kms` instance; no cross-spec order-dependence.
- `@did-btcr2/kms` no longer depends on `@did-btcr2/bitcoin` or `@did-btcr2/cryptosuite`, tightening the dependency graph (see [ADR 001](001-monorepo-package-boundaries.md)).

**Negative**
- Breaking change for downstream consumers. Any caller of `Signer`, `Kms.initialize()`, or `Kms.getKey()` must migrate.
- `exportKey` being concrete-only means the API-layer `KeyManagerApi.export()` uses `instanceof Kms` to decide whether export is available. The coupling is intentional (see the trade-off below), but `instanceof` checks are always a smell in a library facade.
- `tags` is a `Record<string, string>`: stringly-typed metadata. Future work may tighten this into a discriminated union of known tag shapes if a small, stable set emerges.

**Explicitly accepted trade-offs**
- **No key-rotation primitive.** `updateKey()` / rotate-in-place is deliberately out of scope. Callers delete the old key and import the new one; tags can encode rotation lineage if needed. Building a first-class rotation API without a real production use case would lock in the wrong shape.
- **BIP-32 derivation stays in the wallet layer, not KMS.** `importKey()` takes a `SchnorrKeyPair`; how that keypair was derived (generated fresh, imported from an xpub subtree, read from a hardware wallet) is the caller's concern. This keeps KMS usable for non-HD use cases and avoids baking xpub semantics into a key-lifecycle package.
- **`exportKey` is not part of `KeyManager`.** Software-only callers who need backup/migration keep a typed `Kms` reference and call `exportKey` directly. HSM-backed implementations of `KeyManager` are free to throw, return a wrapped/encrypted blob, or simply not expose export at all.
- **No per-operation access control.** `exportKey` is ungated at this layer. Access control (policy, auth, audit log) is the responsibility of a higher layer wrapping the KMS: typically the API facade or a custom wrapper in the deploying app.

## References

- [`packages/kms/src/interface.ts`](../../packages/kms/src/interface.ts): `KeyManager`, `SignOptions`, `KeyEntry`, `ImportKeyOptions`, `GenerateKeyOptions`.
- [`packages/kms/src/kms.ts`](../../packages/kms/src/kms.ts): `Kms` class, URN fingerprint generation, watch-only handling.
- [`packages/kms/src/store.ts`](../../packages/kms/src/store.ts): `KeyValueStore<K,V>` with `has()`, `MemoryStore` default.
- [`packages/method/src/core/beacon/singleton-beacon.ts`](../../packages/method/src/core/beacon/singleton-beacon.ts): inline PSBT signer replacing the old `Signer` class.
- [ADR 001](001-monorepo-package-boundaries.md): dependency-graph discipline that this refactor tightened.
- [ADR 024](024-api-facade-lazy-and-layered-config.md): API-layer configuration that now holds the `KeyManager` instance instead of the singleton.
