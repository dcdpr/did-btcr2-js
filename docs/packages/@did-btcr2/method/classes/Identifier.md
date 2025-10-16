# Class: Identifier

Defined in: [packages/method/src/utils/identifier.ts:17](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/identifier.ts#L17)

Implements [3 Syntax](https://dcdpr.github.io/did-btcr2/#syntax).
A did:btcr2 DID consists of a did:btcr2 prefix, followed by an id-bech32 value, which is a Bech32m encoding of:
   - the specification version;
   - the Bitcoin network identifier; and
   - either:
     - a key-value representing a secp256k1 public key; or
     - a hash-value representing the hash of an initiating external DID document.
 Identifier

## Constructors

### Constructor

> **new Identifier**(): `Identifier`

#### Returns

`Identifier`

## Methods

### decode()

> `static` **decode**(`identifier`): [`DidComponents`](../interfaces/DidComponents.md)

Defined in: [packages/method/src/utils/identifier.ts:135](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/identifier.ts#L135)

Implements [3.3 did:btcr2 Identifier Decoding](https://dcdpr.github.io/did-btcr2/#didbtc1-identifier-decoding).

#### Parameters

##### identifier

`string`

The BTCR2 DID to be parsed

#### Returns

[`DidComponents`](../interfaces/DidComponents.md)

The parsed identifier components. See [DidComponents](../interfaces/DidComponents.md) for details.

#### Throws

if an error occurs while parsing the identifier

#### Throws

if identifier is invalid

#### Throws

if the method is not supported

***

### encode()

> `static` **encode**(`params`): `string`

Defined in: [packages/method/src/utils/identifier.ts:35](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/identifier.ts#L35)

Implements [3.2 did:btcr2 Identifier Encoding](https://dcdpr.github.io/did-btcr2/#didbtc1-identifier-encoding).

A did:btcr2 DID consists of a did:btcr2 prefix, followed by an id-bech32 value, which is a Bech32m encoding of:
 - the specification version;
 - the Bitcoin network identifier; and
 - either:
   - a key-value representing a secp256k1 public key; or
   - a hash-value representing the hash of an initiating external DID document.

#### Parameters

##### params

See [CreateIdentifierParams](../interfaces/CreateIdentifierParams.md) for details.

###### genesisBytes

[`Bytes`](../../common/type-aliases/Bytes.md)

Public key or an intermediate document bytes.

###### idType

`string`

Identifier type (key or external).

###### network

`string` \| `number`

Bitcoin network name.

###### version

`number`

Identifier version.

#### Returns

`string`

The new did:btcr2 identifier.

***

### generate()

> `static` **generate**(): `object`

Defined in: [packages/method/src/utils/identifier.ts:265](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/identifier.ts#L265)

Generates a new did:btcr2 identifier based on a newly generated key pair.

#### Returns

`object`

The new did:btcr2 identifier.

##### identifier

> **identifier**: `object`

###### identifier.controller

> **controller**: `string`

###### identifier.id

> **id**: `string`

##### keys

> **keys**: [`SchnorrKeyPair`](../../keypair/classes/SchnorrKeyPair.md)
