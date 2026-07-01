# @did-btcr2/key-manager

Key management interface for `did-btcr2-js`. Generate, import, sign, verify, and digest with stored secp256k1 keys.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

> **Renamed package.** Previously published as `@did-btcr2/kms`. The API surface is unchanged: only the import path moved. See [ADR-033](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/033-key-manager-package-rename.md) for the rationale.

## Summary

The `KeyManager` interface defines how the rest of the SDK obtains signatures without ever seeing raw secret bytes. This package ships `LocalKeyManager` (an in-process reference implementation) plus the `KeyManagerSigner` adapter that wraps any `KeyManager` into a `Signer` compatible with `@did-btcr2/method`.

- **`KeyManager`** is the interface every backend implements: `generateKey()`, `importKey()`, `sign()`, `verify()`, `digest()`, `getPublicKey()`, `getEntry()`, `removeKey()`, `listKeys()`, `setActiveKey()`, and the `activeKeyId` accessor, plus the optional `exportKey()` method guarded by the `canExport` capability flag (e.g. `canExport: false` for HSM-backed managers).
- **`LocalKeyManager`** holds `KeyEntry` records in memory: URN-style IDs, an active-key pointer, tag support for application metadata, and watch-only entries that store only the public key.
- **`KeyManagerSigner`** is the bridge to the DID update path. It implements the `Signer` interface from `@did-btcr2/keypair`, so the Updater and Beacon code see only the abstract `Signer` and never touch secret bytes.
- **Three signing schemes.** Same scheme matrix as `@did-btcr2/keypair`: `ecdsa` (DER, low-S) for Bitcoin inputs; `bip340` (raw Schnorr) for DI proofs; `bip341` (taproot-tweaked) for P2TR key-path signatures.

The signer can be constructed with or without an explicit `keyId`. Without one, it resolves to the key manager's active key at sign-time and caches its public key on first read. See ADR-034 for the capability pattern and active-key resolution semantics.

## Install

```bash
npm install @did-btcr2/key-manager
```

Or with pnpm:

```bash
pnpm add @did-btcr2/key-manager
```

Unlike `@did-btcr2/method` and `@did-btcr2/api` (ESM-only), this package ships both ESM and CJS builds. Requires Node >= 22.

## Key Exports

| Concern | Entry point |
|---|---|
| Backend interface | `KeyManager`, `KeyEntry`, `KeyIdentifier`, `SigningScheme`, `VerifyScheme` |
| Reference implementation | `LocalKeyManager` |
| `Signer` adapter | `KeyManagerSigner` |
| Storage abstraction | `KeyValueStore`, `MemoryStore` |
| Lifecycle options | `GenerateKeyOptions`, `ImportKeyOptions`, `SignOptions`, `VerifyOptions` |
| Key listing / active key | `listKeys()`, `activeKeyId` |

## Quick Start

```typescript
import { KeyManagerSigner, LocalKeyManager } from '@did-btcr2/key-manager';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

const km    = new LocalKeyManager();
const kp    = SchnorrKeyPair.generate();
const keyId = km.importKey(kp, { setActive: true, tags: { purpose: 'did-update' } });

// Sign through the KeyManagerSigner; secret bytes never leave the manager.
const signer = new KeyManagerSigner(km, keyId);

const sig = signer.sign(new Uint8Array(32), 'bip340');

// Watch-only entries are allowed: pubkey-only, sign() throws KEY_NOT_SIGNER.
const watchOnly = new SchnorrKeyPair({ publicKey: kp.publicKey });
const watchId   = km.importKey(watchOnly);
// new KeyManagerSigner(km, watchId).sign(data, 'bip340') -> KeyManagerError
```

### Building a custom backend

Implement the `KeyManager` interface and advertise capabilities. The minimum surface:

```typescript
import type { KeyManager, KeyEntry, SignOptions, VerifyOptions } from '@did-btcr2/key-manager';

class RemoteKeyManager implements KeyManager {
  readonly canExport = false;

  async generateKey(opts) { /* call into HSM, return KeyEntry */ }
  async importKey(kp, opts) { /* store, return KeyIdentifier */ }
  async sign(data, id?, options?: SignOptions) { /* call HSM, return SignatureBytes */ }
  async verify(signature, data, id?, options?: VerifyOptions) { /* ... */ }
  async digest(data) { /* ... */ }
  async getPublicKey(id) { /* ... */ }
  async getEntry(id) { /* return { publicKey, tags? } without secret bytes */ }
  async removeKey(id, opts?) { /* ... */ }
  async setActiveKey(id) { /* ... */ }
  async listKeys() { /* ... */ }
  // No exportKey(): capability flag tells callers not to try.
}
```

`@did-btcr2/api` and `@did-btcr2/method` both route signing through the `Signer` interface, so any backend that produces a `KeyManagerSigner` works end-to-end.

## Architecture Principles

- **Capability pattern.** The optional `exportKey` method is guarded by the `readonly canExport` boolean flag. Callers check the flag, not `instanceof`. Lets HSM/cloud-KMS backends advertise what they support without inheritance gymnastics.
- **No singleton.** Every `LocalKeyManager` is an independent instance; tests cannot leak keys via a shared global.
- **URN-style IDs.** Keys are addressed as `urn:kms:secp256k1:<fingerprint>` where the fingerprint is the first 16 bytes of SHA-256(pubkey), hex-encoded (32 hex chars). The identifier is derived from the public key so callers can recompute it from a watch-only import.
- **Active-key resolution is opt-in.** `new KeyManagerSigner(km)` without an explicit `keyId` is permitted but documented as a sharp edge: a swap via `setActiveKey()` causes `signer.sign(...)` to silently target the new key while the cached `signer.publicKey` still reflects the old one.

## Build & Test

```bash
# From packages/key-manager/
pnpm build              # Compile ESM + CJS + type declarations
pnpm build:tests        # Compile tests to tests/compiled/
pnpm test               # Run the test suite with coverage
pnpm lint               # ESLint (zero warnings tolerated)
```

## Documentation

- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **ADR-012** Dual signing and URN identifiers
- **ADR-033** Package rename to `@did-btcr2/key-manager`
- **ADR-034** Capability pattern for optional `KeyManager` methods
- **Source reference** See JSDoc on `KeyManager`, `LocalKeyManager`, `KeyManagerSigner`, and the `KeyEntry` type.

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
