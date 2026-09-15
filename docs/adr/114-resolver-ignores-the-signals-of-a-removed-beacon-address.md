# ADR 114: The Resolver Ignores the Signals of a Beacon Address That an Applied Update Removed

- **Status:** Accepted
- **Date:** 2026-09-15
- **Packages:** `@did-btcr2/method`; dependency uptake in `@did-btcr2/api` and `@did-btcr2/cli`

## Context

Specification issue 366 (2026-09-14) describes a gap in the resolve loop after ADR 111. "Find Beacon Signals" scans each beacon address one time and finds all of its signals, up to the last block. A BTCR2 Update can remove a beacon address from the DID document. The resolver applies that update mid-resolution, but the tuples of the signals that the removed address announced in later blocks stay in `updates`. No step removed them. The resolver applied them. Those signals are not signals of a BTCR2 Beacon in the current DID document, so the resolver could resolve an incorrect version.

Example of the issue: version 1 carries the beacon address `A`. A signal of `A` in block 100 announces version 2. A signal of `A` in block 200 announces version 3, which removes `A` and adds `B`. A signal of `A` in block 300 announces version 4. The resolver scanned `A` one time and found the three signals. It applied version 4 from a signal of an address that the document no longer carried.

Pull request 367 (merged 2026-09-14) closes the gap with two changes to "Resolve":

- Each tuple of the `updates` list carries the Beacon Address of its transaction, next to the block metadata and the signed update. "Find Beacon Signals" adds the address when it builds the tuple.
- "Process Next Update" gains a step 4, after the sort and the removal of the first tuple: "If `current_document` has no BTCR2 Beacon with the tuple's Beacon Address, ignore the tuple. Continue with the next tuple." The `versionTime` step is now step 5, `block_confirmations` is step 6, and "Check `update.targetVersionId`" is step 7.

The merged rule is simpler than the solution that the issue proposed. It does not compare block heights, and it does not remove the address from `scanned_beacons`. The current document decides, at the time the resolver processes the tuple.

The implementation at method 0.64.0 kept a tuple of two elements, the signed update and the block metadata, and ProcessUpdate had no address test. The resolver of this package applied version 4 in the example above.

## Decision

**Each update tuple carries the beacon address of its signal.** The `Resolver` keeps the `updates` list as `Array<UpdateTuple>`, where `UpdateTuple` is the labeled tuple `[update: SignedBTCR2Update, block: BlockMetadata, address: string]`. The BeaconProcess phase attaches the address when it collects the result of `processSignals`: it parses the `bitcoin:` endpoint of the beacon service with `BeaconUtils.parseBitcoinAddress`. The beacon classes and `BeaconProcessResult` do not change: a beacon does not know whether its service is still in the document, and the resolver already holds the service. The aggregation package is not touched.

**ProcessUpdate ignores a tuple whose address the current document does not carry.** After the sort and the removal of the first tuple (step 3), and before every other test, the resolver compares the address of the tuple with the parsed endpoints of `BeaconUtils.getBeaconServices(currentDocument)`. When no service has the address, the resolver continues with the next tuple. The ignored tuple does not stamp `confirmations` or `updated`, does not enter the update hash history, does not change the version counter, and does not reach the duplicate check. The order is the order of the specification: step 4 runs before the `versionTime` stop (step 5) and before "Check `update.targetVersionId`" (step 7), which contains the duplicate arm of ADR 067 and ADR 068.

**The test reads the document before Apply.** An update announced at the address that the update itself removes applies: at the time the resolver processes that tuple, the document still carries the address. This is the beacon rotation case, and a test guards it.

**The scan-once rule stays.** `#requestCache` (`scanned_beacons`) keeps the address of a removed beacon, as the merged specification text does. An update that adds the address again does not cause a new scan; the signals that the first scan found are the signals the resolver knows. A tuple at a re-added address applies, because the current document carries the address again.

## Scope boundary

- The rule does not compare block heights. A signal of the removed address in a block before the removal, whose tuple sorts after the removing update because of a higher `targetVersionId`, is ignored too. That is the merged rule of pull request 367; the height comparison of issue 366 was not adopted.
- "Find Beacon Signals" runs before the filter. A signal at a removed address whose update data is not in the sidecar and not in the CAS still raises `MISSING_UPDATE_DATA`, because the resolver resolves every signal to an update before it processes the tuples. A test vector for an ignored signal ships the signed update in the sidecar.
- The filter is a resolver rule. The write path (`DidBtcr2.update`) does not refuse an update that removes the beacon it is announced at, and does not refuse an announcement at a removed beacon. The api and the cli do not change.
- The `Updater`, the beacon classes, `BeaconProcessResult`, `BeaconSignal`, and `BlockMetadata` do not change.

## Consequences

**Positive.** The resolver applies only the signals of the beacon addresses in the current DID document, as the specification requires. A controller that removes a beacon address ends the authority of that address: a later signal of the address, from a spent or stolen key, does not change the document. Every conformant resolver reads the same current document, so every resolver ignores the same tuples.

**Negative (breaking, method MINOR at 0.x).** A history that announces a later version at a removed beacon address no longer resolves to that version. Before, the resolver applied it. Such a history resolves to the last version that a kept address announced, and a `versionId` that only an ignored update reaches fails with `NOT_FOUND`. A conflicting re-announcement of an applied version at a removed address is ignored and is not an equivocation; before, it raised `LATE_PUBLISHING`. The `Resolver` keeps the tuple private, so no public type changes.

**Unchanged.** The signed update format, the signal bytes, the proofs, and the test-suite vectors. The resolver loop, the resolution options, and the `mediantime` comparison (ADR 111). The proof checks and the strict patch (ADR 112). The duplicate rules (ADR 067, ADR 068). The confirmation threshold (ADR 105). The discovery rounds and the version continuity across them (ADR 059, ADR 060).

## Implementation

- `packages/method/src/core/resolver.ts`: the `UpdateTuple` type; the address in BeaconProcess; step 4 in ProcessUpdate; the step comments follow the new numbering.
- `packages/method/tests/resolver.spec.ts`: the describe block "the signals of a removed beacon address (ADR 114)", seven cases.
- `packages/method/README.md`: one sentence in the resolver section.
- Versions: method 0.65.0 (MINOR); api 0.25.1 and cli 0.24.3 (PATCH, dependency uptake).

## References

- Specification, "Resolve": "Process" (the `updates` state), "Find Beacon Signals", "Process Next Update" (step 4).
- Specification, "Beacons": every Beacon Signal of a BTCR2 Beacon in the current DID document MUST be processed.
- Specification issue 366 (2026-09-14) and pull request 367 (merged 2026-09-14).
- ADR 059 and ADR 060 (discovery rounds; the version counter across rounds).
- ADR 067 and ADR 068 (the duplicate rules and their position before the `versionTime` test).
- ADR 105 (the confirmation threshold at signal intake).
- ADR 111 (the resolver loop of one update per pass).
- ADR 112 (the proof checks and the strict patch of the read path).
