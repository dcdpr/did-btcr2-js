# Interface: DidUpdateInvocation

Defined in: [packages/common/src/interfaces.ts:107](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L107)

An extension of [DID Update Payload](DidUpdatePayload.md) containing a
Data Integrity proof that authorizes the update. Once signed, the spec calls
this an 'invoked DID Update Payload' or 'didUpdateInvocation'.

DID BTCR2
[4.3.2 Invoke DID Update Payload](https://dcdpr.github.io/did-btcr2/#invoke-did-update-payload)
and
[9.4 Root did:btcr2 Update Capabilities](https://dcdpr.github.io/did-btcr2/#root-didbtcr2-update-capabilities).

## Extends

- [`DidUpdatePayload`](DidUpdatePayload.md)

## Properties

### @context

> **@context**: `string`[]

Defined in: [packages/common/src/interfaces.ts:59](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L59)

JSON-LD context URIs for interpreting this payload, including contexts
for ZCAP (capabilities), Data Integrity proofs, and JSON-LD patch ops.

#### Inherited from

[`DidUpdatePayload`](DidUpdatePayload.md).[`@context`](DidUpdatePayload.md#context)

***

### patch

> **patch**: [`JsonPatch`](../type-aliases/JsonPatch.md)

Defined in: [packages/common/src/interfaces.ts:66](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L66)

A JSON Patch (or JSON-LD Patch) object defining the mutations to apply to
the DID Document. Applying this patch to the current DID Document yields
the new DID Document (which must remain valid per DID Core spec).

#### Inherited from

[`DidUpdatePayload`](DidUpdatePayload.md).[`patch`](DidUpdatePayload.md#patch)

***

### proof

> **proof**: [`Proof`](Proof.md)

Defined in: [packages/common/src/interfaces.ts:108](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L108)

A proof object (Data Integrity proof) that authorizes this update.
It is a JSON-LD proof indicating a capability invocation on the DID's
root capability, typically signed with the DID's verification key (using
Schnorr secp256k1 in did:btcr2).

#### Overrides

[`DidUpdatePayload`](DidUpdatePayload.md).[`proof`](DidUpdatePayload.md#proof)

***

### sourceHash

> **sourceHash**: `string`

Defined in: [packages/common/src/interfaces.ts:73](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L73)

The multihash of the current (source) DID Document, encoded as a multibase
base58-btc string. This is a SHA-256 hash of the canonicalized source DID
Document, used to ensure the patch is applied to the correct document state.

#### Inherited from

[`DidUpdatePayload`](DidUpdatePayload.md).[`sourceHash`](DidUpdatePayload.md#sourcehash)

***

### targetHash

> **targetHash**: `string`

Defined in: [packages/common/src/interfaces.ts:80](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L80)

The multihash of the updated (target) DID Document, encoded as multibase
base58-btc. This is the SHA-256 hash of the canonicalized
DID Document after applying the patch, used to verify the update result.

#### Inherited from

[`DidUpdatePayload`](DidUpdatePayload.md).[`targetHash`](DidUpdatePayload.md#targethash)

***

### targetVersionId

> **targetVersionId**: `number`

Defined in: [packages/common/src/interfaces.ts:86](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L86)

The version number of the DID Document after this update.
It is equal to the previous document version + 1.

#### Inherited from

[`DidUpdatePayload`](DidUpdatePayload.md).[`targetVersionId`](DidUpdatePayload.md#targetversionid)
