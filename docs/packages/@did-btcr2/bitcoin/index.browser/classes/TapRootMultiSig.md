# Class: TapRootMultiSig

Defined in: [packages/bitcoin/src/taproot.ts:107](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L107)

TapRootMultiSig: builds Taproot outputs and trees for multisig and MuSig branches

## Constructors

### Constructor

> **new TapRootMultiSig**(`points`, `k`): `TapRootMultiSig`

Defined in: [packages/bitcoin/src/taproot.ts:112](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L112)

#### Parameters

##### points

`Uint8Array`&lt;`ArrayBufferLike`&gt;[]

##### k

`number`

#### Returns

`TapRootMultiSig`

## Properties

### defaultInternalPubkey

> `readonly` **defaultInternalPubkey**: `Uint8Array`

Defined in: [packages/bitcoin/src/taproot.ts:110](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L110)

***

### k

> `readonly` **k**: `number`

Defined in: [packages/bitcoin/src/taproot.ts:109](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L109)

***

### points

> `readonly` **points**: `Uint8Array`&lt;`ArrayBufferLike`&gt;[]

Defined in: [packages/bitcoin/src/taproot.ts:108](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L108)

## Methods

### degradingMultisigTree()

> **degradingMultisigTree**(`sequenceBlockInterval?`, `sequenceTimeInterval?`): `Payment`

Defined in: [packages/bitcoin/src/taproot.ts:213](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L213)

Degrading multisig: k-of-n initially, then (k-1)-of-n after delay, ... until 1-of-n

#### Parameters

##### sequenceBlockInterval?

`number`

##### sequenceTimeInterval?

`number`

#### Returns

`Payment`

***

### everythingTree()

> **everythingTree**(`locktime?`, `sequence?`): `Payment`

Defined in: [packages/bitcoin/src/taproot.ts:185](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L185)

Nested tree of singleLeaf, multiLeafTree, and musigTree

#### Parameters

##### locktime?

`number`

##### sequence?

`number`

#### Returns

`Payment`

***

### multiLeafTree()

> **multiLeafTree**(`locktime?`, `sequence?`): `Payment`

Defined in: [packages/bitcoin/src/taproot.ts:136](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L136)

All k-of-n multisig combinations as separate leaf scripts, combined into one tree

#### Parameters

##### locktime?

`number`

##### sequence?

`number`

#### Returns

`Payment`

***

### musigAndSingleLeafTree()

> **musigAndSingleLeafTree**(`locktime?`, `sequence?`): `Payment`

Defined in: [packages/bitcoin/src/taproot.ts:166](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L166)

A two-branch tree: one branch is the singleLeaf script, the other is the muSig tree

#### Parameters

##### locktime?

`number`

##### sequence?

`number`

#### Returns

`Payment`

***

### musigTree()

> **musigTree**(): `Payment`

Defined in: [packages/bitcoin/src/taproot.ts:151](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L151)

MuSig key-path scripts for each k-of-n combination in the script tree

#### Returns

`Payment`

***

### singleLeaf()

> **singleLeaf**(`locktime?`, `sequence?`): `Payment`

Defined in: [packages/bitcoin/src/taproot.ts:125](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/taproot.ts#L125)

Single multisig leaf as the only script path

#### Parameters

##### locktime?

`number`

##### sequence?

`number`

#### Returns

`Payment`
