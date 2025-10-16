# Class: SecretKey

Defined in: [secret.ts:79](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L79)

Encapsulates a secp256k1 secret key
Provides get methods for different formats (raw, secret, point).
Provides helpers methods for comparison, serialization and publicKey generation.
 SecretKey

## Implements

- [`ISecretKey`](../interfaces/ISecretKey.md)

## Constructors

### Constructor

> **new SecretKey**(`entropy`): `SecretKey`

Defined in: [secret.ts:94](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L94)

Instantiates an instance of SecretKey.

#### Parameters

##### entropy

[`Entropy`](../../common/type-aliases/Entropy.md)

bytes (Uint8Array) or secret (bigint)

#### Returns

`SecretKey`

#### Throws

If entropy is not provided, not a valid 32-byte secret key or not a valid bigint seed

## Accessors

### bytes

#### Get Signature

> **get** **bytes**(): `Uint8Array`

Defined in: [secret.ts:139](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L139)

Get the secret key entropy as a byte array.

##### Returns

`Uint8Array`

The secret key bytes as a Uint8Array

Get the secret key bytes.

#### Implementation of

[`ISecretKey`](../interfaces/ISecretKey.md).[`bytes`](../interfaces/ISecretKey.md#bytes)

***

### hex

#### Get Signature

> **get** **hex**(): [`Hex`](../../common/type-aliases/Hex.md)

Defined in: [secret.ts:159](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L159)

Returns the raw secret key as a hex string.

##### Returns

[`Hex`](../../common/type-aliases/Hex.md)

The secret key as a hex string

Get the secret key as a hex string.

#### Implementation of

[`ISecretKey`](../interfaces/ISecretKey.md).[`hex`](../interfaces/ISecretKey.md#hex)

***

### multibase

#### Get Signature

> **get** **multibase**(): `string`

Defined in: [secret.ts:169](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L169)

Encode the secret key bytes as a secretKeyMultibase string.

##### Returns

`string`

The secret key in base58btc multibase format

***

### seed

#### Get Signature

> **get** **seed**(): `bigint`

Defined in: [secret.ts:149](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L149)

Get the secret key entropy as a bigint.

##### Returns

`bigint`

The secret key as a bigint

Getter returns the secret key bytes in bigint format.
Setter allows alternative method of using a bigint seed for the entropy.

#### Implementation of

[`ISecretKey`](../interfaces/ISecretKey.md).[`seed`](../interfaces/ISecretKey.md#seed)

## Methods

### computePublicKey()

> **computePublicKey**(): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [secret.ts:212](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L212)

Computes the public key from the secret key bytes.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The computed public key

#### Implementation of

[`ISecretKey`](../interfaces/ISecretKey.md).[`computePublicKey`](../interfaces/ISecretKey.md#computepublickey)

***

### encode()

> **encode**(): `string`

Defined in: [secret.ts:178](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L178)

Encodes the secret key bytes to BIP340 multibase format.

#### Returns

`string`

The secret key in BIP340 multibase format.

***

### equals()

> **equals**(`other`): `boolean`

Defined in: [secret.ts:203](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L203)

Checks if this secret key is equal to another.

#### Parameters

##### other

`SecretKey`

The other secret key

#### Returns

`boolean`

True if the private keys are equal, false otherwise

#### Implementation of

[`ISecretKey`](../interfaces/ISecretKey.md).[`equals`](../interfaces/ISecretKey.md#equals)

***

### isValid()

> **isValid**(): `boolean`

Defined in: [secret.ts:251](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L251)

Checks if the secret key is valid.

#### Returns

`boolean`

True if the secret key is valid, false otherwise

#### Implementation of

[`ISecretKey`](../interfaces/ISecretKey.md).[`isValid`](../interfaces/ISecretKey.md#isvalid)

***

### isValidPair()

> **isValidPair**(`pk`): `boolean`

Defined in: [secret.ts:260](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L260)

Checks if the public key is a valid secp256k1 point.

#### Parameters

##### pk

[`PublicKey`](PublicKey.md)

The public key to validate

#### Returns

`boolean`

True if the public key is valid, false otherwise

***

### json()

> **json**(): [`SecretKeyObject`](../../common/type-aliases/SecretKeyObject.md)

Defined in: [secret.ts:239](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L239)

Converts the secret key to a JSON object.

#### Returns

[`SecretKeyObject`](../../common/type-aliases/SecretKeyObject.md)

The secret key as a JSON object

#### Implementation of

[`ISecretKey`](../interfaces/ISecretKey.md).[`json`](../interfaces/ISecretKey.md#json)

***

### decode()

> `static` **decode**(`multibase`): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [secret.ts:275](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L275)

Decodes the multibase string to the 34-byte secret key (2 byte prefix + 32 byte key).

#### Parameters

##### multibase

`string`

The multibase string to decode

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The decoded secret key.

***

### fromJSON()

> `static` **fromJSON**(`json`): `SecretKey`

Defined in: [secret.ts:310](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L310)

Creates a SecretKey object from a JSON object.

#### Parameters

##### json

[`SecretKeyObject`](../../common/type-aliases/SecretKeyObject.md)

The JSON object containing the secret key bytes

#### Returns

`SecretKey`

A new SecretKey object

***

### fromSecret()

> `static` **fromSecret**(`secret`): `SecretKey`

Defined in: [secret.ts:367](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L367)

Creates a new SecretKey object from a bigint secret.

#### Parameters

##### secret

`bigint`

The secret bigint

#### Returns

`SecretKey`

A new SecretKey object

***

### generate()

> `static` **generate**(): `SecretKey`

Defined in: [secret.ts:393](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L393)

Creates a new SecretKey from random secret key bytes.

#### Returns

`SecretKey`

A new SecretKey object

***

### getPublicKey()

> `static` **getPublicKey**(`bytes`): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [secret.ts:406](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L406)

Generates a public key from the given secret key bytes.

#### Parameters

##### bytes

[`Bytes`](../../common/type-aliases/Bytes.md)

The secret key bytes

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The computed public key bytes

***

### random()

> `static` **random**(): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [secret.ts:380](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L380)

Generates random secret key bytes.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

Uint8Array of 32 random bytes.

***

### toBytes()

> `static` **toBytes**(`secret`): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [secret.ts:345](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L345)

Convert a secret key bytes to a bigint secret.

#### Parameters

##### secret

`bigint`

The secret key secret.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The secret key secret as secret key bytes.

***

### toKeyPair()

> `static` **toKeyPair**(`bytes`): [`SchnorrKeyPair`](SchnorrKeyPair.md)

Defined in: [secret.ts:320](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L320)

Converts a SecretKey or KeyBytes to a Pair.

#### Parameters

##### bytes

[`Bytes`](../../common/type-aliases/Bytes.md)

#### Returns

[`SchnorrKeyPair`](SchnorrKeyPair.md)

The SchnorrKeyPair object containing the public and private keys

#### Throws

If the secret key is not valid

***

### toSecret()

> `static` **toSecret**(`bytes`): `bigint`

Defined in: [secret.ts:336](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/keypair/src/secret.ts#L336)

Convert a bigint secret to secret key bytes.

#### Parameters

##### bytes

[`Bytes`](../../common/type-aliases/Bytes.md)

The secret key bytes

#### Returns

`bigint`

The secret key bytes as a bigint secret
