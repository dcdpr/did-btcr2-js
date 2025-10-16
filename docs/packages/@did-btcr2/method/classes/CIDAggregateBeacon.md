# Class: CIDAggregateBeacon

Defined in: [packages/method/src/core/beacon/cid-aggregate.ts:24](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/cid-aggregate.ts#L24)

Implements [5.2 CIDAggregate Beacon](https://dcdpr.github.io/did-btcr2/#cidaggregate-beacon).

A Beacon of the type CIDAggregatoBeacon is a Beacon that publishes Bitcoin transactions containing a Content
Identifier (CID) announcing an Aggregated DID Update Bundle. An Aggregated DID Update Bundle is a JSON object that
maps did:btcr2 identifiers to CID values for the individual DID Update Payloads. The Aggregated DID Update Bundle CID
(bundleCID) SHOULD be resolvable against a Content Addressable Storage (CAS) system such as IPFS, while the CID for
the DID Update Payload (payloadCID) MAY be resolvable against a CAS or provided through a Sidecar mechanism. It is
RECOMMENDED that this type of Beacon is only included in a DID document if the DID controller is REQUIRED to
participate in authorizing Bitcoin transactions from this Beacon. In other words, this Beacon SHOULD identify an
n-of-n P2TR Bitcoin address where n is the number of unique DID controllers submitting updates through the Beacon.

 CIDAggregateBeacon

## Extends

- [`Beacon`](Beacon.md)

## Constructors

### Constructor

> **new CIDAggregateBeacon**(`service`, `sidecar?`): `CIDAggregateBeacon`

Defined in: [packages/method/src/core/beacon/cid-aggregate.ts:30](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/cid-aggregate.ts#L30)

Creates an instance of CIDAggregateBeacon.

#### Parameters

##### service

[`BeaconService`](../interfaces/BeaconService.md)

The service of the Beacon.

##### sidecar?

[`CIDAggregateSidecar`](../interfaces/CIDAggregateSidecar.md)

The sidecar data of the Beacon.

#### Returns

`CIDAggregateBeacon`

#### Overrides

[`Beacon`](Beacon.md).[`constructor`](Beacon.md#constructor)

## Properties

### id

> **id**: `string`

Defined in: [packages/method/src/interfaces/beacon.ts:36](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L36)

A unique identifier for the Beacon

#### Inherited from

[`Beacon`](Beacon.md).[`id`](Beacon.md#id)

***

### serviceEndpoint

> **serviceEndpoint**: `DidServiceEndpoint`

Defined in: [packages/method/src/interfaces/beacon.ts:38](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L38)

The service endpoint of the Beacon

#### Inherited from

[`Beacon`](Beacon.md).[`serviceEndpoint`](Beacon.md#serviceendpoint)

***

### sidecar?

> `optional` **sidecar**: [`SidecarData`](../type-aliases/SidecarData.md)

Defined in: [packages/method/src/interfaces/beacon.ts:39](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L39)

#### Inherited from

[`Beacon`](Beacon.md).[`sidecar`](Beacon.md#sidecar)

***

### type

> **type**: `string`

Defined in: [packages/method/src/interfaces/beacon.ts:37](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L37)

The type of the Beacon

#### Inherited from

[`Beacon`](Beacon.md).[`type`](Beacon.md#type)

## Accessors

### service

#### Get Signature

> **get** **service**(): [`BeaconService`](../interfaces/BeaconService.md)

Defined in: [packages/method/src/core/beacon/cid-aggregate.ts:33](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/cid-aggregate.ts#L33)

Returns the Beacon Service object.

##### Returns

[`BeaconService`](../interfaces/BeaconService.md)

Returns the Beacon Service object

#### Overrides

[`Beacon`](Beacon.md).[`service`](Beacon.md#service)

## Methods

### broadcastSignal()

> **broadcastSignal**(`didUpdatePayload`): `Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

Defined in: [packages/method/src/core/beacon/cid-aggregate.ts:124](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/cid-aggregate.ts#L124)

TODO: Finish implementation

Implements [5.2.2 Broadcast CIDAggregate Beacon Signal](https://dcdpr.github.io/did-btcr2/#broadcast-cidaggregate-beacon-signal).

The Broadcast CIDAggregate Beacon Signal algorithm involving two roles: a set of cohort participants and a Beacon
coordinator. The Beacon coordinator collects individual DID Update Payload Content Identifiers (CIDs) for specific
did:btc1s and aggregates them into a DID Update Bundle, which is then published to a Content Addressable Storage
(CAS). The CID for the DID Update Bundle is included in a Partially Signed Bitcoin Transaction (PSBT) transaction
output spent from the Beacon’s n-of-n address. Each of the n cohort participants in the Beacon MUST sign the
transaction before it can be broadcast to the network. It is RECOMMENDED that cohort participants keep a copy of
the DID Update Bundle and separately pin it to the CAS.

#### Parameters

##### didUpdatePayload

[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)

The verificationMethod object to be used for signing.

#### Returns

`Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

Successful output of a bitcoin transaction.

#### Throws

if the bitcoin address is invalid or unfunded.

#### Overrides

[`Beacon`](Beacon.md).[`broadcastSignal`](Beacon.md#broadcastsignal)

***

### generateSignal()

> **generateSignal**(`didUpdatePayload`): [`BeaconSignal`](../interfaces/BeaconSignal.md)

Defined in: [packages/method/src/core/beacon/cid-aggregate.ts:71](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/cid-aggregate.ts#L71)

TODO: Figure out if this is necessary or not.

#### Parameters

##### didUpdatePayload

`string`

The DID Update Payload to generate the signal for.

#### Returns

[`BeaconSignal`](../interfaces/BeaconSignal.md)

The generated signal.

#### Throws

if the signal is invalid.

#### Overrides

[`Beacon`](Beacon.md).[`generateSignal`](Beacon.md#generatesignal)

***

### processSignal()

> **processSignal**(`signal`, `signalsMetadata`): `Promise`&lt;`undefined` \| [`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)&gt;

Defined in: [packages/method/src/core/beacon/cid-aggregate.ts:103](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/cid-aggregate.ts#L103)

TODO: Finish implementation

Implements [5.2.3 Process CIDAggregate Beacon Signal](https://dcdpr.github.io/did-btcr2/#process-cidaggregate-beacon-signal).

A Beacon Signal from a CIDAggregate Beacon is a Bitcoin transaction that contains the hashBytes of a DID Update
Bundle in its first transaction output. The corresponding DID Update Bundle MUST either be provided through Sidecar
Data or by converting hashBytes into a IPFS v1 Content Identifier and attempting to retrieve it from Content
Addressable Storage. The DID Update Bundle maps from did:btcr2 identifiers to hashes of DID Update payloads
applicable for that identifier. Again this algorithm attempts to retrieve and validate the DID Update Payload
identified for the identifier being resolved. If successful, the DID Update Payload is returned.

The Process CIDAggregate Beacon Signal algorithm is called by the Process Beacon Signals algorithm as part of the
Read operation.

It takes as inputs a did:btcr2 identifier, Identifier, a Beacon Signal, tx, and a optional
object, signalSidecarData, containing any sidecar data provided to the resolver for the Beacon Signal identified by
the Bitcoin transaction identifier.

It returns the DID Update payload announced by the Beacon Signal for the
did:btcr2 identifier being resolved or throws an error.

#### Parameters

##### signal

[`RawTransactionV2`](../../bitcoin/index.browser/interfaces/RawTransactionV2.md)

Bitcoin transaction representing a Beacon Signal.

##### signalsMetadata

[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)

Optional sidecar data for the Beacon Signal.

#### Returns

`Promise`&lt;`undefined` \| [`DidUpdateInvocation`](../../common/interfaces/DidUpdateInvocation.md)&gt;

The DID Update payload announced by the Beacon Signal.

#### Throws

if the signalTx is invalid or the signalsMetadata is invalid.

#### Overrides

[`Beacon`](Beacon.md).[`processSignal`](Beacon.md#processsignal)

***

### establish()

> `static` **establish**(`id`, `type`, `serviceEndpoint`): `CIDAggregateBeacon`

Defined in: [packages/method/src/core/beacon/cid-aggregate.ts:60](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/cid-aggregate.ts#L60)

TODO: Finish implementation

Implements [5.2.1 Establish CIDAggregate Beacon](https://dcdpr.github.io/did-btcr2/#establish-cidaggregate-beacon).

To establish a CIDAggregatorBeacon, a cohort of cooperating parties SHOULD generate an n-of-n P2TR Bitcoin address
where each party contributes a public key. Furthermore, each party SHOULD verify that their key is part of the
address and all other keys that are part of the address are keys with controllers able to produce valid signatures.
To establish a Beacon there are two roles. One is the cohort participant, they want to join a Beacon cohort and
submit a request to do so with a key and proof of control over that key. The other is the Beacon coordinator, they
advertise and curate Beacon cohorts by combining Beacon participants into cohorts, verifying proofs of control, and
producing Beacon addresses.

#### Parameters

##### id

`string`

The identifier of the Beacon.

##### type

`string`

The type of the Beacon.

##### serviceEndpoint

`DidServiceEndpoint`

The service endpoint of the Beacon.

#### Returns

`CIDAggregateBeacon`

The established CIDAggregate Beacon.
