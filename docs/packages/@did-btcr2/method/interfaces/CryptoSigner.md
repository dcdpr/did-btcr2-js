# Interface: CryptoSigner

Defined in: [packages/method/src/core/key-manager/interface.ts:95](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L95)

## Methods

### digest()

> **digest**(`data`): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [packages/method/src/core/key-manager/interface.ts:118](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L118)

Returns the sha256 hash of the input data.

#### Parameters

##### data

`Uint8Array`

The data to hash.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The sha256 hash of the input data.

***

### sign()

> **sign**(`data`, `keyUri?`): `Promise`&lt;[`Bytes`](../../common/type-aliases/Bytes.md)&gt;

Defined in: [packages/method/src/core/key-manager/interface.ts:102](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L102)

Signs a message with a key pair.

#### Parameters

##### data

[`Hex`](../../common/type-aliases/Hex.md)

The data to sign.

##### keyUri?

`string`

The URI of the key to sign the data with.

#### Returns

`Promise`&lt;[`Bytes`](../../common/type-aliases/Bytes.md)&gt;

The signature of the input data.

***

### verify()

> **verify**(`signature`, `data`, `keyUri?`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/method/src/core/key-manager/interface.ts:111](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L111)

Verifies if a signature was produced by a key pair.

#### Parameters

##### signature

[`Bytes`](../../common/type-aliases/Bytes.md)

The signature to verify.

##### data

[`Hex`](../../common/type-aliases/Hex.md)

The data that was signed.

##### keyUri?

`string`

The URI of the key to use for verification.

#### Returns

`Promise`&lt;`boolean`&gt;

A promise that resolves if the signature is valid, and rejects otherwise.
