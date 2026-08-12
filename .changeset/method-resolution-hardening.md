---
'@did-btcr2/method': minor
---

Fail-closed resolution intake, exact-fee broadcast control, and stricter update validation.

BREAKING:

- The resolver returns plain-JSON documents (class prototypes stripped), so `instanceof DidDocument`/`Btcr2DidDocument` checks on resolved documents no longer hold; document handling is symmetric with any plain-JSON resolver implementation.
- `BeaconUtils.getBeaconServicesMap` keys entries by the parsed Bitcoin address and stores the original service objects (previously re-parsed copies keyed by the raw endpoint string), so identity-based collections keyed by the service object keep working.
- Beacon broadcast is split in two: `prepareBroadcast` builds the unsigned signal transaction and reports its exact fee and vsize, and the returned `PreparedBroadcast.broadcast()` signs and broadcasts it. `broadcastSignal` remains as the composed convenience call.
- Identifiers carrying a custom-network nibble (network values 12-14) are rejected at decode time instead of decoding to an unusable numeric network.
- Resolution terminates when the requested `versionId` is reached; versions after the target are no longer discovered or applied, and the target version's metadata is preserved.
- Update proof expiry during resolution is evaluated against the anchoring block time, not the wall clock, so a proof that expired only after its anchor still verifies on replay.

Added:

- `ResolutionOptions.minConf` (default 6, per the spec): beacon signals with fewer confirmations, or with missing, fractional, or otherwise invalid block metadata, are ignored. Confirmation and metadata checks now fail closed at intake.
- Update validation enforces `capabilityInvocation` authorization (a key listed only under `verificationMethod` cannot authorize an update), DID id binding, `versionId` ordering, beacon rotation rules, and duplicate-metadata rejection.

Fixed:

- Beacon signal discovery validates the OP_RETURN payload by script hex (accepting both the Esplora and Bitcoin Core ASM dialects) and, on the full-node path, requires the signal transaction to spend from the beacon address, rejecting indexer phantom signals.
- Malformed resolver inputs (bad base64url hashes, malformed `capabilityId` percent-escapes, invalid signal metadata) surface as typed errors instead of raw decode throws; a `capabilityId` component-count check that could never fire now works.
