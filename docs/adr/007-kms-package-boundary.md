---
title: "ADR 007: KMS Package Boundary"
---

# ADR 007: KMS Package Boundary

**Status:** Accepted

**Date:** 2025-10-28

**Commit:** [`0893492`](https://github.com/dcdpr/did-btcr2-js/commit/0893492)

## Context

Before this commit, key management logic lived inside `packages/method/src/core/key-manager/`, mixing three distinct concerns into one folder:

1. **Key primitives**: signing, verification, encoding. These belong to `@did-btcr2/keypair` (and, for Multikey-wrapped keys, to `@did-btcr2/cryptosuite`).
2. **Key lifecycle**: generate, import, list, track an "active" key, remove. Neither `keypair` nor `cryptosuite` had an opinion here.
3. **Method-specific key usage**: `SingletonBeacon` acquiring a keypair by `service.id` to sign a Bitcoin PSBT, for example. That's protocol code.

The mixing produced several concrete pains:

- **`method` couldn't be consumed without a key store.** Any code path that touched signing also needed the full key-manager apparatus, even for a pure-resolution consumer who never signed anything.
- **The key-management contract wasn't an interface.** The existing code was a concrete class with hard-coded in-memory storage. There was no seam where a consumer could plug in a hardware wallet, an HSM, a cloud KMS, or a browser-local IndexedDB store. "Just extend the class" was technically possible but required the consumer to understand internal concrete types that would obviously break on refactor.
- **Wallets have a distinct key-lifecycle story.** A wallet application wants to import an xpub subtree, derive child pubkeys without ever touching secret material, tag keys with derivation metadata, and ask the store "do you have the secret for this pubkey?" None of that is protocol-level did:btcr2 concern; all of it is key-lifecycle concern.
- **Test isolation was poor.** Key-manager state bled between tests because it was effectively singleton-ish inside method.

There was also a forward-looking concern: the team already knew that an HD-wallet app (Rolohex) would consume the did:btcr2 library, and that app would want to manage a thousand keys through a structured lifecycle: generate, import, tag, derive, rotate. Either the lifecycle primitives were going to live in a dedicated package with a clean interface, or every wallet consumer would grow its own adapter layer around the internals of `method`.

## Options considered

1. **Keep key management in `method`.** It's DID-specific anyway and every operation goes through `method`. Minimum disruption. Blocks HSM/hardware/cloud pluggability; keeps the key-lifecycle surface invisible from outside `method`; forces every consumer into the same in-memory store shape.
2. **Fold key management into `keypair`.** Same package owns everything key-related. But `keypair` is a primitive package: it owns "what is a secp256k1 key pair." Loading it with store abstractions and active-key bookkeeping contaminates a package whose strength is that it's small and crypto-only.
3. **Separate `@did-btcr2/kms` package with its own `KeyManager` interface and pluggable `KeyValueStore`.** Lifecycle concerns live in `kms`. Primitives stay in `keypair`. `method` consumes `kms` by interface, so consumers can swap in HSM/hardware/cloud without touching `method` at all.

## Decision

**Option 3.** On 2025-10-28 (commit `0893492`), `@did-btcr2/kms@0.1.0` is initialized. The package boundary is defined by:

- **A `KeyManager` interface**: the small set of operations that every key store must support: `generateKey`, `importKey`, `removeKey`, `listKeys`, `getPublicKey`, `sign`, `verify`, `digest`, plus an active-key concept (`activeKeyId`, `setActiveKey`). Pluggable implementations (HSM, hardware wallet, cloud KMS, browser-local) conform to this interface; downstream code (starting with `SingletonBeacon` acquiring keys by `service.id`) holds a `KeyManager` reference, not a concrete class.
- **A `KeyValueStore<K, V>` storage abstraction**: a small interface (`get`, `set`, `delete`, `has`, `clear`, `entries`) that the default `Kms` implementation uses for backing storage. `MemoryStore` is the default concrete implementation; IndexedDB, file-backed, or encrypted stores plug in by implementing the interface.
- **A sync-by-default shape.** Every `KeyManager` method is synchronous. This keeps the MVP tight and matches the noble/scure crypto primitives that are themselves synchronous. Asynchronous stores (cloud KMS, remote HSM) adapt by wrapping or by a separate `AsyncKeyManager` contract if that becomes necessary: deferred.
- **A deliberately minimal starting surface.** At inception, `Kms` supports import/generate/sign/verify, a single `KeyValueStore`, and a `Signer` class as a compatibility wrapper for PSBT signing (later removed by [ADR 012](012-kms-dual-signing-urn-identifiers.md)). Watch-only entries, tags, scheme options, URN identifiers, and dual Schnorr/ECDSA signing through one interface all come later: but they come as *refinements on top of this package*, not as changes to `method` or `keypair`.
- **Method integration is via `service.id`.** `SingletonBeacon` acquires a keypair from KMS using the beacon service's ID as the lookup. The method package holds no key state of its own.

The package-graph consequence is clean: `kms` depends on `keypair` (for the `SchnorrKeyPair` return shape) and `common` (for shared types). `method` depends on `kms`. Consumers who never sign: pure resolvers: never import `kms`.

## Consequences

**Positive**
- The three concerns separate cleanly. `keypair` stays a small crypto-primitive package. `kms` owns lifecycle and storage. `method` uses keys without owning them.
- Hardware/HSM/cloud pluggability is a first-class capability. A consumer writes a `YubiHsmKeyManager implements KeyManager` and drops it in; `method` and `api` don't know or care.
- The wallet use case has a real place to live. Watch-only entries, key tagging, and HD-derivation metadata: all deferred from v0.1.0 but unblocked by the package existing: become refinements rather than renegotiations of package boundaries.
- Test isolation improves. Each test instantiates a `Kms` with a fresh `MemoryStore`; no cross-test state.
- Pure-resolution consumers shed a dependency. A DID verifier library that never signs doesn't pull `kms`, its store abstraction, or anything that transitively depends on those.

**Negative**
- One more package to version, publish, maintain, and document.
- The `KeyManager` interface starts minimal. Watch-only entries, per-key tags, scheme-selectable signing, and URN-style identifiers had to be added later ([ADR 012](012-kms-dual-signing-urn-identifiers.md)). The minimum-viable-interface choice at inception meant later additive breaking changes to that interface. An alternative was to design the full interface upfront, but doing so without real use cases would have produced speculative shape.
- Sync-by-default locks out remote/async backends from conforming to `KeyManager` directly. Async adapters have to wrap or mimic. An `AsyncKeyManager` contract is a deferred future problem; the sync shape is correct for the 90% case today.

**Explicitly accepted trade-offs**
- **No async variant at inception.** Cloud-KMS and remote-HSM backends wrap async I/O behind sync facades or spawn their own protocol. The simplicity of a sync interface outweighs the hypothetical benefit of shipping both variants from day one.
- **No access-control policy inside KMS.** `exportKey`, `removeKey`, `sign` are ungated at the package level. Policy enforcement (who can sign what, audit logs, rate limiting) is the responsibility of a consumer wrapping `KeyManager`: the package provides the primitive, not the governance.
- **No BIP-32 derivation in KMS.** HD-key derivation is the wallet layer's responsibility. KMS stores keys; wallet derives them and imports the result with metadata tags. [ADR 012](012-kms-dual-signing-urn-identifiers.md) later formalizes the watch-only + tags primitives that make this clean.
- **No key rotation primitive.** Rotation is delete-old + import-new with a rotation tag on the new entry if needed. A first-class `rotateKey()` method would embed a specific rotation lineage model that doesn't map to every consumer's rotation policy.

## References

- [`packages/kms/src/interface.ts`](../../packages/kms/src/interface.ts): `KeyManager` interface and supporting types.
- [`packages/kms/src/kms.ts`](../../packages/kms/src/kms.ts): default `Kms` implementation.
- [`packages/kms/src/store.ts`](../../packages/kms/src/store.ts): `KeyValueStore<K,V>` interface, `MemoryStore`.
- [`packages/method/src/core/beacon/singleton-beacon.ts`](../../packages/method/src/core/beacon/singleton-beacon.ts): `SingletonBeacon` acquires keys through the `KeyManager` interface.
- [ADR 001](001-monorepo-package-boundaries.md): monorepo structure; `kms` is a layer-one package between `keypair` and `method`.
- [ADR 012](012-kms-dual-signing-urn-identifiers.md): later refactor: dual-scheme signing, URN identifiers, watch-only `KeyEntry`. Builds on the boundary decision made here.
