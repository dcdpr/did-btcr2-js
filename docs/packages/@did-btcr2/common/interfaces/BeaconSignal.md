# Interface: BeaconSignal

Defined in: [packages/common/src/interfaces.ts:272](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L272)

Represents a transaction discovered on the Bitcoin blockchain that
spends from a Beacon address, thus announcing DID updates.

DID BTCR2
[4.2.2.3 Find Next Signals](https://dcdpr.github.io/did-btcr2/#find-next-signals)
and
[4.2.2.4 Process Beacon Signals](https://dcdpr.github.io/did-btcr2/#process-beacon-signals).

## Properties

### beaconId

> **beaconId**: `string`

Defined in: [packages/common/src/interfaces.ts:276](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L276)

The DID Document's `service` ID of the Beacon that produced this signal, e.g. "#cidAggregateBeacon".

***

### beaconType

> **beaconType**: [`BeaconType`](../type-aliases/BeaconType.md)

Defined in: [packages/common/src/interfaces.ts:281](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L281)

The type of Beacon, e.g. "SingletonBeacon".

***

### tx

> **tx**: `any`

Defined in: [packages/common/src/interfaces.ts:287](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L287)

The Bitcoin transaction that is the actual on-chain Beacon Signal.
Typically you'd store a minimal subset or a reference/ID for real usage.
