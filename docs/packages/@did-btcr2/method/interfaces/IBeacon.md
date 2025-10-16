# Interface: IBeacon

Defined in: [packages/method/src/interfaces/ibeacon.ts:11](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L11)

Beacon interface
 IBeacon

## Properties

### id

> **id**: `string`

Defined in: [packages/method/src/interfaces/ibeacon.ts:16](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L16)

A unique identifier for the Beacon

***

### service

> **service**: [`BeaconService`](BeaconService.md)

Defined in: [packages/method/src/interfaces/ibeacon.ts:34](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L34)

Returns the Beacon Service object

***

### serviceEndpoint

> **serviceEndpoint**: `DidServiceEndpoint`

Defined in: [packages/method/src/interfaces/ibeacon.ts:28](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L28)

The service endpoint of the Beacon

***

### type

> **type**: `string`

Defined in: [packages/method/src/interfaces/ibeacon.ts:22](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L22)

The type of the Beacon

## Methods

### broadcastSignal()

> **broadcastSignal**(`didUpdatePayload`): `Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

Defined in: [packages/method/src/interfaces/ibeacon.ts:57](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L57)

Broadcasts a signal.

#### Parameters

##### didUpdatePayload

[`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)

The DID update payload.

#### Returns

`Promise`&lt;[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)&gt;

The signal metadata.

***

### generateSignal()

> **generateSignal**(`didUpdatePayload`): [`BeaconSignal`](BeaconSignal.md)

Defined in: [packages/method/src/interfaces/ibeacon.ts:41](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L41)

Generates a Beacon Signal Transaction

#### Parameters

##### didUpdatePayload

`string`

The DID update payload

#### Returns

[`BeaconSignal`](BeaconSignal.md)

The Beacon Signal

***

### processSignal()

> **processSignal**(`signal`, `signalsMetadata`): `Promise`&lt;`undefined` \| [`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

Defined in: [packages/method/src/interfaces/ibeacon.ts:49](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/interfaces/ibeacon.ts#L49)

Processes a Beacon Signal.

#### Parameters

##### signal

[`RawTransactionV2`](../../bitcoin/index.browser/interfaces/RawTransactionV2.md)

The raw transaction

##### signalsMetadata

[`SignalsMetadata`](../type-aliases/SignalsMetadata.md)

The signals metadata from the sidecar data

#### Returns

`Promise`&lt;`undefined` \| [`DidUpdatePayload`](../../common/interfaces/DidUpdatePayload.md)&gt;

The DID update payload
