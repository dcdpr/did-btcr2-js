# Type Alias: BeaconSidecarData&lt;T&gt;

> **BeaconSidecarData**&lt;`T`&gt; = `T` *extends* `"SingletonBeacon"` ? [`SingletonSidecar`](../interfaces/SingletonSidecar.md) : `T` *extends* `"CIDAggregateBeacon"` ? [`CIDAggregateSidecar`](../interfaces/CIDAggregateSidecar.md) : `T` *extends* `"SMTAggregateBeacon"` ? [`SMTAggregateSidecar`](../interfaces/SMTAggregateSidecar.md) : `T`

Defined in: [packages/method/src/types/crud.ts:32](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/method/src/types/crud.ts#L32)

## Type Parameters

### T

`T`
