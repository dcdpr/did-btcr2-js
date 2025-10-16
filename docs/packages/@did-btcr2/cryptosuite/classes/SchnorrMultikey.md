# Class: SchnorrMultikey

Defined in: [multikey/index.ts:28](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L28)

SchnorrMultikey is an implementation of [2.1.1 Multikey](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/#multikey).
The publicKeyMultibase value of the verification method MUST be a base-58-btc Multibase encoding of a Multikey encoded secp256k1 public key.
The secretKeyMultibase value of the verification method MUST be a Multikey encoding of a secp256k1 secret key.
 SchnorrMultikey

## Implements

- [`Multikey`](../interfaces/Multikey.md)

## Constructors

### Constructor

> **new SchnorrMultikey**(`params`): `SchnorrMultikey`

Defined in: [multikey/index.ts:51](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L51)

Creates an instance of SchnorrMultikey.

#### Parameters

##### params

`MultikeyParams`

The parameters to create the multikey

#### Returns

`SchnorrMultikey`

#### Throws

if neither a publicKey nor a privateKey is provided

## Properties

### controller

> `readonly` **controller**: `string`

Defined in: [multikey/index.ts:36](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L36)

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`controller`](../interfaces/Multikey.md#controller)

***

### id

> `readonly` **id**: `string`

Defined in: [multikey/index.ts:33](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L33)

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`id`](../interfaces/Multikey.md#id)

***

### type

> `readonly` `static` **type**: `string` = `'Multikey'`

Defined in: [multikey/index.ts:30](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L30)

## Accessors

### keys

#### Get Signature

> **get** **keys**(): [`SchnorrKeyPair`](../../keypair/classes/SchnorrKeyPair.md)

Defined in: [multikey/index.ts:69](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L69)

##### Returns

[`SchnorrKeyPair`](../../keypair/classes/SchnorrKeyPair.md)

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`keys`](../interfaces/Multikey.md#keys)

***

### publicKey

#### Get Signature

> **get** **publicKey**(): [`PublicKey`](../../keypair/classes/PublicKey.md)

Defined in: [multikey/index.ts:76](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L76)

##### Returns

[`PublicKey`](../../keypair/classes/PublicKey.md)

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`publicKey`](../interfaces/Multikey.md#publickey)

***

### secretKey

#### Get Signature

> **get** **secretKey**(): [`SecretKey`](../../keypair/classes/SecretKey.md)

Defined in: [multikey/index.ts:83](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L83)

##### Returns

[`SecretKey`](../../keypair/classes/SecretKey.md)

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`secretKey`](../interfaces/Multikey.md#secretkey)

***

### signer

#### Get Signature

> **get** **signer**(): `boolean`

Defined in: [multikey/index.ts:235](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L235)

##### Returns

`boolean`

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`signer`](../interfaces/Multikey.md#signer)

## Methods

### fromVerificationMethod()

> **fromVerificationMethod**(`verificationMethod`): [`Multikey`](../interfaces/Multikey.md)

Defined in: [multikey/index.ts:185](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L185)

Convert a verification method to a multikey.

#### Parameters

##### verificationMethod

`DidVerificationMethod`

The verification method to convert.

#### Returns

[`Multikey`](../interfaces/Multikey.md)

Multikey instance.

#### Throws

if the verification method is missing required fields.
if the verification method has an invalid type.
if the publicKeyMultibase has an invalid prefix.

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`fromVerificationMethod`](../interfaces/Multikey.md#fromverificationmethod)

***

### fullId()

> **fullId**(): `string`

Defined in: [multikey/index.ts:157](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L157)

Get the full id of the multikey

#### Returns

`string`

The full id of the multikey

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`fullId`](../interfaces/Multikey.md#fullid)

***

### json()

> **json**(): [`MultikeyObject`](../type-aliases/MultikeyObject.md)

Defined in: [multikey/index.ts:243](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L243)

Convert the multikey to a JSON object.

#### Returns

[`MultikeyObject`](../type-aliases/MultikeyObject.md)

The multikey as a JSON object.

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`json`](../interfaces/Multikey.md#json)

***

### sign()

> **sign**(`data`, `opts?`): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [multikey/index.ts:111](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L111)

Produce a signature over arbitrary data using schnorr or ecdsa.

#### Parameters

##### data

[`Hex`](../../common/type-aliases/Hex.md)

Data to be signed.

##### opts?

`CryptoOptions`

Options for signing.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

Signature byte array.

#### Throws

if no private key is provided.

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`sign`](../interfaces/Multikey.md#sign)

***

### toCryptosuite()

> **toCryptosuite**(`cryptosuite?`): [`Cryptosuite`](Cryptosuite.md)

Defined in: [multikey/index.ts:99](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L99)

Constructs an instance of Cryptosuite from the current Multikey instance.

#### Parameters

##### cryptosuite?

`"bip340-jcs-2025"` | `"bip340-rdfc-2025"`

#### Returns

[`Cryptosuite`](Cryptosuite.md)

***

### toVerificationMethod()

> **toVerificationMethod**(): `DidVerificationMethod`

Defined in: [multikey/index.ts:166](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L166)

Convert the multikey to a verification method.

#### Returns

`DidVerificationMethod`

The verification method.

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`toVerificationMethod`](../interfaces/Multikey.md#toverificationmethod)

***

### verify()

> **verify**(`signature`, `data`, `opts?`): `boolean`

Defined in: [multikey/index.ts:141](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L141)

Verify a signature using schnorr or ecdsa.

#### Parameters

##### signature

[`Hex`](../../common/type-aliases/Hex.md)

Signature for verification.

##### data

[`Hex`](../../common/type-aliases/Hex.md)

Data for verification.

##### opts?

`CryptoOptions`

Options for signing.

#### Returns

`boolean`

If the signature is valid against the public key.

#### Implementation of

[`Multikey`](../interfaces/Multikey.md).[`verify`](../interfaces/Multikey.md#verify)

***

### fromPrivateKey()

> `static` **fromPrivateKey**(`params`): `SchnorrMultikey`

Defined in: [multikey/index.ts:277](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L277)

Creates a `Multikey` instance from a private key

#### Parameters

##### params

[`FromSecretKey`](../interfaces/FromSecretKey.md)

The parameters to create the multikey

#### Returns

`SchnorrMultikey`

The new multikey instance

***

### fromPublicKey()

> `static` **fromPublicKey**(`params`): [`Multikey`](../interfaces/Multikey.md)

Defined in: [multikey/index.ts:299](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L299)

Creates a `Multikey` instance from a public key

#### Parameters

##### params

[`FromPublicKey`](../interfaces/FromPublicKey.md)

The parameters to create the multikey

#### Returns

[`Multikey`](../interfaces/Multikey.md)

The new multikey instance

***

### fromPublicKeyMultibase()

> `static` **fromPublicKeyMultibase**(`params`): `SchnorrMultikey`

Defined in: [multikey/index.ts:315](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L315)

Creates a `Multikey` instance from a public key multibase.

#### Parameters

##### params

[`FromPublicKeyMultibaseParams`](../interfaces/FromPublicKeyMultibaseParams.md)

See [FromPublicKeyMultibaseParams](../interfaces/FromPublicKeyMultibaseParams.md) for details.

#### Returns

`SchnorrMultikey`

The new multikey instance.

***

### initialize()

> `static` **initialize**(`params`): `SchnorrMultikey`

Defined in: [multikey/index.ts:265](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/cryptosuite/src/multikey/index.ts#L265)

Static convenience method to create a new Multikey instance.

#### Parameters

##### params

`MultikeyParams`

The parameters to create the multikey

#### Returns

`SchnorrMultikey`

A new Multikey instance

#### Throws

if neither a publicKey nor a privateKey is provided
