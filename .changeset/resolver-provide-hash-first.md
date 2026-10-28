---
'@did-btcr2/method': minor
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
---

The resolver checks the hash of provided data first, and a `targetVersionId` that is not an integer fails when the resolver builds the tuple (ADR 160).

- method: Breaking: `Resolver.provide` checks the hash of a signed update or a CAS Announcement first, then that the value is a JSON object. It checks no field. A wrong hash gives `INVALID_SIGNAL_DATA` (update) or `MISSING_UPDATE_DATA` (announcement) for each shape. A value with the right hash that is not a JSON object gives `MISSING_UPDATE_DATA`.
- method: Breaking: `Resolver.sidecarData` leaves out an update or a CAS Announcement that is not a JSON object.
- method: Breaking: an update with a `targetVersionId` that is not an integer fails with `INVALID_DID_UPDATE` (`Invalid update: targetVersionId is not an integer`) on each channel, also after a deactivation. The `confirmDuplicate` message is now `Invalid duplicate: targetVersionId is less than 2`.
- method: Breaking: the resolver reads only the entry of the DID in a CAS Announcement on each channel. An entry of another DID has no effect.
- method: Breaking: each `genesisDocument` value other than `undefined` is a provided value, also `null`. `provide(NeedGenesisDocument)` does not throw. `Resolver.external` refuses a genesis document that is not a JSON object with `INVALID_DID_DOCUMENT`.
- api: Breaking: `resolveDid` and `tryResolveDid` give the results of the method changes. A CAS Announcement from the CAS with an entry of another DID that is not a string resolves. The browser bundle holds the method package.
- cli: the `resolve` docs; dependency uptake.
