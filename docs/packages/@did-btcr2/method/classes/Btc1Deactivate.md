# Class: Btc1Deactivate

Defined in: [packages/method/src/core/crud/deactivate.ts:13](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/deactivate.ts#L13)

Implements [4.4 Deactivate](https://dcdpr.github.io/did-btcr2/#deactivate)
To deactivate a did:btcr2, the DID controller MUST add the property deactivated with the value true on the DID
document. To do this, the DID controller constructs a valid DID Update Payload with a JSON patch that adds this
property and announces the payload through a Beacon in their current DID document following the algorithm in Update.
Once a did:btcr2 has been deactivated this state is considered permanent and resolution MUST terminate.
 Btc1Deactivate

## Extends

- [`DidBtcr2`](DidBtcr2.md)

## Constructors

### Constructor

> **new Btc1Deactivate**(): `Btc1Deactivate`

#### Returns

`Btc1Deactivate`

#### Inherited from

[`DidBtcr2`](DidBtcr2.md).[`constructor`](DidBtcr2.md#constructor)

## Properties

### methodName

> `static` **methodName**: `string` = `'btcr2'`

Defined in: [packages/method/src/did-btcr2.ts:44](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/did-btcr2.ts#L44)

#### Inherited from

[`DidBtcr2`](DidBtcr2.md).[`methodName`](DidBtcr2.md#methodname)

## Methods

### create()

> `static` **create**(`params`): `Promise`&lt;[`CreateResponse`](../type-aliases/CreateResponse.md)&gt;

Defined in: [packages/method/src/did-btcr2.ts:64](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/did-btcr2.ts#L64)

Entry point for section [4.1 Create](https://dcdpr.github.io/did-btcr2/#create).
See [Create](Create.md) for implementation details.

A did:btcr2 identifier and associated DID document can either be created deterministically from a cryptographic
seed, or it can be created from an arbitrary genesis intermediate DID document representation. In both cases,
DID creation can be undertaken in an offline manner, i.e., the DID controller does not need to interact with the
Bitcoin network to create their DID.

#### Parameters

##### params

[`CreateParams`](../type-aliases/CreateParams.md)

See [CreateParams](../type-aliases/CreateParams.md) for details.

#### Returns

`Promise`&lt;[`CreateResponse`](../type-aliases/CreateResponse.md)&gt;

Promise resolving to a CreateResponse object.

#### Throws

if any of the checks fail

#### Inherited from

[`DidBtcr2`](DidBtcr2.md).[`create`](DidBtcr2.md#create)

***

### getSigningMethod()

> `static` **getSigningMethod**(`params`): [`DidVerificationMethod`](DidVerificationMethod.md)

Defined in: [packages/method/src/did-btcr2.ts:256](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/did-btcr2.ts#L256)

Given the W3C DID Document of a `did:btcr2` identifier, return the signing verification method that will be used
for signing messages and credentials. If given, the `methodId` parameter is used to select the
verification method. If not given, the Identity Key's verification method with an ID fragment
of '#initialKey' is used.

#### Parameters

##### params

Parameters for the `getSigningMethod` method.

###### didDocument

[`DidDocument`](DidDocument.md)

DID Document to get the verification method from.

###### methodId?

`string`

Optional ID of the verification method to use for signing.

#### Returns

[`DidVerificationMethod`](DidVerificationMethod.md)

Promise resolving to the [DidVerificationMethod](DidVerificationMethod.md) object used for signing.

#### Throws

if the parsed did method does not match `btcr2` or signing method could not be determined.

#### Inherited from

[`DidBtcr2`](DidBtcr2.md).[`getSigningMethod`](DidBtcr2.md#getsigningmethod)

***

### resolve()

> `static` **resolve**(`identifier`, `resolutionsOptions?`): `Promise`&lt;`DidResolutionResult`&gt;

Defined in: [packages/method/src/did-btcr2.ts:115](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/did-btcr2.ts#L115)

Entry point for section [7.2 Read](https://dcdpr.github.io/did-btcr2/#read).
See [Resolve](Resolve.md) for implementation details.

The Read operation is an algorithm consisting of a series of subroutine algorithms executed by a resolver after a
resolution request identifying a specific did:btcr2 identifier is received from a client at Resolution Time. The
request MUST always contain the resolutionOptions object containing additional information to be used in resolution.
This object MAY be empty. See the DID Resolution specification for further details about the DID Resolution Options
object. The resolver then attempts to resolve the DID document of the identifier at a specific Target Time. The
Target Time is either provided in resolutionOptions or is set to the Resolution Time of the request.

#### Parameters

##### identifier

`string`

a valid did:btcr2 identifier to be resolved

##### resolutionsOptions?

[`DidResolutionOptions`](../interfaces/DidResolutionOptions.md) = `{}`

see [DidResolutionOptions](https://www.w3.org/TR/did-1.0/#did-resolution-options)

#### Returns

`Promise`&lt;`DidResolutionResult`&gt;

Promise resolving to a DID Resolution Result containing the `targetDocument`

#### Throws

if the resolution fails for any reason

#### Throws

InvalidDid if the identifier is invalid

#### Example

```ts
const resolution = await DidBtcr2.resolve('did:btcr2:k1q0dygyp3gz969tp46dychzy4q78c2k3js68kvyr0shanzg67jnuez2cfplh')
```

#### Inherited from

[`DidBtcr2`](DidBtcr2.md).[`resolve`](DidBtcr2.md#resolve)

***

### update()

> `static` **update**(`params`): `Promise`&lt;`any`&gt;

Defined in: [packages/method/src/did-btcr2.ts:182](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/did-btcr2.ts#L182)

Entry point for section [4.3 Update](https://dcdpr.github.io/did-btcr2/#update).
See [Update](Update.md) for implementation details.

An update to a did:btcr2 document is an invoked capability using the ZCAP-LD data format, signed by a
verificationMethod that has the authority to make the update as specified in the previous DID document. Capability
invocations for updates MUST be authorized using Data Integrity following the bip340-jcs-2025
cryptosuite with a proofPurpose of capabilityInvocation.

The Update algorithm takes as inputs a Identifier, sourceDocument, sourceVersionId, documentPatch, a
verificationMethodId and an array of beaconIds. The sourceDocument is the DID document being updated. The
documentPatch is a JSON Patch object containing a set of transformations to be applied to the sourceDocument.
The result of these transformations MUST produce a DID document conformant to the DID Core specification. The
verificationMethodId is an identifier for a verificationMethod within the sourceDocument. The verificationMethod
identified MUST be a BIP340 Multikey. The beaconIds MUST identify service endpoints with one of the three Beacon
Types SingletonBeacon, CIDAggregateBeacon, and SMTAggregateBeacon.

#### Parameters

##### params

Required parameters for the update operation.

###### beaconIds

`string`[]

The beacon IDs to announce the update

###### identifier

`string`

The btcr2 identifier to be updated.

###### patch

[`PatchOperation`](../../common/interfaces/PatchOperation.md)[]

###### sourceDocument

[`DidDocument`](DidDocument.md)

The DID document being updated.

###### sourceVersionId

`number`

The versionId of the source document.

###### verificationMethodId

`string`

The verificationMethod ID to sign the update

#### Returns

`Promise`&lt;`any`&gt;

Promise resolving to void

#### Throws

if the verificationMethod type is not `Multikey` or the publicKeyMultibase header is not `zQ3s`

#### Inherited from

[`DidBtcr2`](DidBtcr2.md).[`update`](DidBtcr2.md#update)
