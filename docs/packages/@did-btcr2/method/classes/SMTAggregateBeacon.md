# Class: SMTAggregateBeacon

Defined in: [packages/method/src/core/beacon/smt-aggregate.ts:25](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/smt-aggregate.ts#L25)

TODO: Finish implementation

Implements [5.3 SMTAggregate Beacon](https://dcdpr.github.io/did-btcr2/#smtaggregate-beacon).

A SMTAggregate Beacon is a Beacon whose Beacon Signals are Bitcoin transactions containing the root of a Sparse
Merkle Tree (SMT). The SMT root attests to a set of DID Update Payloads, however, the updates themselves MUST be
provided along with a proof of inclusion against the SMT root through a Sidecar mechanism during resolution. Using
the SMT root a resolver can then verify the inclusion proof for the given DID Update Payload. If a DID document
includes a SMTAggregator Beacon in their set of Beacon services, then they MUST provide proofs for each signal that
the Beacon broadcasts. If they did not submit an update to their DID in a signal, then they MUST provide a proof of
non-inclusion for that signal.

 SMTAggregateBeacon

## Extends

- [`Beacon`](Beacon.md)

## Constructors

### Constructor

> **new SMTAggregateBeacon**(`service`, `sidecar?`): `SMTAggregateBeacon`

Defined in: [packages/method/src/core/beacon/smt-aggregate.ts:31](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/smt-aggregate.ts#L31)

Creates an instance of SMTAggregateBeacon.

#### Parameters

##### service

[`BeaconService`](../interfaces/BeaconService.md)

The Beacon service.

##### sidecar?

[`SMTAggregateSidecar`](../interfaces/SMTAggregateSidecar.md)

Optional sidecar data.

#### Returns

`SMTAggregateBeacon`

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

Defined in: [packages/method/src/core/beacon/smt-aggregate.ts:40](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/smt-aggregate.ts#L40)

Get the Beacon service.

##### Returns

[`BeaconService`](../interfaces/BeaconService.md)

Returns the Beacon Service object

#### Overrides

[`Beacon`](Beacon.md).[`service`](Beacon.md#service)

## Methods

### broadcastSignal()

> **broadcastSignal**(`didUpdatePayload`): `Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

Defined in: [packages/method/src/core/beacon/smt-aggregate.ts:102](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/smt-aggregate.ts#L102)

Implements [5.3.2 Broadcast SMTAggregate Beacon Signal](https://dcdpr.github.io/did-btcr2/#broadcast-smtaggregate-beacon-signal).

See [Beacon Interface Method broadcastSignal](Beacon.md#broadcastsignal) for more information.

To publish a DID Update Payload, the DID controller MUST get a hash of the DID Update Payload included at the leaf
of the Sparse Merkle Tree (SMT) identified by their did:btcr2 identifier and receive an inclusion proof for this
data. If a member of the Beacon cohort does not wish to announce an update in a Beacon Signal, they MUST receive
and verify a proof of non-inclusion for their DID. Upon verifying the non-inclusion proof against the SMT root
contained in the Beacon Signal, they SHOULD accept and authorize the signal following the MuSig2 protocol. Once all
members of the cohort have authorized the signal, it can be broadcast as a transaction to the Bitcoin network. DID
controllers are responsible for persisting their DID updates and proofs, these will need to be provided through a
Sidecar mechanism during a resolution process.

#### Parameters

##### didUpdatePayload

[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)

The DID Update Payload to broadcast.

#### Returns

`Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

The signal metadata.

#### Throws

if the signal is invalid.

#### Overrides

[`Beacon`](Beacon.md).[`broadcastSignal`](Beacon.md#broadcastsignal)

***

### generateSignal()

> **generateSignal**(`didUpdatePayload`): [`BeaconSignal`](../interfaces/BeaconSignal.md)

Defined in: [packages/method/src/core/beacon/smt-aggregate.ts:55](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/smt-aggregate.ts#L55)

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

> **processSignal**(`signal`, `signalsMetadata`): `Promise`&lt;`undefined` \| [`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

Defined in: [packages/method/src/core/beacon/smt-aggregate.ts:133](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/smt-aggregate.ts#L133)

Implements [5.3.3 Process SMTAggregate Beacon Signal](https://dcdpr.github.io/did-btcr2/#process-smtaggregate-beacon-signal).

See [Beacon Interface Method processSignal](Beacon.md#processsignal) for more information.

A Beacon Signal from a SMTAggregate Beacon is a Bitcoin transaction with the first transaction output of the format
[OP_RETURN, OP_PUSH32, \<32bytes\>]. The 32 bytes of data contained within this transaction output represent the root
of a Sparse Merkle Tree (SMT). This SMT aggregates a set of hashes of DID Update payloads. In order to process
these Beacon Signals, the resolver MUST have been passed Sidecar data for this signal containing either the DID
Update payload object and a SMT proof that the hash of this object is in the SMT at the leaf indexed by the
did:Identifier being resolved. Or theSidecar data:: MUST contain a proof that the leaf indexed by the
did:Identifier is empty, thereby proving that theSMT:: does not contain an update for their identifier.

The Process SMTAggregate Beacon Signal is called by the Process Beacon Signals algorithm as part of the Read
operation. It takes as inputs a did:btcr2 identifier, Identifier, a Beacon Signal, tx, and a optional object,
signalSidecarData, containing any sidecar data provided to the resolver for the Beacon Signal identified by the
Bitcoin transaction identifier.

It returns the DID Update payload announced by the Beacon Signal for the did:btcr2 identifier being resolved or
throws an error.

#### Parameters

##### signal

[`RawTransactionV2`](../../bitcoin/index.browser/interfaces/RawTransactionV2.md)

The raw transaction signal.

##### signalsMetadata

[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)

The signals metadata.

#### Returns

`Promise`&lt;`undefined` \| [`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

The updated DID document.

#### Throws

if the signal is invalid.

#### Overrides

[`Beacon`](Beacon.md).[`processSignal`](Beacon.md#processsignal)

***

### establish()

> `static` **establish**(`id`, `type`, `serviceEndpoint`): `SMTAggregateBeacon`

Defined in: [packages/method/src/core/beacon/smt-aggregate.ts:79](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/smt-aggregate.ts#L79)

Implements [5.3.1 Establish Beacon](https://dcdpr.github.io/did-btcr2/#establish-beacon).

The Establish Beacon algorithm is essentially the same as for the CIDAggregate Beacon in Establish CIDAggregate
Beacon. A cohort of DID controllers need to coordinate to produce a Bitcoin address that will act as the Beacon.
It is RECOMMENDED this is an n-of-n P2TR address, with n being the set of DID controllers in the cohort. Once the
address has been created, and all parties in the cohort acknowledge their intention to participate in that Beacon,
each DID controller SHOULD add the Beacon as a service to their DID document.

Additionally, the SMTAggregate Beacon cohort participants MUST register the did:btcr2 identifiers they intend use
this Beacon with. This is so the Beacon coordinator can generate the necessary proofs of both inclusion and
non-inclusion for each DID.

Static, convenience method for establishing a Beacon object.

#### Parameters

##### id

`string`

The Beacon ID.

##### type

`string`

The Beacon type.

##### serviceEndpoint

`DidServiceEndpoint`

The service endpoint.

#### Returns

`SMTAggregateBeacon`

The Beacon.
