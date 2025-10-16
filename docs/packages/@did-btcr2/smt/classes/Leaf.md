# Class: Leaf

Defined in: [leaf.ts:9](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/leaf.ts#L9)

## Implements

- [`Node`](../interfaces/Node.md)

## Constructors

### Constructor

> **new Leaf**(`value`, `sumValue`, `hasher`): `Leaf`

Defined in: [leaf.ts:12](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/leaf.ts#L12)

#### Parameters

##### value

`Uint8Array`

##### sumValue

`bigint`

##### hasher

[`HashStrategy`](../interfaces/HashStrategy.md)

#### Returns

`Leaf`

## Methods

### copy()

> **copy**(): [`Node`](../interfaces/Node.md)

Defined in: [leaf.ts:33](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/leaf.ts#L33)

copy performs a deep copy (or "computed" reference).
In real usage, you might store partial subtrees or do a shallow copy.

#### Returns

[`Node`](../interfaces/Node.md)

#### Implementation of

[`Node`](../interfaces/Node.md).[`copy`](../interfaces/Node.md#copy)

***

### getHash()

> **getHash**(): `Uint8Array`

Defined in: [leaf.ts:18](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/leaf.ts#L18)

getHash returns the Merkle hash of this node.

#### Returns

`Uint8Array`

#### Implementation of

[`Node`](../interfaces/Node.md).[`getHash`](../interfaces/Node.md#gethash)

***

### getSum()

> **getSum**(): `bigint`

Defined in: [leaf.ts:29](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/leaf.ts#L29)

getSum returns the 64-bit sum that this node contributes upward.

#### Returns

`bigint`

#### Implementation of

[`Node`](../interfaces/Node.md).[`getSum`](../interfaces/Node.md#getsum)

***

### isEmpty()

> **isEmpty**(): `boolean`

Defined in: [leaf.ts:43](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/leaf.ts#L43)

#### Returns

`boolean`
