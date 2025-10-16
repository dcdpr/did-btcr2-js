# Class: BeaconFactory

Defined in: [packages/method/src/core/beacon/factory.ts:14](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/factory.ts#L14)

Beacon Factory pattern to create Beacon instances.
 BeaconFactory

## Constructors

### Constructor

> **new BeaconFactory**(): `BeaconFactory`

#### Returns

`BeaconFactory`

## Methods

### establish()

> `static` **establish**(`service`, `sidecar?`): [`Beacon`](Beacon.md)

Defined in: [packages/method/src/core/beacon/factory.ts:21](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/core/beacon/factory.ts#L21)

Establish a Beacon instance based on the provided service and optional sidecar data.

#### Parameters

##### service

[`BeaconService`](../interfaces/BeaconService.md)

The beacon service configuration.

##### sidecar?

[`SidecarData`](../type-aliases/SidecarData.md)

The optional sidecar data.

#### Returns

[`Beacon`](Beacon.md)

The established Beacon instance.
