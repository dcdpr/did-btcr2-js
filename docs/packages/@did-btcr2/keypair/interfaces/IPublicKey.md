# Interface: IPublicKey

Defined in: [public.ts:26](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L26)

Interface for the PublicKey class.
 IPublicKey

## Properties

### compressed

> `readonly` **compressed**: [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [public.ts:37](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L37)

Compressed public key getter.

***

### hex

> `readonly` **hex**: [`Hex`](../../common/type-aliases/Hex.md)

Defined in: [public.ts:67](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L67)

PublicKey hex string getter.

***

### multibase

> `readonly` **multibase**: [`MultibaseObject`](../../common/type-aliases/MultibaseObject.md)

Defined in: [public.ts:61](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L61)

PublicKey multibase getter.

#### Returns

The public key as MultibaseObject as a address string, key and prefix bytes.

***

### parity

> `readonly` **parity**: `number`

Defined in: [public.ts:43](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L43)

PublicKey parity getter.

***

### uncompressed

> `readonly` **uncompressed**: [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [public.ts:31](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L31)

Uncompressed public key getter.

***

### x

> `readonly` **x**: [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [public.ts:49](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L49)

PublicKey x-coordinate getter.

***

### y

> `readonly` **y**: [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [public.ts:55](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L55)

PublicKey y-coordinate getter.

## Methods

### decode()

> **decode**(): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [public.ts:73](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L73)

Decode the base58btc multibase string to the compressed public key prefixed with 0x02.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The public key as a 33-byte compressed public key with header.

***

### encode()

> **encode**(): `string`

Defined in: [public.ts:79](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L79)

Encode the PublicKey as an x-only base58btc multibase public key.

#### Returns

`string`

The public key formatted a base58btc multibase string.

***

### equals()

> **equals**(`other`): `boolean`

Defined in: [public.ts:86](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L86)

PublicKey key equality check. Checks if `this` public key is equal to `other` public key.

#### Parameters

##### other

[`PublicKey`](../classes/PublicKey.md)

The public key to compare.

#### Returns

`boolean`

True if the public keys are equal.

***

### json()

> **json**(): [`PublicKeyObject`](../../common/type-aliases/PublicKeyObject.md)

Defined in: [public.ts:92](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/public.ts#L92)

JSON representation of a PublicKey object.

#### Returns

[`PublicKeyObject`](../../common/type-aliases/PublicKeyObject.md)

The PublicKey as a JSON object.
