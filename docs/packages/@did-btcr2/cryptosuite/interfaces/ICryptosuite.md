# Interface: ICryptosuite

Defined in: [cryptosuite/interface.ts:50](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L50)

Interface representing a BIP-340 Cryptosuite.
 ICryptosuite

## Properties

### cryptosuite

> **cryptosuite**: `string`

Defined in: [cryptosuite/interface.ts:55](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L55)

***

### multikey

> **multikey**: [`SchnorrMultikey`](../classes/SchnorrMultikey.md)

Defined in: [cryptosuite/interface.ts:58](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L58)

***

### type

> **type**: `"DataIntegrityProof"`

Defined in: [cryptosuite/interface.ts:52](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L52)

## Methods

### createProof()

> **createProof**(`params`): `Promise`&lt;[`Proof`](../../common/interfaces/Proof.md)&gt;

Defined in: [cryptosuite/interface.ts:67](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L67)

Create a proof for an insecure document.

#### Parameters

##### params

[`CreateProofParams`](CreateProofParams.md)

See [CreateProofParams](CreateProofParams.md) for details.

#### Returns

`Promise`&lt;[`Proof`](../../common/interfaces/Proof.md)&gt;

The proof for the document.

***

### generateHash()

> **generateHash**(`params`): [`Hex`](../../common/type-aliases/Hex.md)

Defined in: [cryptosuite/interface.ts:93](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L93)

Generate a hash of the canonical proof configuration and document.

#### Parameters

##### params

[`GenerateHashParams`](GenerateHashParams.md)

See [GenerateHashParams](GenerateHashParams.md) for details.

#### Returns

[`Hex`](../../common/type-aliases/Hex.md)

The hash string of the proof configuration and document.

***

### proofConfiguration()

> **proofConfiguration**(`options`): `Promise`&lt;`string`&gt;

Defined in: [cryptosuite/interface.ts:101](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L101)

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

***

### proofSerialization()

> **proofSerialization**(`params`): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [cryptosuite/interface.ts:111](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L111)

Serialize the proof into a byte array.

#### Parameters

##### params

[`ProofSerializationParams`](ProofSerializationParams.md)

See [ProofSerializationParams](ProofSerializationParams.md) for details.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The serialized proof.

#### Throws

if the multikey does not match the verification method.

***

### proofVerification()

> **proofVerification**(`params`): `boolean`

Defined in: [cryptosuite/interface.ts:122](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L122)

Verify the proof by comparing the hash of the proof configuration and document to the proof bytes.

#### Parameters

##### params

[`ProofVerificationParams`](ProofVerificationParams.md)

See [ProofVerificationParams](ProofVerificationParams.md) for details.

#### Returns

`boolean`

True if the proof is verified, false otherwise.

#### Throws

if the multikey does not match the verification method.

***

### transformDocument()

> **transformDocument**(`params`): `Promise`&lt;`string`&gt;

Defined in: [cryptosuite/interface.ts:84](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L84)

Transform a document (secure didUpdateInvocation or insecure didUpdatePayload) into canonical form.

#### Parameters

##### params

[`TransformDocumentParams`](TransformDocumentParams.md)

See [TransformDocumentParams](TransformDocumentParams.md) for details.

#### Returns

`Promise`&lt;`string`&gt;

The canonicalized document.

#### Throws

if the document cannot be transformed.

***

### verifyProof()

> **verifyProof**(`document`): `Promise`&lt;[`VerificationResult`](VerificationResult.md)&gt;

Defined in: [cryptosuite/interface.ts:74](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/cryptosuite/interface.ts#L74)

Verify a proof for a secure document.

#### Parameters

##### document

[`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)

The secure document to verify.

#### Returns

`Promise`&lt;[`VerificationResult`](VerificationResult.md)&gt;

The result of the verification.
