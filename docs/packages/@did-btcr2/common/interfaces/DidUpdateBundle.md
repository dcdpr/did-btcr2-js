# Interface: DidUpdateBundle

Defined in: [packages/common/src/interfaces.ts:191](https://github.com/dcdpr/did-btcr2-js/blob/c82bc5c69016e1146a0c52c6e6b21621f5abd6d4/packages/common/src/interfaces.ts#L191)

A JSON object that maps did:btcr2 identifiers to the CID of the corresponding
DID Update Payload.

DID BTCR2
[5.2 CIDAggregate Beacons](https://dcdpr.github.io/did-btcr2/#cidaggregate-beacon).

## Indexable

\[`didbtcr2Identifier`: `string`\]: `string`

The keys are did:btcr2 identifiers as strings. The values are
IPFS CIDs (or other CAS IDs) referencing the actual DID Update Payload.
