# Interface: RawTransactionV2

Defined in: [packages/bitcoin/src/types.ts:485](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L485)

Transaction and RawTransaction

## Extends

- [`Transaction`](../type-aliases/Transaction.md)

## Properties

### fee?

> `optional` **fee**: `number`

Defined in: [packages/bitcoin/src/types.ts:486](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L486)

***

### hash

> **hash**: `string`

Defined in: [packages/bitcoin/src/types.ts:435](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L435)

#### Inherited from

`Transaction.hash`

***

### hex

> **hex**: `string`

Defined in: [packages/bitcoin/src/types.ts:433](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L433)

#### Inherited from

`Transaction.hex`

***

### locktime

> **locktime**: `number`

Defined in: [packages/bitcoin/src/types.ts:440](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L440)

#### Inherited from

`Transaction.locktime`

***

### size

> **size**: `number`

Defined in: [packages/bitcoin/src/types.ts:436](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L436)

#### Inherited from

`Transaction.size`

***

### txid

> **txid**: `string`

Defined in: [packages/bitcoin/src/types.ts:434](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L434)

#### Inherited from

`Transaction.txid`

***

### version

> **version**: `number`

Defined in: [packages/bitcoin/src/types.ts:439](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L439)

#### Inherited from

`Transaction.version`

***

### vin

> **vin**: [`TxInExt`](TxInExt.md)[]

Defined in: [packages/bitcoin/src/types.ts:487](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L487)

***

### vout

> **vout**: [`TxOut`](../type-aliases/TxOut.md)[]

Defined in: [packages/bitcoin/src/types.ts:488](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L488)

***

### vsize

> **vsize**: `number`

Defined in: [packages/bitcoin/src/types.ts:437](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L437)

#### Inherited from

`Transaction.vsize`

***

### weight

> **weight**: `number`

Defined in: [packages/bitcoin/src/types.ts:438](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/bitcoin/src/types.ts#L438)

#### Inherited from

`Transaction.weight`
