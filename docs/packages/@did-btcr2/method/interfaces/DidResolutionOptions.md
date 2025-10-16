# Interface: DidResolutionOptions

Defined in: [packages/method/src/interfaces/crud.ts:14](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/crud.ts#L14)

Options for resolving a DID Document

## Param

The versionId for resolving the DID Document

## Param

The versionTime for resolving the DID Document

## Param

BitcoinRpc client connection

## Param

The sidecar data for resolving the DID Document

## Extends

- `DidResolutionOptions`

## Indexable

\[`key`: `string`\]: `any`

## Properties

### accept?

> `optional` **accept**: `string`

Defined in: node\_modules/.pnpm/@web5+dids@1.2.0/node\_modules/@web5/dids/dist/types/types/did-core.d.ts:337

The Media Type that the caller prefers for the returned representation of the DID Document.

This property is REQUIRED if the `resolveRepresentation` function was called. This property
MUST NOT be present if the `resolve` function was called.

The value of this property MUST be an ASCII string that is the Media Type of the conformant
representations. The caller of the `resolveRepresentation` function MUST use this value when
determining how to parse and process the `didDocumentStream` returned by this function into the
data model.

#### See

[DID Core Specification, § DID Resolution Options](https://www.w3.org/TR/did-core/#did-resolution-options)

#### Inherited from

`IDidResolutionOptions.accept`

***

### network?

> `optional` **network**: [`BitcoinNetworkNames`](../../common/enumerations/BitcoinNetworkNames.md)

Defined in: [packages/method/src/interfaces/crud.ts:18](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/crud.ts#L18)

***

### rpc?

> `optional` **rpc**: [`BitcoinRpc`](../../bitcoin/index.browser/classes/BitcoinRpc.md)

Defined in: [packages/method/src/interfaces/crud.ts:19](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/crud.ts#L19)

***

### sidecarData?

> `optional` **sidecarData**: [`SidecarData`](../type-aliases/SidecarData.md)

Defined in: [packages/method/src/interfaces/crud.ts:17](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/crud.ts#L17)

***

### versionId?

> `optional` **versionId**: `number`

Defined in: [packages/method/src/interfaces/crud.ts:15](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/crud.ts#L15)

***

### versionTime?

> `optional` **versionTime**: `number`

Defined in: [packages/method/src/interfaces/crud.ts:16](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/crud.ts#L16)
