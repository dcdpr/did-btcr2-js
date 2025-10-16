# Interface: Node

Defined in: [node.ts:4](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/node.ts#L4)

## Methods

### copy()

> **copy**(): `Node`

Defined in: [node.ts:15](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/node.ts#L15)

copy performs a deep copy (or "computed" reference).
In real usage, you might store partial subtrees or do a shallow copy.

#### Returns

`Node`

***

### getHash()

> **getHash**(): `Uint8Array`

Defined in: [node.ts:6](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/node.ts#L6)

getHash returns the Merkle hash of this node.

#### Returns

`Uint8Array`

***

### getSum()

> **getSum**(): `bigint`

Defined in: [node.ts:9](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/smt/src/node.ts#L9)

getSum returns the 64-bit sum that this node contributes upward.

#### Returns

`bigint`
