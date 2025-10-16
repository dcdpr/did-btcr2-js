# Interface: ISecretKey

Defined in: [secret.ts:24](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L24)

Interface for the SecretKey class.
 ISecretKey

## Properties

### bytes

> `readonly` **bytes**: [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [secret.ts:29](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L29)

Get the secret key bytes.

***

### hex

> `readonly` **hex**: [`Hex`](../../common/type-aliases/Hex.md)

Defined in: [secret.ts:42](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L42)

Get the secret key as a hex string.

***

### seed

> **seed**: `bigint`

Defined in: [secret.ts:36](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L36)

Getter returns the secret key bytes in bigint format.
Setter allows alternative method of using a bigint seed for the entropy.

## Methods

### computePublicKey()

> **computePublicKey**(): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [secret.ts:55](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L55)

Uses the secret key to compute the corresponding public key.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

A new PublicKey object.

***

### equals()

> **equals**(`other`): `boolean`

Defined in: [secret.ts:49](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L49)

Checks if this secret key is equal to another secret key.

#### Parameters

##### other

[`SecretKey`](../classes/SecretKey.md)

#### Returns

`boolean`

True if the private keys are equal.

***

### isValid()

> **isValid**(): `boolean`

Defined in: [secret.ts:61](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L61)

Checks if the secret key is valid.

#### Returns

`boolean`

Whether the secret key is valid.

***

### json()

> **json**(): [`SecretKeyObject`](../../common/type-aliases/SecretKeyObject.md)

Defined in: [secret.ts:68](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L68)

JSON representation of a SecretKey object.

#### Returns

[`SecretKeyObject`](../../common/type-aliases/SecretKeyObject.md)

The SecretKey as a JSON object.
