# Abstract Class: Beacon

Defined in: [packages/method/src/interfaces/beacon.ts:35](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L35)

Implements [5. Beacons](https://dcdpr.github.io/did-btcr2/#update-beacons).
Beacons are the mechanism by which a DID controller announces an update to their DID document by broadcasting an
attestation to this update onto the public Bitcoin network. Beacons are identified by a Bitcoin address and emit
Beacon Signals by broadcasting a valid Bitcoin transaction that spends from this Beacon address. These transactions
include attestations to a set of didUpdatePayloads, either in the form of Content Identifiers (CIDs) or Sparse Merkle
Tree (SMT) roots. Beacons are included as a service in DID documents, with the Service Endpoint identifying a Bitcoin
address to watch for Beacon Signals. All Beacon Signals broadcast from this Beacon MUST be processed as part of
resolution (see Read). The type of the Beacon service in the DID document defines how Beacon Signals SHOULD be
processed.
did:btcr2 supports different Beacon Types, with each type defining a set of algorithms for:
 1. How a Beacon can be established and added as a service to a DID document.
 2. How attestations to DID updates are broadcast within Beacon Signals.
 3. How a resolver processes a Beacon Signal, identifying, verifying, and applying the authorized mutations to a
    DID document for a specific DID.
This is an extendable mechanism, such that in the future new Beacon Types could be added. It would be up to the
resolver to determine if the Beacon Type is a mechanism they support and are willing to trust. If they are unable to
support a Beacon Type and a DID they are resolving uses that type then the DID MUST be treated as invalid.
The current, active Beacons of a DID document are specified in the document’s service property. By updating the DID
document, a DID controller can change the set of Beacons they can use to broadcast updates to their DID document over
time. Resolution of a DID MUST process signals from all Beacons identified in the latest DID document and apply them
in order determined by the version specified by the didUpdatePayload.
All resolvers of did:btcr2 DIDs MUST support the core Beacon Types defined in this specification.

 Beacon

## Extended by

- [`CIDAggregateBeacon`](CIDAggregateBeacon.md)
- [`SingletonBeacon`](SingletonBeacon.md)
- [`SMTAggregateBeacon`](SMTAggregateBeacon.md)

## Implements

- [`IBeacon`](../interfaces/IBeacon.md)

## Constructors

### Constructor

> **new Beacon**(`__namedParameters`, `sidecar?`): `Beacon`

Defined in: [packages/method/src/interfaces/beacon.ts:41](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L41)

#### Parameters

##### \_\_namedParameters

[`BeaconService`](../interfaces/BeaconService.md)

##### sidecar?

[`SidecarData`](../type-aliases/SidecarData.md)

#### Returns

`Beacon`

## Properties

### id

> **id**: `string`

Defined in: [packages/method/src/interfaces/beacon.ts:36](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L36)

A unique identifier for the Beacon

#### Implementation of

[`IBeacon`](../interfaces/IBeacon.md).[`id`](../interfaces/IBeacon.md#id)

***

### serviceEndpoint

> **serviceEndpoint**: `DidServiceEndpoint`

Defined in: [packages/method/src/interfaces/beacon.ts:38](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L38)

The service endpoint of the Beacon

#### Implementation of

[`IBeacon`](../interfaces/IBeacon.md).[`serviceEndpoint`](../interfaces/IBeacon.md#serviceendpoint)

***

### sidecar?

> `optional` **sidecar**: [`SidecarData`](../type-aliases/SidecarData.md)

Defined in: [packages/method/src/interfaces/beacon.ts:39](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L39)

***

### type

> **type**: `string`

Defined in: [packages/method/src/interfaces/beacon.ts:37](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L37)

The type of the Beacon

#### Implementation of

[`IBeacon`](../interfaces/IBeacon.md).[`type`](../interfaces/IBeacon.md#type)

## Accessors

### service

#### Get Signature

> **get** `abstract` **service**(): [`BeaconService`](../interfaces/BeaconService.md)

Defined in: [packages/method/src/interfaces/beacon.ts:51](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L51)

Returns the Beacon Service object.

##### Returns

[`BeaconService`](../interfaces/BeaconService.md)

Returns the Beacon Service object

#### Implementation of

[`IBeacon`](../interfaces/IBeacon.md).[`service`](../interfaces/IBeacon.md#service)

## Methods

### broadcastSignal()

> `abstract` **broadcastSignal**(`didUpdatePayload`): `Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

Defined in: [packages/method/src/interfaces/beacon.ts:66](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L66)

Broadcasts a Beacon Signal (implemented by subclasses).

#### Parameters

##### didUpdatePayload

[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)

#### Returns

`Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

#### Implementation of

[`IBeacon`](../interfaces/IBeacon.md).[`broadcastSignal`](../interfaces/IBeacon.md#broadcastsignal)

***

### generateSignal()

> `abstract` **generateSignal**(`didUpdatePayload`): [`BeaconSignal`](../interfaces/BeaconSignal.md)

Defined in: [packages/method/src/interfaces/beacon.ts:56](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L56)

Generates a Beacon Signal (implemented by subclasses).

#### Parameters

##### didUpdatePayload

`string`

#### Returns

[`BeaconSignal`](../interfaces/BeaconSignal.md)

#### Implementation of

[`IBeacon`](../interfaces/IBeacon.md).[`generateSignal`](../interfaces/IBeacon.md#generatesignal)

***

### processSignal()

> `abstract` **processSignal**(`signal`, `signalsMetadata`): `Promise`&lt;`undefined` \| [`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

Defined in: [packages/method/src/interfaces/beacon.ts:61](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/beacon.ts#L61)

Processes a Beacon Signal (implemented by subclasses).

#### Parameters

##### signal

[`RawTransactionV2`](../../bitcoin/index.browser/interfaces/RawTransactionV2.md) | [`RawTransactionRest`](../../bitcoin/index.browser/interfaces/RawTransactionRest.md)

##### signalsMetadata

[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)

#### Returns

`Promise`&lt;`undefined` \| [`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

#### Implementation of

[`IBeacon`](../interfaces/IBeacon.md).[`processSignal`](../interfaces/IBeacon.md#processsignal)
