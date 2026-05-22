# @did-btcr2/keypair

TypeScript implementation of secp256k1 key pairs and three signing schemes used by did:btcr2.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package wraps the secp256k1 primitives from `@noble/curves` into the key types and signing abstraction used by every higher-level package (`@did-btcr2/cryptosuite`, `@did-btcr2/key-manager`, `@did-btcr2/method`).

- **`SchnorrKeyPair`** owns a `Secp256k1SecretKey` plus a `CompressedSecp256k1PublicKey`. Generate fresh, import from raw bytes, hex, or JSON.
- **`CompressedSecp256k1PublicKey`** exposes the 33-byte compressed form, the 32-byte x-only form, and the multibase-encoded form (`zQ3s...`) used in DID verification methods.
- **`Secp256k1SecretKey`** holds the 32-byte raw secret with validation against the curve order.
- **`LocalSigner`** is the in-process signer that backs the `Signer` interface. It supports all three signing schemes the DID method needs.

### Signing schemes

| Scheme | Wire format | Used for |
|---|---|---|
| `'ecdsa'` | DER-encoded, low-S, no prehash | P2PKH / P2WPKH / P2SH-P2WPKH input signatures (BIP-143 sighash) |
| `'bip340'` | 64-byte raw Schnorr | Data Integrity proofs over DID updates (untweaked) |
| `'bip341'` | 64-byte Schnorr over taproot-tweaked key | P2TR input signatures (BIP-341 key-path) |

The `bip341` path applies `taprootTweakPrivKey(secret, merkleRoot)` before signing so the produced signature verifies against the tweaked output internal key `Q = P + tG`.

## Install

```bash
npm install @did-btcr2/keypair
```

Or with pnpm:

```bash
pnpm add @did-btcr2/keypair
```

## Key Exports

| Concern | Entry point |
|---|---|
| Generate a fresh keypair | `SchnorrKeyPair.generate()` |
| Import from bytes / hex / JSON | `SchnorrKeyPair.fromSecret()`, `.fromJSON()` |
| Watch-only pair (pubkey only) | `new SchnorrKeyPair({ publicKey })` |
| Sign with explicit scheme | `LocalSigner`, `signWithScheme(secret, data, scheme)` |
| Signer interface | `Signer`, `SigningScheme`, `SignOptions` |
| Public key types | `CompressedSecp256k1PublicKey`, `PublicKey`, `Point` |
| Secret key type | `Secp256k1SecretKey`, `SecretKey` |
| Multibase prefix | `BIP340_PUBLIC_KEY_MULTIBASE_PREFIX` (`[0xe7, 0x01]`) |

## Quick Start

```typescript
import { LocalSigner, SchnorrKeyPair, signWithScheme } from '@did-btcr2/keypair';

// Generate a fresh keypair.
const kp = SchnorrKeyPair.generate();

// Compressed pubkey + x-only pubkey + multibase form.
const compressed = kp.publicKey.compressed;   // 33 bytes
const xOnly      = kp.publicKey.x;            // 32 bytes
const multibase  = kp.publicKey.multibase;    // 'zQ3s...'

// Build a Signer and sign with the appropriate scheme.
const signer = new LocalSigner(kp.secretKey.bytes);
const data   = new Uint8Array(32);

const sigEcdsa  = signer.sign(data, 'ecdsa');    // for P2PKH/P2WPKH/P2SH inputs
const sigBip340 = signer.sign(data, 'bip340');   // for DI proofs
const sigBip341 = signer.sign(data, 'bip341', { merkleRoot: new Uint8Array(0) });
```

## Architecture Principles

- **Noble-only crypto.** All curve and Schnorr operations come from `@noble/curves`. No `bitcoinjs-lib`, no `elliptic`, no `node:crypto`. Browser-compatible by construction.
- **No silent fallbacks.** A `LocalSigner` constructed without a secret throws on `sign()`; a watch-only key throws on `secretKey` access. Failures surface at the boundary they happen at.
- **Single signing entry point.** `signWithScheme()` is the one function that knows how to produce each scheme; both `LocalSigner` and the key manager delegate to it.

## Build & Test

```bash
# From packages/keypair/
pnpm build              # Compile ESM + CJS + type declarations
pnpm build:tests        # Compile tests to tests/compiled/
pnpm test               # Run the test suite with coverage
pnpm lint               # ESLint (zero warnings tolerated)
```

## Documentation

- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **BIP-340 (Schnorr Signatures)** [bitcoin/bips/bip-0340](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki)
- **BIP-341 (Taproot)** [bitcoin/bips/bip-0341](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki)
- **ADR-015** Keypair security hardening + Noble migration
- **Source reference** See JSDoc on `SchnorrKeyPair`, `LocalSigner`, and `signWithScheme`.
