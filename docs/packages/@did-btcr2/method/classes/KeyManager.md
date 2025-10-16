# Class: KeyManager

Defined in: [packages/method/src/core/key-manager/index.ts:31](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L31)

Class for managing cryptographic keys for the B DID method.
 KeyManager

## Implements

- [`IKeyManager`](../interfaces/IKeyManager.md)
- [`CryptoSigner`](../interfaces/CryptoSigner.md)
- [`BitcoinSigner`](../interfaces/BitcoinSigner.md)

## Constructors

### Constructor

> **new KeyManager**(`params`): `KeyManager`

Defined in: [packages/method/src/core/key-manager/index.ts:70](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L70)

Creates an instance of KeyManager.

#### Parameters

##### params

[`KeyManagerParams`](../type-aliases/KeyManagerParams.md) = `{}`

The parameters to initialize the key manager.

#### Returns

`KeyManager`

## Properties

### activeKeyUri?

> `optional` **activeKeyUri**: `string`

Defined in: [packages/method/src/core/key-manager/index.ts:46](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L46)

The `activeKeyUri` property is a string that represents the URI of the currently active key.
It is used to identify the key that will be used for signing and verifying operations.
This property is optional and can be set to a specific key URI when initializing the
`KeyManager` instance. If not set, the key manager will use the default key URI.

#### Implementation of

