---
'@did-btcr2/api': minor
---

Exact-fee broadcast confirmation, typed update failures, and CAS integrity checks.

BREAKING:

- The update flow (which also carries deactivation) accepts a `confirmBroadcast` callback that is invoked with the exact fee and vsize of the built beacon transaction before anything is signed or broadcast; declining leaves the beacon UTXO unspent. Beacon broadcast is split into `prepareBroadcast`/`broadcast` underneath.
- Updating a deactivated DID is rejected with a typed `UpdateError` (`INVALID_DID_UPDATE`) before any signing or broadcasting, instead of burning the beacon UTXO on an update resolvers will reject.
- Resolution failures and missing or non-numeric `versionId` metadata on the update path now throw typed `UpdateError`s instead of generic `Error`s.

Added:

- `expectedDomain` accepts a string or an array of strings on proof verification (AND semantics across multiple domains), matching the cryptosuite.
- CAS responses are size-capped (`CasConfig.maxResponseBytes`, default 1 MiB) and the retrieved bytes are verified against the requested content hash before parsing; an integrity failure throws `CAS_INTEGRITY_ERROR`.
