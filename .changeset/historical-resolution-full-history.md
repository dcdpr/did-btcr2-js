---
'@did-btcr2/method': minor
'@did-btcr2/api': minor
---

A historical resolution processes the full history and returns the requested state (ADR 145).

- method: the resolver keeps the state at the version that `versionId` or `versionTime` requests (`requested_state` of the specification). Then it processes the rest of the history and returns the kept state. Before, the resolver stopped at the requested version. Breaking: an error in a later update fails a historical request, for example `LATE_PUBLISHING` or `INVALID_DID_UPDATE`. The resolver also scans each beacon that a later update adds and emits the data needs of its signals. `maxDiscoveryRounds` counts the rounds of the full history.
- api: dependency uptake. The browser bundle holds the fix. Breaking: `resolveDid` and `tryResolveDid` refuse the same historical requests. If an update after the requested version adds an SMT beacon, each beacon signal at that beacon now needs its proof in `sidecar.smtProofs`. A signal that announces no update for the DID also needs its proof.
- cli: dependency uptake.
