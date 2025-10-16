# Class: SparseMerkleTree

Defined in: [smt.ts:11](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/smt.ts#L11)

## Constructors

### Constructor

> **new SparseMerkleTree**(`factory`, `treeHeight`): `SparseMerkleTree`

Defined in: [smt.ts:15](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/smt.ts#L15)

#### Parameters

##### factory

[`NodeFactory`](NodeFactory.md)

##### treeHeight

`number` = `256`

#### Returns

`SparseMerkleTree`

## Methods

### delete()

> **delete**(`key`): `void`

Defined in: [smt.ts:35](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/smt.ts#L35)

delete sets a leaf to the "empty" leaf node, effectively removing it.

#### Parameters

##### key

`Uint8Array`

#### Returns

`void`

***

### getRootHash()

> **getRootHash**(): `Uint8Array`

Defined in: [smt.ts:43](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/smt.ts#L43)

getRootHash returns the MS-SMT root hash after all insertions/deletions.

#### Returns

`Uint8Array`

***

### getRootSum()

> **getRootSum**(): `bigint`

Defined in: [smt.ts:50](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/smt.ts#L50)

getRootSum returns the sum of all leaves in the tree.

#### Returns

`bigint`

***

### insert()

> **insert**(`key`, `value`, `sum`): `void`

Defined in: [smt.ts:26](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/smt.ts#L26)

insert simulates placing a new leaf in the tree at the position
determined by the 256-bit key. We'll do a simple recursive approach:

#### Parameters

##### key

`Uint8Array`

##### value

`Uint8Array`

##### sum

`bigint`

#### Returns

`void`
