# Class: DidVerificationMethod

Defined in: [packages/method/src/utils/did-document.ts:49](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L49)

DID BTCR2 Verification Method extends the DidVerificationMethod class adding helper methods and properties
 DidVerificationMethod

## Implements

- [`IDidVerificationMethod`](../interfaces/IDidVerificationMethod.md)

## Constructors

### Constructor

> **new DidVerificationMethod**(`__namedParameters`): `DidVerificationMethod`

Defined in: [packages/method/src/utils/did-document.ts:56](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L56)

#### Parameters

##### \_\_namedParameters

[`IDidVerificationMethod`](../interfaces/IDidVerificationMethod.md)

#### Returns

`DidVerificationMethod`

## Properties

### controller

> **controller**: `string`

Defined in: [packages/method/src/utils/did-document.ts:52](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L52)

The DID of the entity that controls this verification method.

#### Implementation of

[`IDidVerificationMethod`](../interfaces/IDidVerificationMethod.md).[`controller`](../interfaces/IDidVerificationMethod.md#controller)

***

### id

> **id**: `string`

Defined in: [packages/method/src/utils/did-document.ts:50](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L50)

The identifier of the verification method, which must be a URI.

#### Implementation of

[`IDidVerificationMethod`](../interfaces/IDidVerificationMethod.md).[`id`](../interfaces/IDidVerificationMethod.md#id)

***

### publicKeyMultibase

> **publicKeyMultibase**: `string`

Defined in: [packages/method/src/utils/did-document.ts:53](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L53)

(Optional) A public key in Multibase format.

A multibase key that conforms to the draft
[Multibase specification](https://datatracker.ietf.org/doc/draft-multiformats-multibase/).

#### Implementation of

[`IDidVerificationMethod`](../interfaces/IDidVerificationMethod.md).[`publicKeyMultibase`](../interfaces/IDidVerificationMethod.md#publickeymultibase)

***

### secretKeyMultibase?

> `optional` **secretKeyMultibase**: `string`

Defined in: [packages/method/src/utils/did-document.ts:54](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L54)

#### Implementation of

[`IDidVerificationMethod`](../interfaces/IDidVerificationMethod.md).[`secretKeyMultibase`](../interfaces/IDidVerificationMethod.md#secretkeymultibase)

***

### type

> **type**: `string`

Defined in: [packages/method/src/utils/did-document.ts:51](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L51)

The type of the verification method.

To maximize interoperability this value SHOULD be one of the valid verification method types
registered in the [DID Specification Registries](https://www.w3.org/TR/did-spec-registries/#verification-method-types).

#### Implementation of

[`IDidVerificationMethod`](../interfaces/IDidVerificationMethod.md).[`type`](../interfaces/IDidVerificationMethod.md#type)
