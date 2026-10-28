# @did-btcr2/cryptosuite

TypeScript implementation of the [Data Integrity BIP340 Cryptosuite v0.1](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/) specification.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package produces and verifies method-agnostic [Data Integrity](https://www.w3.org/TR/vc-data-integrity/) proofs; its primary consumer is did:btcr2, whose updates it authenticates. A secured document is any JSON object plus a `proof` block carrying a BIP-340 Schnorr signature over the JCS-canonicalized payload.

- **`BIP340Cryptosuite`** creates and verifies proofs for the `bip340-jcs-2025` suite (JCS-canonicalized hashing). `createProof` and `verifyProof` are the Create Proof and Verify Proof algorithms of the suite. The cryptosuite hashes the proof configuration and the canonical document, and it calls a `Signer` for the signature.
- **`BIP340DataIntegrityProof`** runs the Add Proof and Verify Proof algorithms of [VC Data Integrity 1.0](https://www.w3.org/TR/vc-data-integrity/#algorithms) with a `BIP340Cryptosuite`. `addProof` returns a copy of the document with the proof. `verifyProof` reads the JSON text of a secured document and returns a `VerificationResult`. A failed check before the cryptosuite verification gives `verified: false` and one error in the result. If the cryptosuite gives `verified: false`, the result has no error.
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

The package ships both ESM (`dist/esm/`) and CJS (`dist/cjs/`) via conditional exports, so it works with `import` and `require` out of the box.

## Key Exports

| Concern | Entry point |
|---|---|
| Build / verify proofs | `BIP340Cryptosuite`, `Cryptosuite`, `CryptosuiteVerificationResult` |
| Proof primitive | `BIP340DataIntegrityProof`, `DataIntegrityProof`, `DataIntegrityProofObject`, `VerificationResult` |
| Document payload types | `UnsecuredDocument`, `SecuredDocument` |
| Verification method wrapper | `SchnorrMultikey`, `Multikey`, `MultikeyObject` |
| Construction helpers | `FromSecretKey`, `FromPublicKey` |
| Proof options | `DataIntegrityProofOptions` |

## Quick Start

### Sign an update

```typescript
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { Secp256k1SecretKey } from '@did-btcr2/keypair';

const controller   = 'did:btcr2:k1q5p...';
const id           = '#initialKey';
const secretKeyBytes = new Secp256k1SecretKey(rawSecretBytes).bytes; // 32-byte Uint8Array
const multikey     = SchnorrMultikey.fromSecretKey(id, controller, secretKeyBytes);

// UnsecuredDocument: any JSON object to add a proof to (for example, an unsigned did:btcr2 update).
const unsigned = {
  '@context' : ['https://w3id.org/json-ld-patch/v1', 'https://w3id.org/zcap/v1', 'https://w3id.org/security/data-integrity/v2', 'https://btcr2.dev/context/v1'],
  // ... the other members of the document
};
const config = {
  type               : 'DataIntegrityProof' as const,
  cryptosuite        : 'bip340-jcs-2025',
  proofPurpose       : 'capabilityInvocation',
  verificationMethod : `${controller}${id}`,
};
const proof = multikey.toCryptosuite().createProof(unsigned, config);
// proof.cryptosuite === 'bip340-jcs-2025'
// proof['@context'] is a copy of unsigned['@context']. createProof does not change unsigned or config.
```

`createProof` copies the document `@context` into the proof. Options with an `@context` for a document with no `@context` give a `CryptosuiteError` of type `PROOF_GENERATION_ERROR`, because Verify Proof can never verify such a proof.

### Verify a signed update

```typescript
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';

// Reconstruct the multikey from the DID verification method.
// verificationMethod is a DidVerificationMethod with id, controller, publicKeyMultibase.
const multikey = SchnorrMultikey.fromVerificationMethod(verificationMethod);
const result   = multikey.toCryptosuite().verifyProof(signedUpdate);

if (!result.verified) {
  throw new Error('DI proof failed');
}
// result.verifiedDocument is the update without its proof.
```

`verifyProof` throws a `CryptosuiteError` if the verification cannot complete, for example for a proof member that breaks a rule. See [Verification results and refusals](#verification-results-and-refusals).

### Sign via an external Signer (HSM, KMS, hardware wallet)

```typescript
import { SchnorrMultikey } from '@did-btcr2/cryptosuite';

// kmsSigner implements Signer: { publicKey: Uint8Array; sign(data, scheme): SignatureBytes }
const controller = 'did:btcr2:k1q5p...';
const id         = '#initialKey';
const multikey   = SchnorrMultikey.fromSigner(id, controller, kmsSigner);

// unsigned is the document of "Sign an update", with its @context.
const config = {
  type               : 'DataIntegrityProof' as const,
  cryptosuite        : 'bip340-jcs-2025',
  proofPurpose       : 'capabilityInvocation',
  verificationMethod : `${controller}${id}`,
};
const proof = multikey.toCryptosuite().createProof(unsigned, config);
```

`fromSigner` seeds the multikey's public key from `kmsSigner.publicKey` and delegates all signing to the signer, so no secret bytes ever enter the JS process. A public-key mismatch at construction time throws immediately.

## Verification results and refusals

The cryptosuite follows the algorithms of [VC Data Integrity 1.0](https://www.w3.org/TR/vc-data-integrity/#algorithms) and of the `bip340-jcs-2025` suite (ADR 158). No function of this section changes its input.

### Verify with the cryptosuite

`BIP340Cryptosuite.verifyProof(securedDocument)` returns a `CryptosuiteVerificationResult`: `{ verified, verifiedDocument }`. If `verified` is `true`, `verifiedDocument` is the document without its `proof`. Else `verifiedDocument` is `null`. If the document `@context` does not start with the proof `@context`, the result is `verified: false`.

`verifyProof` throws a `CryptosuiteError` if the verification cannot complete. The result is then an error, not `verified: false`.

| Error type | Cause |
|---|---|
| `PARSING_ERROR` | The secured document or its `proof` is not a JSON object. |
| `PROOF_VERIFICATION_ERROR` | A proof member breaks a rule of [Proof members](#proof-members). |
| `PROOF_VERIFICATION_ERROR` | The `proofValue` is not the base58btc Multibase text (prefix `z`) of 64 bytes. |
| `PROOF_VERIFICATION_ERROR` | The `type`, the `cryptosuite`, or the `verificationMethod` is not the one of the cryptosuite instance. |
| `PROOF_GENERATION_ERROR` | `created` is not an XML Schema `dateTime`, or the proof has no JCS form. |
| `PROOF_TRANSFORMATION_ERROR` | The document has no JCS form. |

The `proofValue` must be the canonical base58btc text of its 64 bytes. The base58btc decoder also reads some other text for the same bytes, for example text with a character above U+00FF. `verifyProof` refuses such text.

### Verify with the Data Integrity layer

`BIP340DataIntegrityProof.verifyProof(document, expectedPurpose?, mediaType?, expectedDomain?, expectedChallenge?)` is the Verify Proof algorithm of VC Data Integrity 1.0. `document` is the JSON text of the secured document. Each expected value is optional, and the function compares only a value that you give. `expectedDomain` is one string or an array of strings.

The result is a `VerificationResult`: `{ verified, verifiedDocument, mediaType, warnings, errors }`. A failed check of the table below gives `verified: false` and one `ProblemDetails` (RFC 9457) in `errors`. The `type` of the item is `https://w3id.org/security#<TYPE>`. `<TYPE>` is the error type of the failed check. If the signature does not verify, or if the document `@context` does not start with the proof `@context`, `verified` is `false` and `errors` is empty.

| Check | Error type if the check fails |
|---|---|
| The secured document and its `proof` are JSON objects. | `PARSING_ERROR` |
| The proof has a `type`, a `verificationMethod`, and a `proofPurpose`. | `PROOF_VERIFICATION_ERROR` |
| The proof has no `previousProof`. This suite does not verify a proof chain. | `PROOF_VERIFICATION_ERROR` |
| `proofPurpose` is `expectedPurpose`. | `PROOF_VERIFICATION_ERROR` |
| The proof `domain` and `expectedDomain` hold the same strings. A string is a set of one string. The order and a repeated string have no effect. | `INVALID_DOMAIN_ERROR` |
| `challenge` is `expectedChallenge`. | `INVALID_CHALLENGE_ERROR` |

If `document` is not JSON text, `verifyProof` throws a `DataIntegrityProofError` of type `PARSING_ERROR`. The function does not catch an error of `BIP340Cryptosuite.verifyProof`.

### Proof members

`createProof` and `verifyProof` check the members of a proof (VC Data Integrity 1.0, Proofs) before the algorithm. For a member that breaks a rule, `createProof` throws a `CryptosuiteError` of type `PROOF_GENERATION_ERROR`. `verifyProof` throws a `CryptosuiteError` of type `PROOF_VERIFICATION_ERROR`.

| Member | Rule |
|---|---|
| `type`, `cryptosuite`, `verificationMethod`, `proofPurpose` | A string. Each of these members is necessary. |
| `id` | A [valid URL string](https://url.spec.whatwg.org/#valid-url-string) of the URL Standard. Thus `#key-0`, `proof-1`, and `urn:uuid:...` are valid. `not a url` is not valid. |
| `created` | On create: an XML Schema `dateTimeStamp` (a `dateTime` with a timezone). On verify, the Proof Configuration step needs an XML Schema `dateTime`, else it throws `PROOF_GENERATION_ERROR`. |
| `expires` | On create: an XML Schema `dateTimeStamp`. On verify: an XML Schema `dateTime`. |
| `domain` | A string or an array of strings. On create, the array must not have a repeated string. |
| `challenge`, `nonce` | A string. |
| `previousProof` | A string or an array of strings. |

### Refusals on create

`BIP340Cryptosuite.createProof(document, options)` returns a new proof: a copy of the options with the `proofValue`. If the document has an `@context`, the proof gets a copy of it in place of an `@context` of the options. `createProof` throws a `CryptosuiteError` of type `PROOF_GENERATION_ERROR` in these cases:

- the document is not a JSON object
- the options have a `proofValue`, because `createProof` adds the `proofValue`
- the options have an `@context`, and the document has no `@context`
- a proof member breaks a rule of [Proof members](#proof-members)
- the signer returns a signature that does not have 64 bytes

`BIP340DataIntegrityProof.addProof(document, options)` returns `{ ...document, proof }`. Before it calls `createProof`, it refuses these inputs with a `DataIntegrityProofError` of type `PROOF_GENERATION_ERROR`:

- a document that has a `proof`
- options with a `previousProof`

This suite adds one proof. It does not make a proof set or a proof chain (VC Data Integrity 1.0, Add Proof Set/Chain).

## Architecture Principles

- **Canonicalization is the contract.** All proofs hash the JCS-canonicalized payload. `@did-btcr2/common` owns the canonicalization function; the cryptosuite just calls it.
- **A value with no JCS form gets no proof.** A document with no JCS form (RFC 8785), for example a document that holds NaN or a lone surrogate, gets no proof. `createProof` and `verifyProof` throw a `CryptosuiteError` of type `PROOF_TRANSFORMATION_ERROR` for such a document, or of type `PROOF_GENERATION_ERROR` for such proof options (ADR 154). `createProof` checks the proof configuration first, and the proof gets the document `@context`. Thus a document `@context` with no JCS form gives `PROOF_GENERATION_ERROR`. `verifyProof` applies the [proof member rules](#proof-members) before JCS, so a `nonce` of NaN gives `PROOF_VERIFICATION_ERROR`.
- **Signer-agnostic.** Proof construction takes a `Signer`. `LocalSigner`, `KeyManagerSigner`, and arbitrary user-provided implementations all work without code changes in this package.
- **Strict construction.** A `SchnorrMultikey` constructed with a mismatched `keyPair` and `externalSigner` rejects at construction. A multibase string with the wrong `[0xe7, 0x01]` prefix rejects in `fromVerificationMethod`. `fromVerificationMethod` also refuses a `publicKeyMultibase` that does not decode, or that is not the canonical base58btc text of its bytes. The error is a `MultikeyError` of type `VERIFICATION_METHOD_ERROR`.
- **No `bitcoinjs-lib`.** Curve, Schnorr, and hash operations delegate to `@noble/curves` and `@noble/hashes`. Proof encoding uses `multiformats` (base58btc), and verification-method types come from `@web5/dids`.

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

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
