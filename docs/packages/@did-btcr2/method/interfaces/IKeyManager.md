# Interface: IKeyManager

Defined in: [packages/method/src/core/key-manager/interface.ts:62](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L62)

The interface for the KeyManager class.
 IKeyManager

## Properties

### activeKeyUri?

> `optional` **activeKeyUri**: `string`

Defined in: [packages/method/src/core/key-manager/interface.ts:67](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L67)

The URI of the active key.

## Methods

### exportKey()

> **exportKey**(`keyUri?`): `Promise`&lt;`undefined` \| [`Multikey`](../../cryptosuite/interfaces/Multikey.md)&gt;

Defined in: [packages/method/src/core/key-manager/interface.ts:75](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L75)

Exports the full key pair from the key store.

#### Parameters

##### keyUri?

`string`

The URI of the key to export.

#### Returns

`Promise`&lt;`undefined` \| [`Multikey`](../../cryptosuite/interfaces/Multikey.md)&gt;

The key pair associated with the key URI.

#### Throws

If the key is not found in the key store.

***

### getPublicKey()

> **getPublicKey**(`keyUri`): `Promise`&lt;[`PublicKey`](../../keypair/classes/PublicKey.md)&gt;

Defined in: [packages/method/src/core/key-manager/interface.ts:82](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L82)

Gets the public key of a key pair.

#### Parameters

##### keyUri

`string`

The URI of the key to get the public key for.

#### Returns

`Promise`&lt;[`PublicKey`](../../keypair/classes/PublicKey.md)&gt;

The public key of the key pair.

***

### importKey()

> **importKey**(`keyPair`, `keyUri`, `options`): `Promise`&lt;`string`&gt;

Defined in: [packages/method/src/core/key-manager/interface.ts:92](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/key-manager/interface.ts#L92)

Imports a key pair into the key store.

#### Parameters

##### keyPair

[`SchnorrKeyPair`](../../keypair/classes/SchnorrKeyPair.md)

The key pair to import.

##### keyUri

`string`

The full DID controller + fragment identifier (e.g. 'did:btcr2:xyz#key-1').

##### options

[`KeyManagerOptions`](../type-aliases/KeyManagerOptions.md)

The options for importing the key pair.

#### Returns

`Promise`&lt;`string`&gt;

A promise that resolves to the key identifier of the imported key.
