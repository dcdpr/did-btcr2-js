# Class: DidDocument

Defined in: [packages/method/src/utils/did-document.ts:111](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L111)

BTCR2 DID Document extends the DidDocument class adding helper methods and properties
 DidDocument

## Implements

## Extended by

- [`IntermediateDidDocument`](IntermediateDidDocument.md)

## Implements

- [`IDidDocument`](../interfaces/IDidDocument.md)

## Constructors

### Constructor

> **new DidDocument**(`document`): `DidDocument`

Defined in: [packages/method/src/utils/did-document.ts:122](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L122)

#### Parameters

##### document

[`IDidDocument`](../interfaces/IDidDocument.md)

#### Returns

`DidDocument`

## Properties

### @context?

> `optional` **@context**: (`string` \| [`JSONObject`](../../common/type-aliases/JSONObject.md))[] = `BTCR2_DID_DOCUMENT_CONTEXT`

Defined in: [packages/method/src/utils/did-document.ts:114](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L114)

A JSON-LD context link, which provides a JSON-LD processor with the information necessary to
interpret the DID document JSON. The default context URL is 'https://www.w3.org/ns/did/v1'.

#### Implementation of

[`IDidDocument`](../interfaces/IDidDocument.md).[`@context`](../interfaces/IDidDocument.md#context)

***

### assertionMethod?

> `optional` **assertionMethod**: (`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:117](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L117)

The assertion methods of the DID Document.

#### Implementation of

[`IDidDocument`](../interfaces/IDidDocument.md).[`assertionMethod`](../interfaces/IDidDocument.md#assertionmethod)

***

### authentication?

> `optional` **authentication**: (`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:116](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L116)

The authentication methods of the DID Document.

#### Implementation of

[`IDidDocument`](../interfaces/IDidDocument.md).[`authentication`](../interfaces/IDidDocument.md#authentication)

***

### capabilityDelegation?

> `optional` **capabilityDelegation**: (`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:119](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L119)

The capability delegation methods of the DID Document.

#### Implementation of

[`IDidDocument`](../interfaces/IDidDocument.md).[`capabilityDelegation`](../interfaces/IDidDocument.md#capabilitydelegation)

***

### capabilityInvocation?

> `optional` **capabilityInvocation**: (`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:118](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L118)

The capability invocation methods of the DID Document.

#### Implementation of

[`IDidDocument`](../interfaces/IDidDocument.md).[`capabilityInvocation`](../interfaces/IDidDocument.md#capabilityinvocation)

***

### controller?

> `optional` **controller**: `string`[]

Defined in: [packages/method/src/utils/did-document.ts:113](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L113)

The controller of the DID Document.

#### Implementation of

[`IDidDocument`](../interfaces/IDidDocument.md).[`controller`](../interfaces/IDidDocument.md#controller)

***

### id

> **id**: `string`

Defined in: [packages/method/src/utils/did-document.ts:112](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L112)

The identifier of the DID Document.

#### Implementation of

[`IDidDocument`](../interfaces/IDidDocument.md).[`id`](../interfaces/IDidDocument.md#id)

***

### service

> **service**: [`BeaconService`](../interfaces/BeaconService.md)[]

Defined in: [packages/method/src/utils/did-document.ts:120](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L120)

The services of the DID Document.

#### Implementation of

[`IDidDocument`](../interfaces/IDidDocument.md).[`service`](../interfaces/IDidDocument.md#service)

***

### verificationMethod

> **verificationMethod**: [`DidVerificationMethod`](DidVerificationMethod.md)[]

Defined in: [packages/method/src/utils/did-document.ts:115](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L115)

The verification methods of the DID Document.

#### Implementation of

[`IDidDocument`](../interfaces/IDidDocument.md).[`verificationMethod`](../interfaces/IDidDocument.md#verificationmethod)

## Methods

### json()

> **json**(): [`JSONObject`](../../common/type-aliases/JSONObject.md)

Defined in: [packages/method/src/utils/did-document.ts:184](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L184)

Convert the DidDocument to a JSON object.

#### Returns

[`JSONObject`](../../common/type-aliases/JSONObject.md)

The JSON representation of the DidDocument.

***

### toIntermediate()

> **toIntermediate**(): [`IntermediateDidDocument`](IntermediateDidDocument.md)

Defined in: [packages/method/src/utils/did-document.ts:418](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L418)

Convert the DidDocument to an IntermediateDidDocument.

#### Returns

[`IntermediateDidDocument`](IntermediateDidDocument.md)

The IntermediateDidDocument representation of the DidDocument.

***

### validateIntermediate()

> **validateIntermediate**(): `void`

Defined in: [packages/method/src/utils/did-document.ts:391](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L391)

Validate the IntermediateDidDocument.

#### Returns

`void`

True if the IntermediateDidDocument is valid.

***

### fromExternalIdentifier()

> `static` **fromExternalIdentifier**(`data`): `DidDocument`

Defined in: [packages/method/src/utils/did-document.ts:232](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L232)

Create a DidDocument from "x1" btcr2 identifier.

#### Parameters

##### data

[`ExternalData`](../type-aliases/ExternalData.md)

The verification methods of the DID Document.

#### Returns

`DidDocument`

A new DidDocument.

***

### fromKeyIdentifier()

> `static` **fromKeyIdentifier**(`id`, `publicKeyMultibase`, `service`): `DidDocument`

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

`DidDocument`

A new DidDocument with the placeholder ID.

***

### isValid()

> `static` **isValid**(`didDocument`): `boolean`

Defined in: [packages/method/src/utils/did-document.ts:256](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L256)

Validates a DidDocument by breaking it into modular validation methods.

#### Parameters

##### didDocument

`DidDocument`

The DID document to validate.

#### Returns

`boolean`

True if the DID document is valid.

#### Throws

If any validation check fails.

***

### sanitize()

> `static` **sanitize**(`doc`): `DidDocument`

Defined in: [packages/method/src/utils/did-document.ts:241](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L241)

Sanitize the DID Document by removing undefined values

#### Parameters

##### doc

`DidDocument`

#### Returns

`DidDocument`

The sanitized DID Document

***

### validate()

> `static` **validate**(`didDocument`): `DidDocument`

Defined in: [packages/method/src/utils/did-document.ts:376](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L376)

Validate the DID Document

#### Parameters

##### didDocument

`DidDocument` | [`IntermediateDidDocument`](IntermediateDidDocument.md)

#### Returns

`DidDocument`

Validated DID Document.

#### Throws

If the DID Document is invalid.
