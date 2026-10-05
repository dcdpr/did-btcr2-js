# ADR 135: An Update Is Refused If the Source Resolution Misses an Update of the Sidecar Data

- **Status:** Accepted
- **Date:** 2026-10-05
- **Packages:** `@did-btcr2/api` (MINOR: a new refusal); `@did-btcr2/cli` (PATCH: documentation and the api dependency)

## Context

`updateDid` and `deactivateDid` take a DID or a resolved state as the source (ADR 123). For a DID, the api resolves the DID first. It takes the source document and its `versionId` from that resolution. The new update gets the `targetVersionId` `versionId + 1`.

The resolution applies a beacon signal only after `minConf` confirmations, default 6 (ADR 105). A controller can make a second update before the signal of the first update has 6 confirmations. The resolution then returns the version before the first update. The api makes a second update with the same `targetVersionId` as the first update.

Both signals go into blocks. The resolver applies the first update. It then compares the second update with the applied update of the same version. The hashes are different, so the resolution stops with `LATE_PUBLISHING`. No later update can repair the DID.

### Specification position

Spec PR 377 added a rule to the update operation. A DID controller MUST NOT announce a BTCR2 Signed Update if it cannot resolve all previous updates of the DID. It cannot resolve them if a fresh resolution returns a `versionId` less than the highest `targetVersionId` that the controller announced. The remedy is a new resolution after the beacon signal of the last update has `minConf` confirmations. A lower `minConf` decreases the time to wait, but increases the risk from block reorganizations.

The specification does not say where the controller keeps the updates that it announced.

## Decision

### The api compares the resolved version with the sidecar updates

For a DID source, the api reads `resolutionOptions.sidecar.updates` after the resolution. It keeps the updates whose `proof.invocationTarget` is the DID. It takes the highest `targetVersionId` of these updates. If the resolved `versionId` is less, the api refuses the update before it signs.

The check is in the source helper that `updateDid` and `deactivateDid` share. Both operations apply it.

### The sidecar data is the only data source

The api keeps no other list of the updates that a controller announced. The sidecar updates are the updates that the caller gives to the resolution. If an update is not in a CAS, the caller must give it to each later resolution. Thus the sidecar data holds it.

The cli records each update that it makes in the identifier record (ADR 133). The sidecar data of the record joins the resolution options of the next `update` or `deactivate`. Thus the cli gets the check for each update that it made, with no new cli code.

### Without sidecar updates, the api does no check

If the resolution options hold no sidecar update of the DID, the api cannot see the announced updates. It does no check. The api documentation states this limit.

### The error gives the remedy and the escape

The error is an `UpdateError` with the type `INVALID_DID_UPDATE`. The data is `{ did, versionId, announcedVersionId, minConf }`. `minConf` is the value of the resolution options, else `DEFAULT_MIN_CONF`. The message gives the remedy of the specification: resolve again after the beacon signal of the last update has `minConf` confirmations, or set a lower `minConf`.

A state source `{ document, versionId }` skips the check. This is the escape for a caller whose sidecar data holds an update that no beacon signal announced. Example: the signal transaction of the last update left the mempool, and the caller makes a new update for the same version.

The cli shows the api message with no change. The cli documentation gives the cli form of the remedy (`--min-conf`) and of the escape (`--source-document` with `--source-version-id`).

### The check meets the api guard criterion

The api refuses a write only if two conditions are true:

1. The failure is permanent for the DID.
2. The api already holds the data to find the failure.

A second update with the same `targetVersionId` is permanent (`LATE_PUBLISHING`). The api itself makes the `targetVersionId`, from a view that hides the last signal of the controller. The sidecar data is already an input of the resolution. ADR 102 (funding guard) and ADR 134 (fee guard) apply the same criterion.

## Alternatives

- **Read the mempool for the unconfirmed signals of the beacon addresses.** Spec PR 377 uses the announced `targetVersionId` instead. A mempool read adds chain requests, and it does not find a signal that left the mempool. Rejected.
- **Wait in the api until the last signal has `minConf` confirmations.** The api has no wait loops. The caller controls the time. Rejected.
- **Find the DID of an update also by `proof.capability`.** Since method 0.69.0, an update with no `invocationTarget` fails the resolution before the check. A second field adds nothing. Rejected.
- **Catch the error in the cli and write a new message with the cli flags.** That is about 20 lines and one test for one error. The cli shows the other api errors with no change. Rejected. The cli documentation gives the flags.

## Consequences

**Positive.**

- A second update before the first signal has `minConf` confirmations fails before the api signs, with the remedy in the message. Before, the second update made the DID unresolvable.
- The cli gets the check for each update that it made.
- `deactivateDid` applies the same check.
- The check reads no chain data.

**Negative.**

- A caller with no sidecar updates gets no check. Example: a controller that publishes each update to a CAS and gives no sidecar data.
- A sidecar update that no beacon signal announced blocks each update to its version. The caller must remove it from the sidecar data, or give a state source.
- The api refuses an update that it accepted before. This is a MINOR change at 0.x.

**Neutral.**

- A resolved `versionId` higher than the highest sidecar `targetVersionId` passes. A CAS can hold updates that the sidecar data does not hold.
- A sidecar update with a `targetVersionId` that is not an integer does not count.

## Implementation

- `packages/api/src/api.ts`: the check at the end of `#resolveUpdateSource`, after the `versionId` checks; the JSDoc of `updateDid` and of the helper.
- `packages/api/tests/did-btcr2-api.spec.ts`: 7 tests. A lower version is refused, also by `deactivateDid`, with the data and the default `minConf`. The `minConf` of the resolution options is in the data. An equal version passes. A sidecar update of another DID, no sidecar updates, and a state source pass.
- `packages/api/README.md`, `packages/cli/docs/update.md`, `packages/cli/docs/deactivate.md`: the check, the limit, the remedy, and the escape.

## References

- [ADR 098](098-update-source-resolution-accepts-resolution-options.md): the source resolution takes the resolution options.
- [ADR 102](102-funding-guard-applies-the-beacon-spendability-rule.md): the funding guard.
- [ADR 105](105-resolution-processes-only-signals-at-min-conf.md): `minConf`.
- [ADR 123](123-update-and-deactivate-follow-the-specification-signatures.md): the source of `updateDid` and `deactivateDid`.
- [ADR 133](133-the-cli-keeps-an-identifier-record-for-each-identifier.md): the identifier records of the cli.
- [ADR 134](134-a-beacon-signal-spends-all-eligible-utxos-and-its-change-stays-spendable.md): the fee guard.
- [Update](https://dcdpr.github.io/did-btcr2/operations/update.html): the rule of spec PR 377.
