# Class: Update

Defined in: [packages/method/src/core/crud/update.ts:42](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/update.ts#L42)

Implements [4.3 Update](https://dcdpr.github.io/did-btcr2/#update).

An update to a did:btcr2 document is an invoked capability using the ZCAP-LD
data format, signed by a verificationMethod that has the authority to make
the update as specified in the previous DID document. Capability invocations
for updates MUST be authorized using Data Integrity following the
bip340-jcs-2025 cryptosuite with a proofPurpose of capabilityInvocation.

 Update

## Constructors

### Constructor

> **new Update**(): `Update`

#### Returns

`Update`

## Methods

### announce()

> `static` **announce**(`params`): `Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

Defined in: [packages/method/src/core/crud/update.ts:221](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/update.ts#L221)

Implements [4.3.3 Announce DID Update](https://dcdpr.github.io/did-btcr2/#announce-did-update).

The Announce DID Update algorithm retrieves beaconServices from the sourceDocument and calls the Broadcast DID
Update algorithm corresponding to the type of the Beacon. It takes in a Identifier, sourceDocument, an array of
beaconIds, and a didUpdateInvocation. It returns an array of signalsMetadata, containing the necessary
data to validate the Beacon Signal against the didUpdateInvocation.

#### Parameters

##### params

Required params for calling the announcePayload method

###### beaconIds

`string`[]

The didUpdatePayload object to be signed

###### didUpdateInvocation

[`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)

###### sourceDocument

[`DidDocument`](DidDocument.md)

The did-btcr2 did document to derive the root capability from

#### Returns

`Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

The signalsMetadata object containing data to validate the Beacon Signal

#### Throws

if the beaconService type is invalid

***

### construct()

> `static` **construct**(`params`): `Promise`&lt;[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

Defined in: [packages/method/src/core/crud/update.ts:58](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/update.ts#L58)

Implements [4.3.1 Construct DID Update Payload](https://dcdpr.github.io/did-btcr2/#construct-did-update-payload).

The Construct DID Update Payload algorithm applies the documentPatch to the sourceDocument and verifies the
resulting targetDocument is a conformant DID document. It takes in a Identifier, sourceDocument,
sourceVersionId, and documentPatch objects. It returns an unsigned DID Update Payload.

#### Parameters

##### params

See  ConstructPayloadParams for more details.

###### identifier

`string`

The did-btcr2 identifier to use for verification.

###### patch

[`PatchOperation`](../../common/interfaces/PatchOperation.md)[]

The JSON patch to be applied to the source document.

###### sourceDocument

[`DidDocument`](DidDocument.md)

The source document to be updated.

###### sourceVersionId

`number`

The versionId of the source document.

#### Returns

`Promise`&lt;[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

The constructed DidUpdatePayload object.

#### Throws

InvalidDid if sourceDocument.id does not match identifier.

***

### invoke()

> `static` **invoke**(`params`): `Promise`&lt;[`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)&gt;

Defined in: [packages/method/src/core/crud/update.ts:129](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/update.ts#L129)

[4.3.2 Invoke DID Update Payload](https://dcdpr.github.io/did-btcr2/#invoke-did-update-payload).

The Invoke DID Update Payload algorithm takes in a Identifier, an unsigned didUpdatePayload, and a
verificationMethod. It retrieves the privateKeyBytes for the verificationMethod and adds a capability invocation in
the form of a Data Integrity proof following the Authorization Capabilities (ZCAP-LD) and VC Data Integrity
specifications. It returns the invoked DID Update Payload.

#### Parameters

##### params

Required params for calling the invokePayload method

###### didUpdatePayload

[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)

The updatePayload object to be signed

###### identifier

`string`

The did-btcr2 identifier to derive the root capability from

###### verificationMethod

[`DidVerificationMethod`](DidVerificationMethod.md)

The verificationMethod object to be used for signing

#### Returns

`Promise`&lt;[`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)&gt;

Did update payload secured with a proof => DidUpdateInvocation

#### Throws

if the privateKeyBytes are invalid
