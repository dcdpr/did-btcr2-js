# Class: GeneralUtils

Defined in: [packages/method/src/utils/general.ts:14](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L14)

Static class of general utility functions for the did-btcr2 spec implementation
 GeneralUtils

## Constructors

### Constructor

> **new GeneralUtils**(): `GeneralUtils`

#### Returns

`GeneralUtils`

## Methods

### bigintToBuffer()

> `static` **bigintToBuffer**(`value`): `Buffer`

Defined in: [packages/method/src/utils/general.ts:37](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L37)

Converts a bigint to a buffer

#### Parameters

##### value

`bigint`

The bigint to convert

#### Returns

`Buffer`

The buffer representation of the bigint

***

### deriveChildKey()

> `static` **deriveChildKey**(`hdkey`, `path`): `HDKey`

Defined in: [packages/method/src/utils/general.ts:194](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L194)

Derives a child key from an HDKey

#### Parameters

##### hdkey

`HDKey`

The HDKey to derive the child key from

##### path

`string`

The path to derive the child key from

#### Returns

`HDKey`

A Promise resolving to the child key

#### Throws

Error if the child key cannot be derived

***

### encode()

> `static` **encode**(`xOnlyKeyBytes`): `string`

Defined in: [packages/method/src/utils/general.ts:20](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L20)

Helper function to encode a secp256k1 key in SchnorrSecp256k1 Multikey Format

#### Parameters

##### xOnlyKeyBytes

[`Bytes`](../../common/type-aliases/Bytes.md)

#### Returns

`string`

***

### generateCompressedSecp256k1KeyPair()

> `static` **generateCompressedSecp256k1KeyPair**(): `object`

Defined in: [packages/method/src/utils/general.ts:61](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L61)

#### Returns

`object`

##### privateKey

> **privateKey**: `Bytes`

##### publicKey

> **publicKey**: `Bytes`

***

### generateHdWallet()

> `static` **generateHdWallet**(): `Promise`&lt;[`HdWallet`](../../common/type-aliases/HdWallet.md)&gt;

Defined in: [packages/method/src/utils/general.ts:47](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L47)

Generates a new mnemonic phrase and HD wallet

#### Returns

`Promise`&lt;[`HdWallet`](../../common/type-aliases/HdWallet.md)&gt;

Promise resolving to a new hdwallet object w/ mnemonic and hdkey

#### Throws

if the public key bytes cannot be derived

***

### recoverHdChildFromMnemonic()

> `static` **recoverHdChildFromMnemonic**(`mnemonic`, `path`): `Promise`&lt;`Uint8Array`&lt;`ArrayBufferLike`&gt;&gt;

Defined in: [packages/method/src/utils/general.ts:172](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L172)

Recovers an HDKey from a mnemonic phrase

#### Parameters

##### mnemonic

`string`

The mnemonic phrase to recover the HDKey from

##### path

`string`

The path to derive the child key from

#### Returns

`Promise`&lt;`Uint8Array`&lt;`ArrayBufferLike`&gt;&gt;

Promise resolving to the recovered private key bytes

#### Throws

if the HDKey cannot be recovered

***

### recoverHdWallet()

> `static` **recoverHdWallet**(`mnemonic`, `seed?`): `Promise`&lt;`HDKey`&gt;

Defined in: [packages/method/src/utils/general.ts:76](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L76)

Recovers an HDKey from a mnemonic phrase

#### Parameters

##### mnemonic

`string`

The mnemonic phrase to recover the HDKey from

##### seed?

`Uint8Array`&lt;`ArrayBufferLike`&gt;

Optional seed to recover the HDKey from

#### Returns

`Promise`&lt;`HDKey`&gt;

Promise resolving to the recovered HDKey

#### Throws

Error if the HDKey cannot be recovered

***

### recoverRawPrivateKey()

> `static` **recoverRawPrivateKey**(`entropy`): `Uint8Array`

Defined in: [packages/method/src/utils/general.ts:119](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L119)

Recovers a secp256k1 privateKey from its original entropy

#### Parameters

##### entropy

`Uint8Array`

The entropy to recover the privateKey from

#### Returns

`Uint8Array`

The recovered privateKey

#### Throws

if the privateKey cannot be recovered

***

### recoverTweakedRawPrivateKey()

> `static` **recoverTweakedRawPrivateKey**(`xorEntropy`, `salt`): `Uint8Array`

Defined in: [packages/method/src/utils/general.ts:95](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L95)

Recovers a secp256k1 privateKey from its original entropy

#### Parameters

##### xorEntropy

`Uint8Array`

The original entropy to recover the privateKey from

##### salt

`Uint8Array`

The salt used to tweak the privateKey

#### Returns

`Uint8Array`

The recovered privateKey

#### Throws

if the privateKey cannot be recovered

***

### XNOR()

> `static` **XNOR**(`tweakedEntropy`, `salt`): `Uint8Array`

Defined in: [packages/method/src/utils/general.ts:157](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L157)

Untweak the entropy with a salt using XNOR

#### Parameters

##### tweakedEntropy

`Uint8Array`

The tweaked entropy to untweak

##### salt

`Uint8Array`

The salt to untweak the entropy with

#### Returns

`Uint8Array`

The original entropy

***

### XOR()

> `static` **XOR**(`entropy`, `salt`): `Uint8Array`

Defined in: [packages/method/src/utils/general.ts:142](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/general.ts#L142)

Tweak the entropy with a salt using XOR

#### Parameters

##### entropy

`Uint8Array`

The entropy to tweak

##### salt

`Uint8Array`

The salt to tweak the entropy with

#### Returns

`Uint8Array`

The tweaked entropy
