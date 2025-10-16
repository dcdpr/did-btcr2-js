# Interface: BeaconService

Defined in: [packages/method/src/interfaces/ibeacon.ts:60](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L60)

## Extends

- `DidService`

## Extended by

- [`BeaconServiceAddress`](BeaconServiceAddress.md)

## Indexable

\[`key`: `string`\]: `any`

## Properties

### casType?

> `optional` **casType**: `string`

Defined in: [packages/method/src/interfaces/ibeacon.ts:62](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L62)

***

### id

> **id**: `string`

Defined in: node\_modules/.pnpm/@web5+dids@1.2.0/node\_modules/@web5/dids/dist/types/types/did-core.d.ts:403

Identifier of the service.

The `id` property is REQUIRED. It MUST be a URI conforming to
[RFC3986](https://datatracker.ietf.org/doc/html/rfc3986) and MUST be unique within the
DID document.

#### Inherited from

`IDidService.id`

***

### serviceEndpoint

> **serviceEndpoint**: `DidServiceEndpoint`

Defined in: [packages/method/src/interfaces/ibeacon.ts:61](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L61)

A URI that can be used to interact with the DID service.

The value of the `serviceEndpoint` property MUST be a string, an object containing key/value
pairs, or an array composed of strings or objects. All string values MUST be valid URIs
conforming to [RFC3986](https://datatracker.ietf.org/doc/html/rfc3986).

#### Overrides

`IDidService.serviceEndpoint`

***

### type

> **type**: `string`

Defined in: node\_modules/.pnpm/@web5+dids@1.2.0/node\_modules/@web5/dids/dist/types/types/did-core.d.ts:413

The type of service being described.

The `type` property is REQUIRED. It MUST be a string. To maximize interoperability, the value
SHOULD be registered in the
[DID Specification Registries](https://www.w3.org/TR/did-spec-registries/). Examples of
service types can be found in
[§ Service Types](https://www.w3.org/TR/did-spec-registries/#service-types).

#### Inherited from

`IDidService.type`
