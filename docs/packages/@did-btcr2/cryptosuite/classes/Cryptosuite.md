# Class: Cryptosuite

Defined in: [cryptosuite/index.ts:54](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L54)

Implements [3.1 Instantiate Cryptosuite](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#instantiate-cryptosuite)

The Instantiate Cryptosuite algorithm is used to configure a cryptographic suite to be used by the Add Proof and
Verify Proof functions in Verifiable Credential Data Integrity 1.0. The algorithm takes an options object
(map options) as input and returns a cryptosuite instance (struct cryptosuite).

1) Initialize cryptosuite to an empty struct.
2) If options.type does not equal DataIntegrityProof, return cryptosuite.
3) If options.cryptosuite is bip340-rdfc-2025:
   3.1) Set cryptosuite.createProof to the algorithm in Section 3.2.1 Create Proof (bip340-rdfc-2025).
   3.2) Set cryptosuite.verifyProof to the algorithm in Section 3.2.2 Verify Proof (bip340-rdfc-2025).
4) If options.cryptosuite is bip340-jcs-2025:
   4.2) Set cryptosuite.createProof to the algorithm in Section 3.3.1 Create Proof (bip340-jcs-2025).
   4.3) Set cryptosuite.verifyProof to the algorithm in Section 3.3.2 Verify Proof (bip340-jcs-2025).
5) Return cryptosuite.

 Cryptosuite

## Implements

- [`ICryptosuite`](../interfaces/ICryptosuite.md)

## Constructors

### Constructor

> **new Cryptosuite**(`params`): `Cryptosuite`

Defined in: [cryptosuite/index.ts:88](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L88)

Constructs an instance of Cryptosuite.

#### Parameters

##### params

[`CryptosuiteParams`](../interfaces/CryptosuiteParams.md)

See [CryptosuiteParams](../interfaces/CryptosuiteParams.md) for required parameters to create a cryptosuite.

#### Returns

`Cryptosuite`

## Properties

### algorithm

> **algorithm**: `"rdfc"` \| `"jcs"`

Defined in: [cryptosuite/index.ts:80](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L80)

The algorithm used for canonicalization

***

### cryptosuite

> **cryptosuite**: `"bip340-jcs-2025"` \| `"bip340-rdfc-2025"`

Defined in: [cryptosuite/index.ts:66](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L66)

The name of the cryptosuite

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`cryptosuite`](../interfaces/ICryptosuite.md#cryptosuite)

***

### multikey

> **multikey**: [`SchnorrMultikey`](SchnorrMultikey.md)

Defined in: [cryptosuite/index.ts:73](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L73)

The multikey used to sign and verify proofs

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`multikey`](../interfaces/ICryptosuite.md#multikey)

***

### type

> **type**: `"DataIntegrityProof"` = `'DataIntegrityProof'`

Defined in: [cryptosuite/index.ts:59](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L59)

The type of the proof

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`type`](../interfaces/ICryptosuite.md#type)

## Methods

### createProof()

> **createProof**(`params`): `Promise`&lt;[`Proof`](../../common/interfaces/Proof.md)&gt;

Defined in: [cryptosuite/index.ts:115](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L115)

Create a proof for an insecure document.

#### Parameters

##### params

[`CreateProofParams`](../interfaces/CreateProofParams.md)

See [CreateProofParams](../interfaces/CreateProofParams.md) for details.

#### Returns

`Promise`&lt;[`Proof`](../../common/interfaces/Proof.md)&gt;

The proof for the document.

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`createProof`](../interfaces/ICryptosuite.md#createproof)

***

### generateHash()

> **generateHash**(`params`): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [cryptosuite/index.ts:226](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L226)

Generate a hash of the canonical proof configuration and document.

#### Parameters

##### params

[`GenerateHashParams`](../interfaces/GenerateHashParams.md)

See [GenerateHashParams](../interfaces/GenerateHashParams.md) for details.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The hash string of the proof configuration and document.

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`generateHash`](../interfaces/ICryptosuite.md#generatehash)

***

### proofConfiguration()

> **proofConfiguration**(`options`): `Promise`&lt;`string`&gt;

Defined in: [cryptosuite/index.ts:246](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L246)

Configure the proof by canonicalzing it.

#### Parameters

##### options

[`ProofOptions`](../../common/interfaces/ProofOptions.md)

The options to use when transforming the proof.

#### Returns

`Promise`&lt;`string`&gt;

The canonicalized proof configuration.

#### Throws

if the proof configuration cannot be canonicalized.

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`proofConfiguration`](../interfaces/ICryptosuite.md#proofconfiguration)

***

### proofSerialization()

> **proofSerialization**(`params`): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [cryptosuite/index.ts:277](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L277)

Serialize the proof into a byte array.

#### Parameters

##### params

[`ProofSerializationParams`](../interfaces/ProofSerializationParams.md)

See [ProofSerializationParams](../interfaces/ProofSerializationParams.md) for details.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The serialized proof.

#### Throws

if the multikey does not match the verification method.

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`proofSerialization`](../interfaces/ICryptosuite.md#proofserialization)

***

### proofVerification()

> **proofVerification**(`params`): `boolean`

Defined in: [cryptosuite/index.ts:299](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L299)

Verify the proof by comparing the hash of the proof configuration and document to the proof bytes.

#### Parameters

##### params

[`ProofVerificationParams`](../interfaces/ProofVerificationParams.md)

See [ProofVerificationParams](../interfaces/ProofVerificationParams.md) for details.

#### Returns

`boolean`

True if the proof is verified, false otherwise.

#### Throws

if the multikey does not match the verification method.

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`proofVerification`](../interfaces/ICryptosuite.md#proofverification)

***

### toDataIntegrityProof()

> **toDataIntegrityProof**(): [`DataIntegrityProof`](DataIntegrityProof.md)

Defined in: [cryptosuite/index.ts:100](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L100)

Constructs an instance of DataIntegrityProof from the current Cryptosuite instance.

#### Returns

[`DataIntegrityProof`](DataIntegrityProof.md)

A new DataIntegrityProof instance.

***

### transformDocument()

> **transformDocument**(`params`): `Promise`&lt;`string`&gt;

Defined in: [cryptosuite/index.ts:192](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L192)

Transform a document (secure didUpdateInvocation or insecure didUpdatePayload) into canonical form.

#### Parameters

##### params

[`TransformDocumentParams`](../interfaces/TransformDocumentParams.md)

See [TransformDocumentParams](../interfaces/TransformDocumentParams.md) for details.

#### Returns

`Promise`&lt;`string`&gt;

The canonicalized document.

#### Throws

if the document cannot be transformed.

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`transformDocument`](../interfaces/ICryptosuite.md#transformdocument)

***

### verifyProof()

> **verifyProof**(`document`): `Promise`&lt;[`VerificationResult`](../interfaces/VerificationResult.md)&gt;

Defined in: [cryptosuite/index.ts:158](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/index.ts#L158)

Verify a proof for a secure document.
Implements [ICryptosuite Method verifyProof](../interfaces/ICryptosuite.md#verifyproof).

#### Parameters

##### document

[`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)

The secure document to verify.

#### Returns

`Promise`&lt;[`VerificationResult`](../interfaces/VerificationResult.md)&gt;

The result of the verification.

#### Implementation of

[`ICryptosuite`](../interfaces/ICryptosuite.md).[`verifyProof`](../interfaces/ICryptosuite.md#verifyproof)
