# Class: Patch

Defined in: [packages/common/src/patch.ts:15](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/patch.ts#L15)

Implementation of [IETF RFC 6902 JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902).

JavaScript Object Notation (JSON) Patch defines a JSON document structure for expressing a sequence of operations to
apply to a JavaScript Object Notation (JSON) document; it is suitable for use with the HTTP PATCH method. The
"application/json-patch+json" media type is used to identify such patch documents.

 Patch

## Constructors

### Constructor

> **new Patch**(): `Patch`

#### Returns

`Patch`

## Methods

### apply()

> **apply**(`sourceDocument`, `operations`): [`JSONObject`](../type-aliases/JSONObject.md)

Defined in: [packages/common/src/patch.ts:23](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/patch.ts#L23)

Applies a JSON Patch to a source document and returns the patched document.

#### Parameters

##### sourceDocument

[`JSONObject`](../type-aliases/JSONObject.md)

The source document to patch.

##### operations

[`PatchOperation`](../interfaces/PatchOperation.md)[]

The JSON Patch operations to apply.

#### Returns

[`JSONObject`](../type-aliases/JSONObject.md)

The patched document.

#### Throws

If an unsupported operation is provided.

***

### create()

> **create**(`patches`): [`PatchOperation`](../interfaces/PatchOperation.md)[]

Defined in: [packages/common/src/patch.ts:82](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/patch.ts#L82)

Constructs a JSON Patch with a single operation (e.g. add service).

#### Parameters

##### patches

[`PatchOperation`](../interfaces/PatchOperation.md)[]

The patch operation to create.

#### Returns

[`PatchOperation`](../interfaces/PatchOperation.md)[]

A single-entry JSON Patch array.

***

### diff()

> **diff**(`sourceDocument`, `targetDocument`, `path`): [`PatchOperation`](../interfaces/PatchOperation.md)[]

Defined in: [packages/common/src/patch.ts:104](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/patch.ts#L104)

Find the diff between a source and target document constructing the patch operations from source =\> target.

#### Parameters

##### sourceDocument

[`JSONObject`](../type-aliases/JSONObject.md)

The original JSON object.

##### targetDocument

[`JSONObject`](../type-aliases/JSONObject.md)

The target JSON object to transform into.

##### path

`string`

#### Returns

[`PatchOperation`](../interfaces/PatchOperation.md)[]

An array of JSON Patch operations.
