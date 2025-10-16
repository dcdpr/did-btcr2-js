# Interface: IDidVerificationMethod

Defined in: [packages/method/src/utils/did-document.ts:35](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L35)

## Extends

- `DidVerificationMethod`

## Properties

### controller

> **controller**: `string`

Defined in: [packages/method/src/utils/did-document.ts:38](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L38)

The DID of the entity that controls this verification method.

#### Overrides

`IIDidVerificationMethod.controller`

***

### id

> **id**: `string`

Defined in: [packages/method/src/utils/did-document.ts:36](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L36)

The identifier of the verification method, which must be a URI.

#### Overrides

`IIDidVerificationMethod.id`

***

### publicKeyJwk?

> `optional` **publicKeyJwk**: `Jwk`

Defined in: node\_modules/.pnpm/@web5+dids@1.2.0/node\_modules/@web5/dids/dist/types/types/did-core.d.ts:465

(Optional) A public key in JWK format.

A JSON Web Key (JWK) that conforms to [RFC 7517](https://datatracker.ietf.org/doc/html/rfc7517).

#### Inherited from

`IIDidVerificationMethod.publicKeyJwk`

***

### publicKeyMultibase

> **publicKeyMultibase**: `string`

Defined in: [packages/method/src/utils/did-document.ts:39](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L39)

(Optional) A public key in Multibase format.

A multibase key that conforms to the draft
[Multibase specification](https://datatracker.ietf.org/doc/draft-multiformats-multibase/).

#### Overrides

`IIDidVerificationMethod.publicKeyMultibase`

***

### secretKeyMultibase?

> `optional` **secretKeyMultibase**: `string`

Defined in: [packages/method/src/utils/did-document.ts:40](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L40)

***

### type

> **type**: `string`

Defined in: [packages/method/src/utils/did-document.ts:37](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L37)

The type of the verification method.

To maximize interoperability this value SHOULD be one of the valid verification method types
registered in the [DID Specification Registries](https://www.w3.org/TR/did-spec-registries/#verification-method-types).

#### Overrides

`IIDidVerificationMethod.type`
