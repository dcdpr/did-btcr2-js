---
'@did-btcr2/method': minor
'@did-btcr2/api': minor
---

The resolver reads SMT proof ids and CAS Announcement values as decoded bytes (ADR 146).

- method: `Resolver.sidecarData` ignores a sidecar SMT proof whose `id` does not decode to 32 bytes, for example an `id` with non-zero pad bits. Before, an item that is not an object or a proof with no string `id` stopped each resolution with a plain `Error` or `TypeError`. A proof whose `id` the strict decoder refuses (for example non-zero pad bits or `=` padding) also stopped it with a plain `Error`. This was also true if no beacon signal needed the proof. For a beacon signal that needs an ignored proof, the resolver emits `NeedSMTProof`.
- method: Breaking: `provide(NeedSMTProof)` raises `MISSING_UPDATE_DATA` for a proof whose `id` has non-zero pad bits. `SMTBeacon.processSignals` emits `NeedSMTProof` for such a proof in a caller-built map. Before, both raised `INVALID_SIGNAL_DATA`.
- method: Breaking: `CASBeacon.processSignals` raises a `CASBeaconError` of type `MISSING_UPDATE_DATA` if the CAS Announcement has an entry for the DID whose value is not a base64url SHA-256 hash. Before, an entry with an empty string, `null`, `0`, `NaN`, or `false` counted as no entry, and the resolution succeeded. In a `SidecarData` that the caller builds, an own entry whose value is `undefined` also counted as no entry. A value that did not decode threw a plain `Error`. A value that decoded to another length emitted `NeedSignedUpdate` with a hash of that length.
- method: the CAS Announcement rule applies to `sidecar.casUpdates` and to a string value from `provide(NeedCASAnnouncement)`. From `provide(NeedCASAnnouncement)`, a value that is not a string still fails with `INVALID_DID_UPDATE`.
- api: dependency uptake. The browser bundle holds the fix. Breaking: `resolveDid` and `tryResolveDid` fail with `MISSING_UPDATE_DATA` if the CAS Announcement value for the DID is not a base64url SHA-256 hash. Before, they accepted the values `''`, `null`, `0`, `NaN`, and `false` in `sidecar.casUpdates`. From the CAS, an announcement with a value that is not a string still fails with `INVALID_DID_UPDATE`.
- api: an unused item of `sidecar.smtProofs` that is not an object, or an unused proof whose `id` the strict decoder refuses, no longer fails the resolution. Before, `tryResolveDid` gave `INTERNAL_ERROR` for it. If a beacon signal needs the proof, the resolution now fails with `MISSING_UPDATE_DATA`. The `MISSING_UPDATE_DATA` error for a needed SMT proof says that the resolver ignores a proof whose `id` does not decode to 32 bytes.
- cli: dependency uptake.
