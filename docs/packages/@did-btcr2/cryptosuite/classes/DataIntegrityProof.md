# Class: DataIntegrityProof

Defined in: [data-integrity-proof/index.ts:13](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/data-integrity-proof/index.ts#L13)

Implements section
[2.2.1 DataIntegrityProof](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#dataintegrityproof)
of the [Data Integrity BIP-340 Cryptosuite](https://dcdpr.github.io/data-integrity-schnorr-secp256k1) spec
 DataIntegrityProof

## Implements

- [`IDataIntegrityProof`](../interfaces/IDataIntegrityProof.md)

## Constructors

### Constructor

> **new DataIntegrityProof**(`cryptosuite`): `DataIntegrityProof`

Defined in: [data-integrity-proof/index.ts:22](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/data-integrity-proof/index.ts#L22)

Creates an instance of DataIntegrityProof.

#### Parameters

##### cryptosuite

[`Cryptosuite`](Cryptosuite.md)

The cryptosuite to use for proof generation and verification.

#### Returns

`DataIntegrityProof`

## Properties

### cryptosuite

> **cryptosuite**: [`Cryptosuite`](Cryptosuite.md)

Defined in: [data-integrity-proof/index.ts:15](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/data-integrity-proof/index.ts#L15)

#### Implementation of

[`IDataIntegrityProof`](../interfaces/IDataIntegrityProof.md).[`cryptosuite`](../interfaces/IDataIntegrityProof.md#cryptosuite)

## Methods

### addProof()

> **addProof**(`params`): `Promise`&lt;[`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)&gt;

Defined in: [data-integrity-proof/index.ts:33](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/data-integrity-proof/index.ts#L33)

Add a proof to a document.

#### Parameters

##### params

[`AddProofParams`](../type-aliases/AddProofParams.md)

Parameters for adding a proof to a document.

#### Returns

`Promise`&lt;[`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)&gt;

A document with a proof added.

#### Implementation of

[`IDataIntegrityProof`](../interfaces/IDataIntegrityProof.md).[`addProof`](../interfaces/IDataIntegrityProof.md#addproof)

***

### verifyProof()

> **verifyProof**(`params`): `Promise`&lt;[`VerificationResult`](../interfaces/VerificationResult.md)&gt;

Defined in: [data-integrity-proof/index.ts:74](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/data-integrity-proof/index.ts#L74)

Verify a proof.

#### Parameters

##### params

Parameters for verifying a proof.

###### document

`string`

The document to verify.

###### expectedChallenge?

`string`

The expected challenge of the proof.

###### expectedDomain?

`string`[]

The expected domain of the proof.

###### expectedPurpose

`string`

The expected purpose of the proof.

###### mediaType?

`string`

The media type of the document.

#### Returns

`Promise`&lt;[`VerificationResult`](../interfaces/VerificationResult.md)&gt;

The result of verifying the proof.

#### Implementation of

[`IDataIntegrityProof`](../interfaces/IDataIntegrityProof.md).[`verifyProof`](../interfaces/IDataIntegrityProof.md#verifyproof)
