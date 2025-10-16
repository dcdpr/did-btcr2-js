# Interface: KeyPair

Defined in: [pair.ts:15](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/pair.ts#L15)

Interface for KeyPair class.
 KeyPair

## Properties

### publicKey

> `readonly` **publicKey**: [`PublicKey`](../classes/PublicKey.md)

Defined in: [pair.ts:19](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/pair.ts#L19)

***

### secretKey?

> `readonly` `optional` **secretKey**: [`SecretKey`](../classes/SecretKey.md)

Defined in: [pair.ts:25](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/pair.ts#L25)

#### Throws

If the secret key is not available.

## Methods

### json()

> **json**(): [`SchnorrKeyPairObject`](../../common/type-aliases/SchnorrKeyPairObject.md)

Defined in: [pair.ts:31](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/pair.ts#L31)

JSON representation of the SchnorrKeyPair object.

#### Returns

[`SchnorrKeyPairObject`](../../common/type-aliases/SchnorrKeyPairObject.md)

The SchnorrKeyPair as a JSON object.
