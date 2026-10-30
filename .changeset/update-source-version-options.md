---
'@did-btcr2/api': minor
'@did-btcr2/cli': patch
---

The api refuses `versionId` and `versionTime` in the source resolution of an update (ADR 165).

- api: Breaking: `updateDid` and `deactivateDid` refuse `versionId` and `versionTime` in `options.resolutionOptions` for a DID source, with an `UpdateError` of type `INVALID_OPTIONS`, before any I/O. The api refuses each value that is not `undefined`, also `''` and `null`. The data is `{ versionId, versionTime }`. The message is ``The source resolution of an update cannot use `versionId` or `versionTime`: the source must be the current version of the DID, from a fresh resolution.`` A state source does not change.
- cli: the `update` and `deactivate` docs; dependency uptake.
