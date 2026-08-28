# ADR 098: Update source resolution accepts the caller's resolution options

- **Status:** Accepted
- **Date:** 2026-08-31
- **Packages:** `@did-btcr2/api`

## Context

`DidBtcr2Api.updateDid` and `DidBtcr2Api.deactivateDid` resolve the DID's current state themselves when the caller does not supply both `sourceDocument` and `sourceVersionId`, through a shared private helper (ADR 094). That helper called `resolveDid(did)` with no options, so nothing the caller knew about the DID could ride along into the resolution.

This made auto-resolution work exactly once per DID under the default publication policy. `publishToCas` defaults to `'never'` (ADR 073), so the signed update produced by a DID's first write exists nowhere but in the caller's own hands, as the sidecar data in the returned `DidUpdateResult`. The second write's auto-resolution then dead-ends: the resolver's request for the signed update falls back to a CAS that never received the bytes, and for SMT-announced updates there is no fallback at all, the driver throws when a proof is requested and no sidecar holds it. The resolver itself has carried full sidecar support all along (`ResolutionOptions.sidecar`: signed updates, CAS announcements, SMT proofs); the write path simply never offered a way to pass it.

The only way around the dead-end was to hand-feed `sourceDocument` and `sourceVersionId`, which skips resolution entirely, and with it every check resolution performs on the state an update builds on.

## Decision

**Both write methods accept an optional `resolutionOptions?: ResolutionOptions`, threaded through the shared source-resolution helper into `resolveDid`.** The options are consulted only when auto-resolution actually runs, that is, when `sourceDocument` or `sourceVersionId` is missing; when both are supplied, resolution is skipped and the options are ignored, and the method documentation says so. A caller updating a sidecar-distributed DID passes the artifacts returned by the previous write as `resolutionOptions.sidecar` and auto-resolution reaches the current state exactly as a reader would.

**The full `ResolutionOptions` type, not a sidecar-only subset.** A narrower parameter carrying just the sidecar was rejected: `ResolutionOptions` is the established input type of every resolution surface in the package, it is already re-exported from the api root, and its other useful field (`maxDiscoveryRounds`, an opt-in resource bound) is just as legitimate on a write's internal resolution as on a read.

**The version-targeting fields are documented away, not stripped.** `ResolutionOptions` also carries `versionId`/`versionTime`, and targeting a historical version from a write is always wrong: the resolution returns stale state, and the resulting update would spend the beacon UTXO announcing a change no resolver will ever apply. Silently deleting fields from a caller's object was rejected as worse than the footgun; the method documentation instructs callers to leave them unset.

## Scope boundary

**The cli does not consume these methods.** Its `update` and `deactivate` commands call the lower-level `api.btcr2.update` directly with mandatory source-document and source-version flags, so this change has no cli reach. Migrating the cli onto the facade write methods, with an optional source document and a resolution-options input reusing the resolve command's existing sidecar parsing, is a separate task.

**Documentation refresh rides the branch-wide doc sync.** The package readme's update examples and the demo's note on the one-auto-resolve limitation predate this change; both are refreshed in this branch's documentation pass, not here.

## Consequences

**Positive.** A DID whose update artifacts live only in sidecar is writable past version 1 through the facade without abandoning resolution: create, update, update again, deactivate, all under the default no-CAS policy, with each write building on a resolved and verified current state. SMT-announced updates, which have no CAS fallback, gain their only possible auto-resolution path.

**Negative.** The footgun stays reachable: a caller who passes `versionId`/`versionTime` gets an update built on a historical version, signed and broadcast, that no resolver will apply. Sidecar data also does not remove the network dependency; beacon-signal discovery still requires a configured Bitcoin connection, so "sidecar-only" means sidecar-distributed artifacts, not offline resolution.

**Neutral.** When both source fields are supplied the new parameter is silently unused, the same precedence the two fields already had over resolution itself. No new exports: the parameter's type has been part of the api root since the write path became importable from the package alone (ADR 096).

## Implementation

- `packages/api/src/api.ts`: `resolutionOptions?: ResolutionOptions` on the `updateDid` and `deactivateDid` parameter objects; `#resolveUpdateSource` takes it as a fourth optional parameter and passes it to `resolveDid`.
- Tests: an update whose stubbed resolution succeeds only when the sidecar arrives, pinning that the options object reaches resolution by reference and that the resolved document and version feed the update; the same passthrough for deactivation; and a pin that supplying both source fields skips resolution entirely, options ignored.

## References

- ADR 094 (deactivation as an ordinary update): introduced the shared source-resolution helper this change threads through.
- ADR 073 (CAS publication opt-in): the `'never'` default that makes the caller's sidecar the only home of a DID's update artifacts.
- ADR 093 (network inheritance), ADR 095 (offline initial document and beacon addresses), ADR 096 (facade signer factory and write-path re-exports), ADR 097 (resolution failures carry their root cause): the same api CRUD review produced all six findings.
- `docs/api-crud-review.md`: the review that surfaced this, as gap G6.
