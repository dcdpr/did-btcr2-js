# Interface: BitcoinSigner

Defined in: [packages/method/src/core/key-manager/interface.ts:121](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L121)

## Methods

### signTransaction()

> **signTransaction**(`txHex`, `keyUri?`): `Promise`&lt;[`Hex`](../../common/type-aliases/Hex.md)&gt;

Defined in: [packages/method/src/core/key-manager/interface.ts:128](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L128)

Signs a Bitcoin transaction with a key pair.

#### Parameters

##### txHex

[`Hex`](../../common/type-aliases/Hex.md)

The hex-encoded transaction to sign.

##### keyUri?

`string`

The URI of the key to sign the transaction with.

#### Returns

`Promise`&lt;[`Hex`](../../common/type-aliases/Hex.md)&gt;

A promise that resolves to the hex-encoded signed transaction.
