# Interface: IDidDocument

Defined in: [packages/method/src/utils/did-document.ts:84](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L84)

BTCR2 DID Document Interface
 IDidDocument

## Extends

- `DidDocument`

## Properties

### @context?

> `optional` **@context**: (`string` \| [`JSONObject`](../../common/type-aliases/JSONObject.md))[]

Defined in: [packages/method/src/utils/did-document.ts:87](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L87)

A JSON-LD context link, which provides a JSON-LD processor with the information necessary to
interpret the DID document JSON. The default context URL is 'https://www.w3.org/ns/did/v1'.

#### Overrides

`IIDidDocument.@context`

***

### alsoKnownAs?

> `optional` **alsoKnownAs**: `string`[]

Defined in: node\_modules/.pnpm/@web5+dids@1.2.0/node\_modules/@web5/dids/dist/types/types/did-core.d.ts:121

A DID subject can have multiple identifiers for different purposes, or at different times.
The assertion that two or more DIDs (or other types of URI) refer to the same DID subject can
be made using the `alsoKnownAs` property.

#### See

[DID Core Specification, § Also Known As](https://www.w3.org/TR/did-core/#also-known-as)

#### Inherited from

`IIDidDocument.alsoKnownAs`

***

### assertionMethod?

> `optional` **assertionMethod**: (`string` \| [`DidVerificationMethod`](../classes/DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:90](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L90)

The assertion methods of the DID Document.

#### Overrides

`IIDidDocument.assertionMethod`

***

### authentication?

> `optional` **authentication**: (`string` \| [`DidVerificationMethod`](../classes/DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:89](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L89)

The authentication methods of the DID Document.

#### Overrides

`IIDidDocument.authentication`

***

### capabilityDelegation?

> `optional` **capabilityDelegation**: (`string` \| [`DidVerificationMethod`](../classes/DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:92](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L92)

The capability delegation methods of the DID Document.

#### Overrides

`IIDidDocument.capabilityDelegation`

***

### capabilityInvocation?

> `optional` **capabilityInvocation**: (`string` \| [`DidVerificationMethod`](../classes/DidVerificationMethod.md))[]

Defined in: [packages/method/src/utils/did-document.ts:91](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L91)

The capability invocation methods of the DID Document.

#### Overrides

`IIDidDocument.capabilityInvocation`

***

### controller?

> `optional` **controller**: `string`[]

Defined in: [packages/method/src/utils/did-document.ts:86](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L86)

The controller of the DID Document.

#### Overrides

`IIDidDocument.controller`

***

### id

> **id**: `string`

Defined in: [packages/method/src/utils/did-document.ts:85](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L85)

The identifier of the DID Document.

#### Overrides

`IIDidDocument.id`

***

### keyAgreement?

> `optional` **keyAgreement**: (`string` \| `DidVerificationMethod`)[]

Defined in: node\_modules/.pnpm/@web5+dids@1.2.0/node\_modules/@web5/dids/dist/types/types/did-core.d.ts:163

The `keyAgreement` verification relationship is used to specify how an entity can generate
encryption material in order to transmit confidential  information intended for the DID
subject, such as for the purposes of establishing a secure communication channel with the
recipient.

#### See

[DID Core Specification, § Key Agreement](https://www.w3.org/TR/did-core/#key-agreement)

#### Inherited from

`IIDidDocument.keyAgreement`

***

### service

> **service**: [`BeaconService`](BeaconService.md)[]

Defined in: [packages/method/src/utils/did-document.ts:93](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L93)

The services of the DID Document.

#### Overrides

`IIDidDocument.service`

***

### verificationMethod

> **verificationMethod**: [`DidVerificationMethod`](../classes/DidVerificationMethod.md)[]

Defined in: [packages/method/src/utils/did-document.ts:88](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document.ts#L88)

The verification methods of the DID Document.

#### Overrides

`IIDidDocument.verificationMethod`
