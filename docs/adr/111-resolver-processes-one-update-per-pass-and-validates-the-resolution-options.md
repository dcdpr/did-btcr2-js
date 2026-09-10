# ADR 111: The Resolver Processes One Update per Pass, Validates the Resolution Options, and Compares versionTime with the Block mediantime

- **Status:** Accepted
- **Date:** 2026-09-10
- **Packages:** `@did-btcr2/method`; dependency uptake and test fixtures in `@did-btcr2/api`; documentation only in `@did-btcr2/cli`

## Context

Two specification pull requests rewrote the resolve loop after ADR 105 and ADR 110:

- Pull request 359 (merged 2026-09-05) defines the `versionId` and `versionTime` semantics. A request with both options raises `INVALID_OPTIONS`, the DID Resolution v1 code. `versionId` MUST parse as an integer and `versionTime` SHOULD parse as an XML Datetime; a value that does not parse raises `INVALID_OPTIONS`. The `versionId` test runs before Apply, so version 1 is reachable. An unsatisfiable `versionId` raises `NOT_FOUND`. The `versionTime` test compares the block `mediantime` of the tuple, and the boundary is inclusive: the resolver applies an update whose `mediantime` is equal to `versionTime`. The `block_confirmations` step runs after the `versionTime` stop.
- Pull request 363 (merged 2026-09-06) terminates the loop and renames its subsections. The resolver keeps a list of tuples (block height, `mediantime`, confirmations, signed update), a list of scanned beacon addresses, the current document, the current version, the update hash history, and `block_confirmations`. Each pass runs "Find Beacon Signals" for the beacon addresses that are not scanned yet, then "Process Next Update" for ONE tuple. "Process Next Update" resolves the document when the version equals `versionId`, when the tuple list is empty, or when the document is deactivated. It then sorts the tuples, removes the first one, tests `versionTime`, sets `block_confirmations`, and checks `targetVersionId`. Footnote 2 says that `confirmations` refers to the block that contains the most recently applied unique update.

ADR 105 deferred the other changes of pull request 359 until it merged. The implementation differed on every point:

- The constructor accepted `versionId` and `versionTime` together. `Number('1.5')` passed as a `versionId`. An invalid `versionTime` became the Unix epoch, and the genesis document returned with no error.
- A `versionId` past the history returned the latest document. A `versionId` with no signal returned the genesis document with the requested label.
- The `versionId` test ran after the increment with `<=`, so `versionId: "1"` with a version 2 signal returned version 2.
- `versionTime` compared the header `time` of the block. `BlockMetadata` had no `mediantime`. The indexer path filled `time` from the Esplora `block_time`; the fullnode path filled it from `block.time` although the RPC block carried `mediantime`.
- `confirmations` and `updated` were set from every processed tuple before the `versionTime` test and before the duplicate branch (ADR 067, decision 3). A `versionTime` stop reported the block of an update that was not applied. Every discovery round reset both fields.
- The loop applied the whole round, then looked for new beacon addresses (ADR 060). The history v2 on beacon A, v3 on beacon B (added by v2), v4 on beacon A collected `[v2, v4]` from A in round one and raised `LATE_PUBLISHING_ERROR` on v4. The specification re-scans B after v2 and reaches v4.
- The JSDoc of the resolver pointed at the old section anchors, and the code comments called the ADR 067 increment placement a deliberate deviation. Pull request 337 adopted that placement; the wording was obsolete.

Specification pull request 364 ("Do not stop at `versionTime` for a duplicate update") is open. ADR 068, decision 1, confirms a duplicate before the `versionTime` test. That order stays until the pull request merges or closes.

## Decision

**The constructor validates the resolution options.** A request with `versionId` and `versionTime` raises a `ResolveError` of type `INVALID_OPTIONS`. `versionId` must be an ASCII string of an integer (an optional minus sign, then digits) inside the safe integer range. `versionTime` must be an XML Datetime in UTC with the `Z` designator and no fraction, the form that DID Resolution v1 requires. Every other value raises `INVALID_OPTIONS`. The constructor parses each value once; the loop compares numbers. The check runs before any data need, as `validateMinConf` does (ADR 105).

**`BlockMetadata` carries `mediantime`.** The field is required. The indexer path fetches the Esplora block (`GET /block/:hash`) once per distinct block hash of a confirmed signal and reads `mediantime` from it. The fullnode path reads `mediantime` from the RPC block. A signal with no finite `mediantime` fails the eligibility check of the BeaconProcess phase with `INVALID_DID_UPDATE`, as a signal with no height or time does. The bitcoin package does not change.

**The resolver processes one update per pass and re-scans after each apply.** The tuples that BeaconProcess collects stay in one list across passes. The ProcessUpdate phase sorts the list by `targetVersionId`, then by block height, and removes the first tuple. After an apply, the phase looks for beacon addresses that the document now carries and that the resolver did not scan. If it finds one, the resolver returns to BeaconDiscovery and emits `NeedBeaconSignals`; the `maxDiscoveryRounds` guard applies there (ADR 059). If it finds none, the phase continues with the next tuple. The version counter, the update hash history, `confirmations`, and `updated` live on the instance and carry across passes. This closes the metadata reset that ADR 067 left open.

**The `versionId` test runs at the top of each step, and an unsatisfiable `versionId` raises `NOT_FOUND`.** When the current version equals the parsed `versionId`, the resolver resolves the current document. When the tuple list is empty, or the document is deactivated, and `versionId` is set, the resolver raises a `ResolveError` of type `NOT_FOUND`. Otherwise it resolves the current document. The order is the order of "Process Next Update", steps 1 and 2. Version 1 is reachable: `versionId: "1"` with a version 2 signal returns the genesis document with the label `"1"`.