[`IKeyManager`](../interfaces/IKeyManager.md).[`activeKeyUri`](../interfaces/IKeyManager.md#activekeyuri)

## Accessors

### instance

#### Get Signature

> **get** `static` **instance**(): `KeyManager`

Defined in: [packages/method/src/core/key-manager/index.ts:86](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L86)

Gets the singleton instance of the KeyManager.

##### Returns

`KeyManager`

The singleton instance of the KeyManager.

## Methods

### digest()

> **digest**(`data`): [`Bytes`](../../common/type-aliases/Bytes.md)

Defined in: [packages/method/src/core/key-manager/index.ts:250](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L250)

Computes the hash of the given data.

#### Parameters

##### data

`Uint8Array`

The data to hash.

#### Returns

[`Bytes`](../../common/type-aliases/Bytes.md)

The hash of the data.

#### Implementation of

[`CryptoSigner`](../interfaces/CryptoSigner.md).[`digest`](../interfaces/CryptoSigner.md#digest)

***

### exportKey()

> **exportKey**(`keyUri?`): `Promise`&lt;`undefined` \| [`SchnorrMultikey`](../../cryptosuite/classes/SchnorrMultikey.md)&gt;

Defined in: [packages/method/src/core/key-manager/index.ts:192](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L192)

Exports the full multikeypair from the key store.

#### Parameters

##### keyUri?

`string`

#### Returns

`Promise`&lt;`undefined` \| [`SchnorrMultikey`](../../cryptosuite/classes/SchnorrMultikey.md)&gt;

The key pair associated with the key URI.

#### Throws

If the key is not found in the key store.

#### Implementation of

[`IKeyManager`](../interfaces/IKeyManager.md).[`exportKey`](../interfaces/IKeyManager.md#exportkey)

***

### getKeySigner()

> **getKeySigner**(`keyUri`, `network`): `Promise`&lt;[`Signer`](Signer.md)&gt;

Defined in: [packages/method/src/core/key-manager/index.ts:334](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L334)

#### Parameters

##### keyUri

`string`

##### network

keyof [`AvailableNetworks`](../../bitcoin/index.browser/type-aliases/AvailableNetworks.md)

#### Returns

`Promise`&lt;[`Signer`](Signer.md)&gt;

***

### getPublicKey()

> **getPublicKey**(`keyUri?`): `Promise`&lt;[`PublicKey`](../../keypair/classes/PublicKey.md)&gt;

Defined in: [packages/method/src/core/key-manager/index.ts:111](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L111)

Gets the key pair from the key store and returns a PublicKey.

#### Parameters

##### keyUri?

`string`

The URI of the key to get the public key for.

#### Returns

`Promise`&lt;[`PublicKey`](../../keypair/classes/PublicKey.md)&gt;

The public key associated with the key URI.

#### Implementation of

[`IKeyManager`](../interfaces/IKeyManager.md).[`getPublicKey`](../interfaces/IKeyManager.md#getpublickey)

***

### importKey()

> **importKey**(`keys`, `keyUri`, `options`): `Promise`&lt;`string`&gt;

Defined in: [packages/method/src/core/key-manager/index.ts:205](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L205)

Imports a keypair to the store.

#### Parameters

##### keys

[`SchnorrKeyPair`](../../keypair/classes/SchnorrKeyPair.md)

The keypair to import.

##### keyUri

`string`

The URI of the key to import.

##### options

[`KeyManagerOptions`](../type-aliases/KeyManagerOptions.md) = `{}`

Relevant import options.

#### Returns

`Promise`&lt;`string`&gt;

A promise that resolves to the key identifier of the imported key.

#### Implementation of

[`IKeyManager`](../interfaces/IKeyManager.md).[`importKey`](../interfaces/IKeyManager.md#importkey)

***

### sign()

> **sign**(`data`, `keyUri?`): `Promise`&lt;[`Bytes`](../../common/type-aliases/Bytes.md)&gt;

Defined in: [packages/method/src/core/key-manager/index.ts:130](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L130)

Signs the given data using the key associated with the key URI.

#### Parameters

##### data

[`Hex`](../../common/type-aliases/Hex.md)

The data to sign.

##### keyUri?

`string`

The URI of the key to sign the data with.

#### Returns

`Promise`&lt;[`Bytes`](../../common/type-aliases/Bytes.md)&gt;

A promise resolving to the signature of the data.

#### Implementation of

[`CryptoSigner`](../interfaces/CryptoSigner.md).[`sign`](../interfaces/CryptoSigner.md#sign)

***

### signTransaction()

> **signTransaction**(`txHex`, `keyUri?`): `Promise`&lt;[`Hex`](../../common/type-aliases/Hex.md)&gt;

Defined in: [packages/method/src/core/key-manager/index.ts:102](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L102)

Signs a transaction using the key associated with the key URI.

#### Parameters

##### txHex

[`Hex`](../../common/type-aliases/Hex.md)

The transaction hex to sign.

##### keyUri?

`string`

The URI of the key to sign the transaction with.

#### Returns

`Promise`&lt;[`Hex`](../../common/type-aliases/Hex.md)&gt;

A promise resolving to the signed transaction hex.

#### Implementation of

[`BitcoinSigner`](../interfaces/BitcoinSigner.md).[`signTransaction`](../interfaces/BitcoinSigner.md#signtransaction)

***

### verify()

> **verify**(`signature`, `data`, `keyUri?`): `Promise`&lt;`boolean`&gt;

Defined in: [packages/method/src/core/key-manager/index.ts:155](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L155)

Verifies a signature using the key associated with the key URI.

#### Parameters

##### signature

[`Bytes`](../../common/type-aliases/Bytes.md)

The signature to verify.

##### data

[`Hex`](../../common/type-aliases/Hex.md)

The data to verify the signature with.

##### keyUri?

`string`

The URI of the key to verify the signature with.

#### Returns

`Promise`&lt;`boolean`&gt;

A promise resolving to a boolean indicating the verification result.

#### Implementation of

[`CryptoSigner`](../interfaces/CryptoSigner.md).[`verify`](../interfaces/CryptoSigner.md#verify)

***

### computeKeyUri()

> `static` **computeKeyUri**(`id`, `controller?`): `string`

Defined in: [packages/method/src/core/key-manager/index.ts:260](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L260)

Computes the key URI of a given keypair.

#### Parameters

##### id

`string`

The fragment identifier (e.g. 'key-1').

##### controller?

`string`

The DID controller (e.g. 'did:btcr2:xyz').

#### Returns

`string`

A full DID fragment URI (e.g. 'did:btcr2:xyz#key-1')

***

### getKeyPair()

> `static` **getKeyPair**(`keyUri?`): `Promise`&lt;`undefined` \| [`SchnorrMultikey`](../../cryptosuite/classes/SchnorrMultikey.md)&gt;

Defined in: [packages/method/src/core/key-manager/index.ts:327](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L327)

Retrieves a keypair from the key store using the provided key URI.

#### Parameters

##### keyUri?

`string`

The URI of the keypair to retrieve.

#### Returns

`Promise`&lt;`undefined` \| [`SchnorrMultikey`](../../cryptosuite/classes/SchnorrMultikey.md)&gt;

The retrieved keypair, or undefined if not found.

***

### initialize()

> `static` **initialize**(`keys`, `keyUri`): `Promise`&lt;`KeyManager`&gt;

Defined in: [packages/method/src/core/key-manager/index.ts:285](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L285)

Initializes a singleton KeyManager instance.

#### Parameters

##### keys

The keypair used to initialize the key manager.

[`SchnorrKeyPair`](../../keypair/classes/SchnorrKeyPair.md) | [`SchnorrKeyPairObject`](../../common/type-aliases/SchnorrKeyPairObject.md)

##### keyUri

`string`

#### Returns

`Promise`&lt;`KeyManager`&gt;

***

### toMultibaseUri()

> `static` **toMultibaseUri**(`data`): `string`

Defined in: [packages/method/src/core/key-manager/index.ts:270](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/index.ts#L270)

Computes a multibase-compliant URI from a key.

#### Parameters

##### data

[`PublicKey`](../../keypair/classes/PublicKey.md) | [`SchnorrKeyPair`](../../keypair/classes/SchnorrKeyPair.md) | `Multibase`&lt;`"zQ3s"`&gt;

#### Returns

`string`

A multibase URI (e.g. 'urn:mb:zQ3s...')
