# Class: Branch

Defined in: [branch.ts:7](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/branch.ts#L7)

## Implements

- [`Node`](../interfaces/Node.md)

## Constructors

### Constructor

> **new Branch**(`leftChild`, `rightChild`, `hasher`): `Branch`

Defined in: [branch.ts:11](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/branch.ts#L11)

#### Parameters

##### leftChild

[`Node`](../interfaces/Node.md)

##### rightChild

[`Node`](../interfaces/Node.md)

##### hasher

[`HashStrategy`](../interfaces/HashStrategy.md)

#### Returns

`Branch`

## Methods

### copy()

> **copy**(): [`Node`](../interfaces/Node.md)

Defined in: [branch.ts:41](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/branch.ts#L41)

copy performs a deep copy (or "computed" reference).
In real usage, you might store partial subtrees or do a shallow copy.

#### Returns

[`Node`](../interfaces/Node.md)

#### Implementation of

[`Node`](../interfaces/Node.md).[`copy`](../interfaces/Node.md#copy)

***

### getHash()

> **getHash**(): `Uint8Array`

Defined in: [branch.ts:17](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/branch.ts#L17)

getHash returns the Merkle hash of this node.

#### Returns

`Uint8Array`

#### Implementation of

[`Node`](../interfaces/Node.md).[`getHash`](../interfaces/Node.md#gethash)

***

### getLeftChild()

> **getLeftChild**(): [`Node`](../interfaces/Node.md)

Defined in: [branch.ts:57](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/branch.ts#L57)

#### Returns

[`Node`](../interfaces/Node.md)

***

### getRightChild()

> **getRightChild**(): [`Node`](../interfaces/Node.md)

Defined in: [branch.ts:61](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/branch.ts#L61)

#### Returns

[`Node`](../interfaces/Node.md)

***

### getSum()

> **getSum**(): `bigint`

Defined in: [branch.ts:32](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/branch.ts#L32)

getSum returns the 64-bit sum that this node contributes upward.

#### Returns

`bigint`

#### Implementation of

[`Node`](../interfaces/Node.md).[`getSum`](../interfaces/Node.md#getsum)
