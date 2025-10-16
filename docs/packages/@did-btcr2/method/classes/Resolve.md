# Class: Resolve

Defined in: [packages/method/src/core/crud/read.ts:119](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L119)

Implements [4.2 Read](https://dcdpr.github.io/did-btcr2/#read).
The read operation is executed by a resolver after a resolution request identifying a specific did:btcr2 identifier is
received from a client at Resolution Time. The request MAY contain a resolutionOptions object containing additional
information to be used in resolution. The resolver then attempts to resolve the DID document of the identifier at a
specific Target Time. The Target Time is either provided in resolutionOptions or is set to the Resolution Time of the
request.
To do so it executes the following algorithm:
 1. Let identifierComponents be the result of running the algorithm
    in Parse did:btcr2 identifier, passing in the identifier.
 2. Set initialDocument to the result of running Resolve Initial Document
    passing identifier, identifierComponents and resolutionOptions.
 3. Set targetDocument to the result of running the algorithm in Resolve
    Target Document passing in initialDocument and resolutionOptions.
 4. Return targetDocument.

 Resolve

## Constructors

### Constructor

> **new Resolve**(): `Resolve`

#### Returns

`Resolve`

## Methods

### applyDidUpdate()

> `static` **applyDidUpdate**(`params`): `Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

Defined in: [packages/method/src/core/crud/read.ts:864](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L864)

Implements [4.2.3.6 Apply DID Update](https://dcdpr.github.io/did-btcr2/#apply-did-update).

This algorithm attempts to apply a DID Update to a DID document, it first verifies the proof on the update is a
valid capabilityInvocation of the root authority over the DID being resolved. Then it applies the JSON patch
transformation to the DID document, checks the transformed DID document matches the targetHash specified by the
update and validates it is a conformant DID document before returning it. This algorithm takes inputs
contemporaryDidDocument and an update.

#### Parameters

##### params

Parameters for applyDidUpdate.

###### contemporaryDidDocument

[`DidDocument`](DidDocument.md)

The current DID Document to update.

###### update

[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)

The DID Update Payload to apply.

#### Returns

`Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

***

### cas()

> `static` **cas**(`params`): `Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

Defined in: [packages/method/src/core/crud/read.ts:256](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L256)

Implements [4.2.2.2.2 CAS Retrieval](https://dcdpr.github.io/did-btcr2/#cas-retrieval).

The CAS Retrieval algorithm attempts to retrieve an initialDocument from a Content Addressable Storage (CAS) system
by converting the bytes in the identifier into a Content Identifier (CID). It takes in an identifier and
an identifierComponents object. It returns an initialDocument.

#### Parameters

##### params

[`ResolveCas`](../interfaces/ResolveCas.md)

Required params for calling the cas method

#### Returns

`Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

The resolved DID Document object

#### Throws

if the DID Document content is invalid

***

### confirmDuplicateUpdate()

> `static` **confirmDuplicateUpdate**(`params`): `Promise`&lt;`void`&gt;

Defined in: [packages/method/src/core/crud/read.ts:820](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L820)

Implements [7.2.2.4 Confirm Duplicate Update](https://dcdpr.github.io/did-btcr2/#confirm-duplicate-update).

The Confirm Duplicate Update algorithm takes in a [DID Update Payload](../../common/interfaces/DidUpdatePayload.md) and verifies that
the update is a duplicate against the hash history of previously applied updates. The algorithm takes in an update
and an array of hashes, updateHashHistory. It throws an error if the update is not a duplicate, otherwise it
returns.

#### Parameters

##### params

Parameters for confirmDuplicateUpdate.

###### update

[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)

The DID Update Payload to confirm.

###### updateHashHistory

`string`[]

The history of hashes for previously applied updates.

#### Returns

`Promise`&lt;`void`&gt;

A promise that resolves if the update is a duplicate, otherwise throws an error.

#### Throws

if the update hash does not match the historical hash.

***

### deterministic()

> `static` **deterministic**(`params`): [`DidDocument`](DidDocument.md)

Defined in: [packages/method/src/core/crud/read.ts:132](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L132)

Implements [4.2.2.1 Deterministically Generate Initial DID Document](https://dcdpr.github.io/did-btcr2/#deterministically-generate-initial-did-document).

The Deterministically Generate Initial DID Document algorithm deterministically generates an initial DID
Document from a secp256k1 public key. It takes in a did:btcr2 identifier and a identifierComponents object and
returns an initialDocument.

#### Parameters

##### params

See [ResolveDeterministic](../interfaces/ResolveDeterministic.md) for details.

###### identifier

`string`

The did-btcr2 version.

###### identifierComponents

[`DidComponents`](../interfaces/DidComponents.md)

The decoded components of the identifier.

#### Returns

[`DidDocument`](DidDocument.md)

The resolved DID Document object.

***

### external()

> `static` **external**(`params`): `Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

Defined in: [packages/method/src/core/crud/read.ts:180](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L180)

Implements [4.2.2.2 External Resolution](https://dcdpr.github.io/did-btcr2/#external-resolution).

The External Resolution algorithm externally retrieves an intermediateDocumentRepresentation, either by retrieving
it from [Content Addressable Storage (CAS)](https://dcdpr.github.io/did-btcr2/#def-content-addressable-storage)
or from the [Sidecar Data](https://dcdpr.github.io/did-btcr2/#def-sidecar-data) provided as part of the
resolution request. It takes in a did:btcr2 identifier, a identifierComponents object and a resolutionOptions object.
It returns an initialDocument, which is a conformant DID document validated against the identifier.

#### Parameters

##### params

Required params for calling the external method.

###### identifier

`string`

The DID to be resolved.

###### identifierComponents

[`DidComponents`](../interfaces/DidComponents.md)

The decoded components of the identifier.

###### resolutionsOptions

[`DidResolutionOptions`](../interfaces/DidResolutionOptions.md)

The options for resolving the DID Document.

#### Returns

`Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

The resolved DID Document object

***

### findNextSignals()

> `static` **findNextSignals**(`params`): `Promise`&lt;[`BeaconSignal`](../interfaces/BeaconSignal.md)[]&gt;

Defined in: [packages/method/src/core/crud/read.ts:560](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L560)

Implements [4.2.3.3 Find Next Signals](https://dcdpr.github.io/did-btcr2/#find-next-signals).

The Find Next Signals algorithm finds the next Bitcoin block containing Beacon Signals from one or more of the
beacons and retuns all Beacon Signals within that block.

It takes the following inputs:
 - `contemporaryBlockhieght`: The height of the block this function is looking for Beacon Signals in.
                              An integer greater or equal to 0.
 - `targetBlockheight`: The height of the Bitcoin block that the resolution algorithm searches for Beacon Signals
                        up to. An integer greater or equal to 0.
 - `beacons`: An array of Beacon services in the contemporary DID document. Each Beacon contains properties:
     - `id`: The id of the Beacon service in the DID document. A string.
     - `type`: The type of the Beacon service in the DID document. A string whose values MUST be
                         either SingletonBeacon, CIDAggregateBeacon or SMTAggregateBeacon.
     - `serviceEndpoint`: A BIP21 URI representing a Bitcoin address.
     - `address`: The Bitcoin address decoded from the `serviceEndpoint value.
 - `network`: A string identifying the Bitcoin network of the did:btcr2 identifier. This algorithm MUST query the
              Bitcoin blockchain identified by the network.

It returns a nextSignals struct, containing the following properties:
 - blockheight: The Bitcoin blockheight for the block containing the Beacon Signals.
 - signals: An array of signals. Each signal is a struct containing the following:
     - beaconId: The id for the Beacon that the signal was announced by.
     - beaconType: The type of the Beacon that announced the signal.
     - tx: The Bitcoin transaction that is the Beacon Signal.

#### Parameters

##### params

The parameters for the findNextSignals operation.

###### beacons

[`BeaconServiceAddress`](../interfaces/BeaconServiceAddress.md)[]

The beacons to look for in the block.

###### contemporaryBlockHeight

`number`

###### network

[`BitcoinNetworkNames`](../../common/enumerations/BitcoinNetworkNames.md)

###### targetTime

`number`

#### Returns

`Promise`&lt;[`BeaconSignal`](../interfaces/BeaconSignal.md)[]&gt;

An array of BeaconSignal objects with blockHeight and signals.

***

### findSignalsRest()

> `static` **findSignalsRest**(`params`): `Promise`&lt;[`BeaconSignal`](../interfaces/BeaconSignal.md)[]&gt;

Defined in: [packages/method/src/core/crud/read.ts:677](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L677)

Helper method for the [Find Next Signals](#findnextsignals) algorithm.

#### Parameters

##### params

See [FindNextSignalsRestParams](../type-aliases/FindNextSignalsRestParams.md) for details.

###### beacons

[`BeaconService`](../interfaces/BeaconService.md)[]

The beacons to process.

#### Returns

`Promise`&lt;[`BeaconSignal`](../interfaces/BeaconSignal.md)[]&gt;

The beacon signals found in the block.

***

### initialDocument()

> `static` **initialDocument**(`params`): `Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

Defined in: [packages/method/src/core/crud/read.ts:292](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L292)

Implements [4.2.2 Resolve Initial Document](https://dcdpr.github.io/did-btcr2/#resolve-initial-document).

This algorithm resolves an initial DID document and validates it against the identifier for a specific did:btcr2.
The algorithm takes in a did:btcr2 identifier, identifier components object, resolutionsOptions object and returns
a valid initialDocument for that identifier.

#### Parameters

##### params

See [ResolveInitialDocument](../type-aliases/ResolveInitialDocument.md) for parameter details.

###### identifier

`string`

The DID to be resolved.

###### identifierComponents

[`DidComponents`](../interfaces/DidComponents.md)

The decoded components of the identifier.

###### resolutionsOptions

[`DidResolutionOptions`](../interfaces/DidResolutionOptions.md)

Options for resolving the DID Document. See [DidResolutionOptions](../interfaces/DidResolutionOptions.md).

#### Returns

`Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

The resolved DID Document object.

#### Throws

if the DID hrp is invalid, no sidecarData passed and hrp = "x".

***

### processBeaconSignal()

> `static` **processBeaconSignal**(`signal`, `signalsMetadata`): `Promise`&lt;[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

Defined in: [packages/method/src/core/crud/read.ts:736](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L736)

Implements [4.2.3.4 Process Beacon Signals](https://dcdpr.github.io/did-btcr2/#process-beacon-signals).

The Process Beacon Signals algorithm processes each Beacon Signal by attempting to retrieve and validate an
announce DID Update Payload for that signal according to the type of the Beacon.

It takes as inputs
 - `beaconSignals`: An array of Beacon Signals retrieved from the Find Next Signals algorithm. Each signal contains:
   - `beaconId`: The id for the Beacon that the signal was announced by.
   - `beaconType`: The type of the Beacon that announced the signal.
   - `tx`: The Bitcoin transaction that is the Beacon Signal.
 - `signalsMetadata`: Maps Beacon Signal Bitcoin transaction ids to a SignalMetadata object containing:
   - `updatePayload`: A DID Update Payload which should match the update announced by the Beacon Signal.
                      In the case of a SMT proof of non-inclusion, no DID Update Payload may be provided.
   - `proofs`: Sparse Merkle Tree proof used to verify that the `updatePayload` exists as the leaf indexed by the
               did:btcr2 identifier being resolved.

It returns an array of [DID Update Payloads](https://dcdpr.github.io/did-btcr2/#def-did-update-payload).

#### Parameters

##### signal

[`BeaconSignal`](../interfaces/BeaconSignal.md)

The beacon signals to process.

##### signalsMetadata

[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)

The sidecar data for the DID Document.

#### Returns

`Promise`&lt;[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

The updated DID Document object.

***

### sidecar()

> `static` **sidecar**(`params`): `Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

Defined in: [packages/method/src/core/crud/read.ts:219](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L219)

Implements [4.2.2.2.1 Sidecar Initial Document Validation](https://dcdpr.github.io/did-btcr2/#sidecar-initial-document-validation).

The Sidecar Initial Document Validation algorithm validates an initialDocument against its identifier, by first
constructing the intermediateDocumentRepresentation and verifying the hash of this document matches the bytes
encoded within the identifier. It takes in a did:btcr2 identifier, identifierComponents and a
initialDocument. It returns the initialDocument if validated, otherwise it throws an error.

#### Parameters

##### params

[`ResolveSidecar`](../interfaces/ResolveSidecar.md)

Required params for calling the sidecar method

#### Returns

`Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

The resolved DID Document object

#### Throws

InvalidDidDocument if genesisBytes !== initialDocument hashBytes

***

### targetDocument()

> `static` **targetDocument**(`params`): `Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

Defined in: [packages/method/src/core/crud/read.ts:329](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L329)

Implements [4.2.3 Resolve Target Document](https://dcdpr.github.io/did-btcr2/#resolve-target-document).

The Resolve Target Document algorithm resolves a DID document from an initial document by walking the Bitcoin
blockchain to identify Beacon Signals that announce DID Update Payloads applicable to the did:btcr2 identifier being
resolved. It takes as inputs initialDocument, resolutionOptions and network. It returns a valid DID document.

#### Parameters

##### params

See [TargetDocumentParams](../interfaces/TargetDocumentParams.md) for details.

###### initialDocument

[`DidDocument`](DidDocument.md)

The initial DID Document to resolve

###### resolutionsOptions

[`DidResolutionOptions`](../interfaces/DidResolutionOptions.md)

#### Returns

`Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

The resolved DID Document object with a validated single, canonical history

***

### traverseBlockchainHistory()

> `protected` `static` **traverseBlockchainHistory**(`params`): `Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

Defined in: [packages/method/src/core/crud/read.ts:405](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/crud/read.ts#L405)

Implements [4.2.3.2 Traverse Blockchain History](https://dcdpr.github.io/did-btcr2/#traverse-blockchain-history).

The Traverse Blockchain History algorithm traverses Bitcoin blocks, starting from the block with the
contemporaryBlockheight, to find beaconSignals emitted by Beacons within the contemporaryDidDocument. Each
beaconSignal is processed to retrieve a didUpdatePayload to the DID document. Each update is applied to the
document and duplicates are ignored. If the algorithm reaches the block with the blockheight specified by a
targetBlockheight, the contemporaryDidDocument at that blockheight is returned assuming a single canonical history
of the DID document has been constructed up to that point. It takes in contemporaryDidDocument,
contemporaryBlockHeight, currentVersionId, targetVersionId, targetBlockheight, updateHashHistory, signalsMetadata
and network. It returns the contemporaryDidDocument once either the targetBlockheight or targetVersionId have been
reached.

#### Parameters

##### params

The parameters for the traverseBlockchainHistory operation.

###### btc1UpdateHashHistory

`string`[]

An array of SHA256 hashes of BTCR2 Updates ordered by version that are
   applied to the DID document in order to construct the contemporaryDIDDocument.

###### contemporaryBlockHeight

`number`

The Bitcoin blockheight signaling the "contemporary time" of the
   contemporary DID Document that is being resolved and updated using the Traverse Blockchain History algorithm.

###### contemporaryDidDocument

[`DidDocument`](DidDocument.md)

The DID document for the did:btcr2 identifier being resolved.
   It should be "current" (contemporary) at the blockheight of the contemporaryBlockheight.
   It should be a DID Core conformant DID document.

###### currentVersionId

`number`

The version of the contemporary DID document starting from 1 and
   incrementing by 1 with each BTCR2 Update applied to the DID document.

###### didDocumentHistory

[`DidDocument`](DidDocument.md)[]

An array of DID documents ordered ascensing by version (1...N).

###### network

[`BitcoinNetworkNames`](../../common/enumerations/BitcoinNetworkNames.md)

The bitcoin network to connect to (mainnet, signet, testnet, regtest).

###### signalsMetadata

[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)

See [SignalsMetadata](../type-aliases/SignalsMetadata.md) for details.

###### targetTime

`number`

The timestamp used to target specific historical states of a DID document.
   Only Beacon Signals included in the Bitcoin blockchain before the targetTime are processed.

###### targetVersionId?

`number`

The version of the DID document where resolution will complete.

#### Returns

`Promise`&lt;[`DidDocument`](DidDocument.md)&gt;

The resolved DID Document object with a validated single, canonical history.