**`versionTime` compares the block `mediantime`, and the boundary is inclusive.** The test is `mediantime > versionTime`, in milliseconds. A tuple whose `mediantime` is equal to `versionTime` applies. The duplicate branch runs before the test (ADR 068, decision 1): a confirmed duplicate does not stop the resolution, whatever its `mediantime`. `updated` keeps the header time of the block: it is the timestamp of the update, not a selection key.

**`confirmations` and `updated` stamp on the apply path only.** A tuple that stops the resolution at `versionTime` does not stamp. A confirmed duplicate does not stamp: `confirmations` refers to the block of the most recently applied unique update (footnote 2 of "Resolve"), and a duplicate applies nothing. The late publishing path raises before any stamp. The no-update result keeps `confirmations: 0`, and `versionId` is the current version, never the requested one.

**`Resolver.updates()` is removed.** The static method processed a whole list in one call and returned a response. The one-tuple step needs the instance state, and no package used the static method. The private helpers `confirmDuplicate` and `applyUpdate` stay. The guard in `confirmDuplicate` for a history slot that does not exist stays as defense in depth; the resolver loop cannot reach it.

## Scope boundary

- The proof `created` and `expires` window of "Check `update.proof`" needs the block in `applyUpdate`. It is the subject of a later decision, together with the other read-path proof checks.
- The `current_block_height` filter of "Find Beacon Signals" exists only in specification pull request 365. It follows that pull request.
- Footnote 2 of "Resolve" says that a resolver uses the lowest block height when it deduplicates. A duplicate at a lower height than the applied update can arrive only from a beacon that a later round scans. This decision does not raise `confirmations` for it. The case is deferred.
- The api and the cli add no flag. The options arrive as JSON through `resolutionOptions`, `-r`, and `-p`.

## Consequences

**Positive.** A resolver on this version selects the same version as every other conformant resolver for a given `versionTime`, because `mediantime` does not decrease from one block to the next and each resolver reads the same value. A consumer that asks for a version that does not exist receives `NOT_FOUND`, not the latest document. A history that alternates between two beacons resolves.

**Negative (breaking, method MINOR at 0.x).** `BlockMetadata.mediantime` is required: every caller that constructs a `BeaconSignal` adds it. The indexer path makes one more request per distinct block. `Resolver.updates()` is gone. A request with both options, an invalid `versionId`, or a `versionTime` that is not a UTC XML Datetime fails with `INVALID_OPTIONS`; before, it was silent. `versionId: "1"` returns version 1; before, it returned version 2. A `versionId` past the history fails with `NOT_FOUND`; before, it returned the latest document. `confirmations` after a `versionTime` stop reports the last applied update; before, it reported the stopped tuple.

**Unchanged.** The signed update format, the signal bytes, the proofs, and the test-suite vectors. The `minConf` rule (ADR 105). The duplicate confirmation (ADR 067, decisions 1 and 2) and the duplicate-before-`versionTime` order (ADR 068, decision 1). The address deduplication that guarantees termination (ADR 059).

**Superseded.** ADR 067, decision 3, and the "Consequences" of ADR 068 that describe the stamping from every processed tuple. The round model of ADR 060 (apply the round, then look for new beacons): the version continuity that ADR 060 introduced stays, the batch apply does not. The ADR 105 deferral of the other pull request 359 changes is closed.

## Implementation

- `packages/method/src/core/resolver.ts`: the option validation; the `ProcessUpdate` phase; the instance metadata; the `NOT_FOUND` and `INVALID_OPTIONS` paths; `#eligibleSignals` requires `mediantime`; the JSDoc anchors.
- `packages/method/src/core/beacon/interfaces.ts`: `BlockMetadata.mediantime`.
- `packages/method/src/core/beacon/signal-discovery.ts`: the block fetch on the indexer path; `block.mediantime` on the fullnode path.
- `packages/method/src/core/interfaces.ts`: the `versionId` and `versionTime` documentation.
- Tests: `packages/method/tests/resolver.spec.ts`, `signal-discovery.spec.ts`, `beacon.spec.ts`, `beacon-broadcast.spec.ts`, `beacon-did-injection.spec.ts`; `packages/api/tests/did-method-api.spec.ts`, `did-method-api-cas-policy.spec.ts`; `packages/method/lib/verify-scenarios.ts`.
- Docs: `packages/method/README.md`, `packages/api/README.md`, `packages/cli/docs/resolve.md`.

## References

- Specification, "Resolve": "Process" (the option rules, the state list, the loop); "Find Beacon Signals"; "Process Next Update" (steps 1 to 6, footnotes 2 and 4).
- DID Resolution v1, "DID Resolution Options": `versionId` and `versionTime` are mutually exclusive; `versionTime` is an XML Datetime normalized to UTC without sub-second precision; the `INVALID_OPTIONS` and `NOT_FOUND` error codes.
- Specification pull requests 359 (2026-09-05), 363 (2026-09-06); pull request 364 (open) for the duplicate order; pull request 365 (open) for `current_block_height`.
- ADR 059 (unbounded discovery): the `maxDiscoveryRounds` guard.
- ADR 060 (cross-round version continuity): the version counter and the update hash history carry across rounds.
- ADR 067 (duplicate confirmation): decisions 1 and 2 stand; decision 3 is superseded.
- ADR 068 (`versionTime` and duplicate order): decision 1 stands until specification pull request 364 resolves.
- ADR 105 (signal confirmation): `validateMinConf`; the deferral of the other pull request 359 changes.
- ADR 110 (resolution metadata): the scope boundary that named this decision.
