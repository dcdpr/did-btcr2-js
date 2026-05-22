# @did-btcr2/cryptosuite

TypeScript implementation of the [Data Integrity BIP340 Cryptosuite v0.1](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/) specification.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package produces and verifies the [Data Integrity](https://www.w3.org/TR/vc-data-integrity/) proofs that authenticate every did:btcr2 update. A signed update is a JSON document plus a `proof` block carrying a BIP-340 Schnorr signature over the JCS-canonicalized payload.

- **`BIP340Cryptosuite`** creates and verifies proofs for the `bip340-jcs-2025` suite (JCS-canonicalized hashing). The RDF Dataset Canonicalization variant (`bip340-rdfc-2025`) shares the same code path with a different canonicalization step.
- **`BIP340DataIntegrityProof`** is the proof-construction primitive: builds the proof config, hashes the canonical bytes, calls into a `Signer` for the actual signature, and assembles the final proof block.
- **`SchnorrMultikey`** is the verification-method wrapper used in DID documents. It binds a `SchnorrKeyPair` to its multibase encoding (`zQ3s...`), supports watch-only verification, and accepts an injected `Signer` so production code never has to pass raw secret bytes.

The cryptosuite is what links the abstract `Signer` interface from `@did-btcr2/keypair` to the on-disk shape of a signed DID update.

## Install

```bash
npm install @did-btcr2/cryptosuite
```

Or with pnpm:

```bash
pnpm add @did-btcr2/cryptosuite
```

## Key Exports

| Concern | Entry point |
|---|---|
| Build / verify proofs | `BIP340Cryptosuite`, `Cryptosuite`, `VerificationResult` |
| Proof primitive | `BIP340DataIntegrityProof`, `DataIntegrityProof`, `DataIntegrityProofObject` |
| Update payload types | `UnsignedBTCR2Update`, `SignedBTCR2Update`, `BTCR2Update` |
| Verification method wrapper | `SchnorrMultikey`, `Multikey`, `MultikeyObject` |
| Construction helpers | `FromSecretKey`, `FromPublicKey`, `FromPublicKeyMultibaseParams` |
| Cryptosuite config | `DataIntegrityConfig` |

## Quick Start

### Sign an update

```typescript
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

const kp        = SchnorrKeyPair.generate();
const multikey  = SchnorrMultikey.fromSecretKey({
  did : 'did:btcr2:k1q5p...',
  id  : '#initialKey',
  keyPair: kp,
});

const unsigned = { /* UnsignedBTCR2Update: patches + targetHash */ };
const signed   = multikey.toCryptosuite().createProof(unsigned);
// signed.proof.cryptosuite === 'bip340-jcs-2025'
```

### Verify a signed update

```typescript
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';

// Reconstruct the multikey from the DID verification method.
const multikey = SchnorrMultikey.fromVerificationMethod(verificationMethod);
const result   = multikey.toCryptosuite().verifyProof(signedUpdate);

if (!result.verified) {
  throw new Error(`DI proof failed: ${result.error?.message}`);
}
```

### Sign via an external Signer (HSM, KMS, hardware wallet)

```typescript
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';

const multikey = SchnorrMultikey.fromPublicKey({
  did     : 'did:btcr2:k1q5p...',
  id      : '#initialKey',
  keyPair : watchOnlyKeyPair,        // public key only
  externalSigner: kmsSigner,         // any Signer implementation
});

const signed = multikey.toCryptosuite().createProof(unsigned);
```

The cryptosuite validates that `externalSigner.publicKey` matches the pair at construction time, so a mismatch throws immediately.

## Architecture Principles

- **Canonicalization is the contract.** All proofs hash the JCS-canonicalized payload. `@did-btcr2/common` owns the canonicalization function; the cryptosuite just calls it.
- **Signer-agnostic.** Proof construction takes a `Signer`. `LocalSigner`, `KeyManagerSigner`, and arbitrary user-provided implementations all work without code changes in this package.
- **Strict construction.** A `SchnorrMultikey` constructed with a mismatched `keyPair` and `externalSigner` rejects at construction. A multibase string with the wrong `[0xe7, 0x01]` prefix rejects in `fromVerificationMethod`.
- **No `bitcoinjs-lib`.** Curve, Schnorr, and hash operations all delegate to `@noble/curves` and `@noble/hashes`.

## Build & Test

```bash
# From packages/cryptosuite/
pnpm build              # Compile ESM + CJS + type declarations
pnpm build:tests        # Compile tests to tests/compiled/
pnpm test               # Run the test suite with coverage
pnpm lint               # ESLint (zero warnings tolerated)
```

## Documentation

- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **Cryptosuite specification** [dcdpr.github.io/data-integrity-schnorr-secp256k1](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/)
- **W3C Data Integrity** [w3.org/TR/vc-data-integrity](https://www.w3.org/TR/vc-data-integrity/)
- **ADR-002** JCS canonicalization and cryptosuite choice
- **Source reference** See JSDoc on `BIP340Cryptosuite`, `BIP340DataIntegrityProof`, and `SchnorrMultikey`.
