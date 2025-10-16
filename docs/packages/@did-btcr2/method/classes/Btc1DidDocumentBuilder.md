# Class: Btc1DidDocumentBuilder

Defined in: [packages/method/src/utils/did-document-builder.ts:5](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document-builder.ts#L5)

## Constructors

### Constructor

> **new Btc1DidDocumentBuilder**(`initialDocument`): `Btc1DidDocumentBuilder`

Defined in: [packages/method/src/utils/did-document-builder.ts:8](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document-builder.ts#L8)

#### Parameters

##### initialDocument

`Partial`&lt;[`DidDocument`](DidDocument.md)&gt;

#### Returns

`Btc1DidDocumentBuilder`

## Methods

### build()

> **build**(): [`DidDocument`](DidDocument.md)

Defined in: [packages/method/src/utils/did-document-builder.ts:62](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document-builder.ts#L62)

#### Returns

[`DidDocument`](DidDocument.md)

***

### withAssertionMethod()

> **withAssertionMethod**(`assertionMethod`): `this`

Defined in: [packages/method/src/utils/did-document-builder.ts:34](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document-builder.ts#L34)

#### Parameters

##### assertionMethod

(`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

#### Returns

`this`

***

### withAuthentication()

> **withAuthentication**(`authentication`): `this`

Defined in: [packages/method/src/utils/did-document-builder.ts:27](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document-builder.ts#L27)

#### Parameters

##### authentication

(`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

#### Returns

`this`

***

### withCapabilityDelegation()

> **withCapabilityDelegation**(`capabilityDelegation`): `this`

Defined in: [packages/method/src/utils/did-document-builder.ts:48](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document-builder.ts#L48)

#### Parameters

##### capabilityDelegation

(`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

#### Returns

`this`

***

### withCapabilityInvocation()

> **withCapabilityInvocation**(`capabilityInvocation`): `this`

Defined in: [packages/method/src/utils/did-document-builder.ts:41](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document-builder.ts#L41)

#### Parameters

##### capabilityInvocation

(`string` \| [`DidVerificationMethod`](DidVerificationMethod.md))[]

#### Returns

`this`

***

### withController()

> **withController**(`controller?`): `this`

Defined in: [packages/method/src/utils/did-document-builder.ts:20](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document-builder.ts#L20)

#### Parameters

##### controller?

`string`[]

#### Returns

`this`

***

### withService()

> **withService**(`service`): `this`

Defined in: [packages/method/src/utils/did-document-builder.ts:55](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/utils/did-document-builder.ts#L55)

#### Parameters

##### service

[`BeaconService`](../interfaces/BeaconService.md)[]

#### Returns

`this`
