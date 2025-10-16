# Interface: SignalSidecarData

Defined in: [packages/common/src/interfaces.ts:233](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L233)

Sidecar data for a specific Beacon Signal. Different Beacon types store different fields.
- SingletonBeacon might just store one `updatePayload`.
- CIDAggregateBeacon might store `updateBundle` + an `updatePayload`.
- SMTAggregateBeacon might store `updatePayload` + a `smtProof`.

## Properties

### smtProof?

> `optional` **smtProof**: [`SmtProof`](SmtProof.md)

Defined in: [packages/common/src/interfaces.ts:240](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L240)

For SMTAggregateBeacon, a Merkle proof that the `updatePayload`
is included (or not included) in the aggregator's Sparse Merkle Tree.

***

### updateBundle?

> `optional` **updateBundle**: [`DidUpdateBundle`](DidUpdateBundle.md)

Defined in: [packages/common/src/interfaces.ts:235](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L235)

***

### updatePayload?

> `optional` **updatePayload**: [`DidUpdateInvocation`](DidUpdateInvocation.md)

Defined in: [packages/common/src/interfaces.ts:234](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L234)
