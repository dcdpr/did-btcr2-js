# Interface: IDataIntegrityProof

Defined in: [data-integrity-proof/interface.ts:23](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/data-integrity-proof/interface.ts#L23)

Interface representing a BIP-340 DataIntegrityProof.
 IDataIntegrityProof

## Properties

### cryptosuite

> **cryptosuite**: [`Cryptosuite`](../classes/Cryptosuite.md)

Defined in: [data-integrity-proof/interface.ts:25](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/data-integrity-proof/interface.ts#L25)

## Methods

### addProof()

> **addProof**(`params`): `Promise`&lt;[`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)&gt;

Defined in: [data-integrity-proof/interface.ts:34](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/data-integrity-proof/interface.ts#L34)

Add a proof to a document.

#### Parameters

##### params

[`AddProofParams`](../type-aliases/AddProofParams.md)

Parameters for adding a proof to a document.

#### Returns

`Promise`&lt;[`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)&gt;

A document with a proof added.

***

### verifyProof()

> **verifyProof**(`params`): `Promise`&lt;[`VerificationResult`](VerificationResult.md)&gt;

Defined in: [data-integrity-proof/interface.ts:46](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/data-integrity-proof/interface.ts#L46)

Verify a proof.

#### Parameters

##### params

[`VerifyProofParams`](VerifyProofParams.md)

Parameters for verifying a proof.

#### Returns

`Promise`&lt;[`VerificationResult`](VerificationResult.md)&gt;

The result of verifying the proof.
