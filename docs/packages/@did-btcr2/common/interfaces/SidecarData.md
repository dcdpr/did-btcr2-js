# Interface: SidecarData

Defined in: [packages/common/src/interfaces.ts:210](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L210)

A container for out-of-band data the resolver may need. This includes the
initial DID document if it isn't stored in IPFS, plus references for each
on-chain Beacon signal.

DID BTCR2
[4.2.1.2.1 Sidecar Initial Document Validation](https://dcdpr.github.io/did-btcr2/#sidecar-initial-document-validation),
[4.2.2 Resolve Target Document](https://dcdpr.github.io/did-btcr2/#resolve-target-document),
[4.2.2.2 Traverse Blockchain History](https://dcdpr.github.io/did-btcr2/#traverse-blockchain-history),
[4.2.2.3 Find Next Signals](https://dcdpr.github.io/did-btcr2/#find-next-signals).

## Properties

### initialDocument?

> `optional` **initialDocument**: `Record`&lt;`string`, `any`&gt;

Defined in: [packages/common/src/interfaces.ts:215](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L215)

The initial DID Document for an externally created did:btcr2,
if not fetched from IPFS or another CAS.

***

### signalsMetadata

> **signalsMetadata**: `object`

Defined in: [packages/common/src/interfaces.ts:222](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L222)

A map from Bitcoin transaction IDs to the sidecar info about that signal.
Each signal might provide a single DID Update Payload, or (for aggregator beacons)
a bundle or proofs.

#### Index Signature

\[`txid`: `string`\]: [`SignalSidecarData`](SignalSidecarData.md)
