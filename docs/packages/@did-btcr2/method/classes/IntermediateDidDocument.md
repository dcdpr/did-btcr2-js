# Class: IntermediateDidDocument

Defined in: [packages/method/src/utils/did-document.ts:433](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L433)

IntermediateDidDocument extends the DidDocument class for creating and managing intermediate DID documents.
This class is used to create a minimal DID document with a placeholder ID.
It is used in the process of creating a new DID document.
 IntermediateDidDocument

## Extends

- [`DidDocument`](DidDocument.md)

## Constructors

### Constructor

> **new IntermediateDidDocument**(`document`): `IntermediateDidDocument`

Defined in: [packages/method/src/utils/did-document.ts:434](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L434)

#### Parameters

##### document

[`IDidDocument`](../interfaces/IDidDocument.md)

#### Returns

`IntermediateDidDocument`

#### Overrides

[`DidDocument`](DidDocument.md).[`constructor`](DidDocument.md#constructor)

## Properties

### @context?

> `optional` **@context**: (`string` \| [`JSONObject`](../../common/type-aliases/JSONObject.md))[] = `BTCR2_DID_DOCUMENT_CONTEXT`

Defined in: [packages/method/src/utils/did-document.ts:114](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L114)

A JSON-LD context link, which provides a JSON-LD processor with the information necessary to
interpret the DID document JSON. The default context URL is 'https://www.w3.org/ns/did/v1'.

#### Inherited from

[`DidDocument`](DidDocument.md).[`@context`](DidDocument.md#context)

***

### assertionMethod?

> `optional` **assertionMethod**: (`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:117](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L117)

The assertion methods of the DID Document.

#### Inherited from

[`DidDocument`](DidDocument.md).[`assertionMethod`](DidDocument.md#assertionmethod)

***

### authentication?

> `optional` **authentication**: (`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:116](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L116)

The authentication methods of the DID Document.

#### Inherited from

[`DidDocument`](DidDocument.md).[`authentication`](DidDocument.md#authentication)

***

### capabilityDelegation?

> `optional` **capabilityDelegation**: (`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:119](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L119)

The capability delegation methods of the DID Document.

#### Inherited from

[`DidDocument`](DidDocument.md).[`capabilityDelegation`](DidDocument.md#capabilitydelegation)

***

### capabilityInvocation?

> `optional` **capabilityInvocation**: (`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:118](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L118)

The capability invocation methods of the DID Document.

#### Inherited from

[`DidDocument`](DidDocument.md).[`capabilityInvocation`](DidDocument.md#capabilityinvocation)

***

### controller?

> `optional` **controller**: `string`[]

Defined in: [packages/method/src/utils/did-document.ts:113](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L113)

The controller of the DID Document.

#### Inherited from

[`DidDocument`](DidDocument.md).[`controller`](DidDocument.md#controller)

***

### id

> **id**: `string`

Defined in: [packages/method/src/utils/did-document.ts:112](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L112)

The identifier of the DID Document.

#### Inherited from

[`DidDocument`](DidDocument.md).[`id`](DidDocument.md#id)

***

### service

> **service**: [`BeaconService`](../interfaces/BeaconService.md)[]

Defined in: [packages/method/src/utils/did-document.ts:120](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L120)

The services of the DID Document.

#### Inherited from

[`DidDocument`](DidDocument.md).[`service`](DidDocument.md#service)

***

### verificationMethod

> **verificationMethod**: [`DidVerificationMethod`](DidVerificationMethod.md)[]

Defined in: [packages/method/src/utils/did-document.ts:115](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L115)

The verification methods of the DID Document.

#### Inherited from

[`DidDocument`](DidDocument.md).[`verificationMethod`](DidDocument.md#verificationmethod)

## Methods

### json()

> **json**(): [`JSONObject`](../../common/type-aliases/JSONObject.md)

Defined in: [packages/method/src/utils/did-document.ts:184](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L184)

Convert the DidDocument to a JSON object.

#### Returns

[`JSONObject`](../../common/type-aliases/JSONObject.md)

The JSON representation of the DidDocument.

#### Inherited from

[`DidDocument`](DidDocument.md).[`json`](DidDocument.md#json)

***

### toDidDocument()

> **toDidDocument**(`did`): [`DidDocument`](DidDocument.md)

Defined in: [packages/method/src/utils/did-document.ts:460](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L460)

Convert the IntermediateDidDocument to a DidDocument by replacing the placeholder value with the provided DID.

#### Parameters

##### did

`string`

The DID to replace the placeholder value in the document.

#### Returns

[`DidDocument`](DidDocument.md)

A new DidDocument with the placeholder value replaced by the provided DID.

***

### toIntermediate()

> **toIntermediate**(): `IntermediateDidDocument`

Defined in: [packages/method/src/utils/did-document.ts:418](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L418)

Convert the DidDocument to an IntermediateDidDocument.

#### Returns

`IntermediateDidDocument`

The IntermediateDidDocument representation of the DidDocument.

#### Inherited from

[`DidDocument`](DidDocument.md).[`toIntermediate`](DidDocument.md#tointermediate)

***

### validateIntermediate()

> **validateIntermediate**(): `void`

Defined in: [packages/method/src/utils/did-document.ts:391](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L391)

Validate the IntermediateDidDocument.

#### Returns

`void`

True if the IntermediateDidDocument is valid.

#### Inherited from

[`DidDocument`](DidDocument.md).[`validateIntermediate`](DidDocument.md#validateintermediate)

***

### create()

> `static` **create**(`verificationMethod`, `relationships`, `service`): `IntermediateDidDocument`

Defined in: [packages/method/src/utils/did-document.ts:446](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L446)

Create a minimal IntermediateDidDocument with a placeholder ID.

#### Parameters

##### verificationMethod

[`DidVerificationMethod`](DidVerificationMethod.md)[]

The public key in multibase format.

##### relationships

[`VerificationRelationships`](../type-aliases/VerificationRelationships.md)

The public key in multibase format.

##### service

[`BeaconService`](../interfaces/BeaconService.md)[]

The service to be included in the document.

#### Returns

`IntermediateDidDocument`

A new IntermediateDidDocument with the placeholder ID.

***

### from()

> `static` **from**(`object`): [`DidDocument`](DidDocument.md)

Defined in: [packages/method/src/utils/did-document.ts:471](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L471)

Create a DidDocument from a JSON object.

#### Parameters

##### object

[`JSONObject`](../../common/type-aliases/JSONObject.md)

The JSON object to convert.

#### Returns

[`DidDocument`](DidDocument.md)

The created DidDocument.

***

### fromExternalIdentifier()

> `static` **fromExternalIdentifier**(`data`): [`DidDocument`](DidDocument.md)

Defined in: [packages/method/src/utils/did-document.ts:232](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L232)

Create a DidDocument from "x1" btcr2 identifier.

#### Parameters

##### data

[`ExternalData`](../type-aliases/ExternalData.md)

The verification methods of the DID Document.

#### Returns

[`DidDocument`](DidDocument.md)

A new DidDocument.

#### Inherited from

[`DidDocument`](DidDocument.md).[`fromExternalIdentifier`](DidDocument.md#fromexternalidentifier)

***

### fromKeyIdentifier()

> `static` **fromKeyIdentifier**(`id`, `publicKeyMultibase`, `service`): [`DidDocument`](DidDocument.md)

Defined in: [packages/method/src/utils/did-document.ts:204](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L204)

Create a minimal DidDocument from "k1" btcr2 identifier.

#### Parameters

##### id

`string`

##### publicKeyMultibase

`string`

The public key in multibase format.

##### service

[`BeaconService`](../interfaces/BeaconService.md)[]

The beacon services to be included in the document.

#### Returns

[`DidDocument`](DidDocument.md)

A new DidDocument with the placeholder ID.

#### Inherited from

[`DidDocument`](DidDocument.md).[`fromKeyIdentifier`](DidDocument.md#fromkeyidentifier)

***

### isValid()

> `static` **isValid**(`didDocument`): `boolean`

Defined in: [packages/method/src/utils/did-document.ts:256](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L256)

Validates a DidDocument by breaking it into modular validation methods.

#### Parameters

##### didDocument

[`DidDocument`](DidDocument.md)

The DID document to validate.

#### Returns

`boolean`

True if the DID document is valid.

#### Throws

If any validation check fails.

#### Inherited from

[`DidDocument`](DidDocument.md).[`isValid`](DidDocument.md#isvalid)

***

### sanitize()

> `static` **sanitize**(`doc`): [`DidDocument`](DidDocument.md)

Defined in: [packages/method/src/utils/did-document.ts:241](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L241)

Sanitize the DID Document by removing undefined values

#### Parameters

##### doc

[`DidDocument`](DidDocument.md)

#### Returns

[`DidDocument`](DidDocument.md)

The sanitized DID Document

#### Inherited from

[`DidDocument`](DidDocument.md).[`sanitize`](DidDocument.md#sanitize)

***

### validate()

> `static` **validate**(`didDocument`): [`DidDocument`](DidDocument.md)

Defined in: [packages/method/src/utils/did-document.ts:376](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L376)

Validate the DID Document

#### Parameters

##### didDocument

[`DidDocument`](DidDocument.md) | `IntermediateDidDocument`

#### Returns

[`DidDocument`](DidDocument.md)

Validated DID Document.

#### Throws

If the DID Document is invalid.

#### Inherited from

[`DidDocument`](DidDocument.md).[`validate`](DidDocument.md#validate)
