# ADR 145: A Historical Resolution Processes the Full History and Returns the Requested State

- **Status:** Accepted
- **Date:** 2026-10-09
- **Packages:** `@did-btcr2/method` (MINOR: for a request with `versionId` or `versionTime`, the resolver processes every update, and an error in a later update fails the request); `@did-btcr2/api` (MINOR: the browser bundle holds the method package, and `resolveDid` and `tryResolveDid` refuse a historical request that they accepted before); `@did-btcr2/cli` (PATCH: dependency uptake)

## Context

### The specification keeps the requested state

Specification pull request 391 ("Keep a conflicting update fatal for historical resolution", merged 2026-10-09) closes specification issue 386. It changes "Process Next Update" of "Resolve".

Before the change, step 1 and step 5 resolved `current_document` as `didDocument`. Step 1 tested `versionId`. Step 5 tested `versionTime` against the block `mediantime` of the tuple. The resolver did not process the rest of the updates.

After the change, step 1 and step 5 copy the state to a new variable, `requested_state`. The specification defines it: "the state at the version that `resolutionOptions.versionId` or `resolutionOptions.versionTime` requests, a copy of `current_document`, `current_version_id`, `block_confirmations` and `block_mediantime`, the values `didDocumentMetadata` is built from. The resolver keeps these copies while it processes the rest of the updates (starts empty)."

Each of the two steps copies only if `requested_state` is empty. Step 2 runs if no tuple is left or if the document is deactivated. If `requested_state` is not empty, step 2 sets the four values from it and resolves `current_document`. Otherwise step 2 raises `NOT_FOUND` if `versionId` is set, as before.

The pull request also removes a condition from the rule for unused sidecar data. The rule "Sidecar Data that the resolver did not use has no effect on the result" now applies also to a request with `versionId` or `versionTime`.

### The resolver stopped at the requested version

[ADR 111](111-resolver-processes-one-update-per-pass-and-validates-the-resolution-options.md) implemented the old steps 1 and 5: the resolver ended the resolution at the requested version. Thus the resolver did not check a later update with the steps of "Process Next Update". An error that these steps find, for example `LATE_PUBLISHING` or `INVALID_DID_UPDATE` from "Apply `update`", did not fail a historical request. Example: a history has a valid version 2, a valid version 3, and a later beacon signal with a second, different version 3.

| Request | Specification | This library before |
|---|---|---|
| no option | `LATE_PUBLISHING` | `LATE_PUBLISHING` |
| `versionId: "2"` | `LATE_PUBLISHING` | version 2 |
| `versionTime` after version 2 and before version 3 | `LATE_PUBLISHING` | version 2 |

[ADR 068](068-resolver-versiontime-duplicate-order.md) recorded a part of this case as a residual risk. The window of a `versionTime` request is the history up to `versionTime`. A second, different update for a version in the window failed a `versionTime` request. A gap or two different updates of one version after the window did not. A `versionId` request did not check a second, different update of the requested version, or an update of a later version.

## Decision

### 1. Step 1 and step 5 keep the requested state, and step 2 restores it

The resolver holds `requested_state` in the private field `#requestedState`, with four values: the document, the version, `confirmations`, and `updated`. At step 1 and at step 5, the resolver keeps the current values in `requested_state` if `requested_state` is empty. Then it continues. At step 2, if `requested_state` is not empty, the resolver sets the four values from it and completes. Otherwise, the `NOT_FOUND` rule of ADR 111 applies.

`requested_state` holds a reference to the document, not a copy. For each update, the resolver makes a new current document, because `JSONPatch.apply` patches a clone. Thus the document in `requested_state` does not change. If a future `JSONPatch.apply` patches in place, the resolver must copy the document at step 1 and step 5.

### 2. An error in a later update fails the request

The resolver processes each update after the requested version with the checks of a request for the current version. Thus one history gives one answer about its integrity: a historical request fails if a request for the current version fails. The errors include `LATE_PUBLISHING`, `INVALID_DID_UPDATE`, `MISSING_UPDATE_DATA`, and the `INTERNAL_ERROR` of the `maxDiscoveryRounds` limit.

### 3. The order of the tests before step 5 stays

Two tests run before the step 5 test, and neither keeps the requested state:

1. The resolver ignores a tuple at a beacon address that the document no longer has (step 4).
2. A duplicate of an applied version goes to the duplicate branch (ADR 068, decision 1). The step 5 condition "The tuple's `targetVersionId` is more than `current_version_id`" gives the same result. Footnote 4 of "Process Next Update" gives the reason: the block of a duplicate can be after `versionTime`, and the next version can be before it.

### 4. The metadata is the metadata of the requested version

`confirmations` and `updated` come from `requested_state`. Thus they report the block of the update that yields the requested version, not the block of a later update. `deactivated` comes from the document in `requested_state`, so a later deactivation does not change it.

## Alternatives

- **Stop at the requested version, and check only the duplicates after it.** Rejected. The specification processes each later update. A historical request then still passes with a gap or an invalid update after it.
- **Copy the document at step 1 and step 5 (`structuredClone`).** Rejected. `JSONPatch.apply` makes a new object already, so the copy adds no safety. The JSDoc of `#saveRequestedState()` names the condition.
- **Resolve two times: a request for the current version, then a historical request.** Rejected. The caller then fulfills each data need two times. The two runs can also read different chain tips.

## Consequences

- A historical request that passed before can now fail. The method and api packages get a MINOR release.
- A historical request needs the data of each later update. Before, the resolver already emitted the data needs of each later signal at a scanned beacon address. The reason: "Find Beacon Signals" builds every tuple of a scanned address before the resolver applies the next update. The new data needs come from each beacon that an update after the requested version adds. The resolver now emits `NeedBeaconSignals` for such a beacon. For each signal at such a beacon, it emits `NeedCASAnnouncement`, `NeedSMTProof`, or `NeedSignedUpdate` if the sidecar data does not have the data.
- The api fetches a signed update or a CAS announcement from the CAS if the sidecar data does not have it. The api has no CAS channel for an SMT proof. Thus a historical request fails with `MISSING_UPDATE_DATA` if `sidecar.smtProofs` does not have the proof of a beacon signal at an SMT beacon. A signal that announces no update for the DID also needs its proof. Before, this was already true for an SMT beacon that the document had at or before the requested version. It is new for an SMT beacon that an update after the requested version adds.
- An opt-in `maxDiscoveryRounds` counts the discovery rounds of the full history. Example: version 2 adds beacon B, version 3 on beacon B adds beacon C, and version 4 is on beacon C. Before, `versionId: "2"` with `maxDiscoveryRounds: 1` returned version 2. Now it fails with `INTERNAL_ERROR`.
- The residual risk of ADR 068 closes for the cases after the window. A gap or two different updates of one version after the requested version now fail a historical request. They also fail a request for the current version.
- A deactivation still ends the history at step 2. The resolver does not check a tuple after a deactivation. Specification pull request 391 leaves this case to a later specification issue.
- `versionId: "0"` and a negative `versionId` still fail with `NOT_FOUND`: no version is below 1. A new test checks this behavior.
- The expected outputs of the test vectors do not change.

**Superseded.**

- ADR 110, the decision "The result carries the required metadata": the clause "`updated` is absent until the resolver applies an update". For a request with `versionId` or `versionTime`, `updated` is absent if the requested version is 1, also after the resolver applies later updates.
- ADR 111, the decision "The `versionId` test runs at the top of each step, and an unsatisfiable `versionId` raises `NOT_FOUND`": the sentence "When the current version equals the parsed `versionId`, the resolver resolves the current document." The resolver now keeps the requested state and continues. The `NOT_FOUND` rule stays.
- ADR 111, the decision "`confirmations` and `updated` stamp on the apply path only": the sentence "A tuple that stops the resolution at `versionTime` does not stamp." No tuple stops the resolution now. The resolver applies and stamps the tuple after step 5, and step 2 restores the values of `requested_state`. The other stamp rules stay.
- ADR 111, "Consequences": the sentence "`confirmations` after a `versionTime` stop reports the last applied update; before, it reported the stopped tuple." `confirmations` now reports the block of the update that yields the requested version.
- ADR 068, decision 1: the parts below. The order of decision 1 (the duplicate branch before the `versionTime` test) stays.
  - The clause "the versionTime check gates only the state-changing paths (apply and late-publishing)".
  - The clause "it is scoped to the window".
  - The sentence from "Equivocation confined entirely to announcements after versionTime" to "exactly as before".
- ADR 068, "Consequences": the bullet "The strengthened detection does not extend past the window", with its parenthetical on `versionId` queries.
- ADR 068, "Rejected alternatives": the parenthetical "Equivocation confined entirely beyond the window is masked by the retained early return under either design".

## Implementation

- `packages/method/src/core/resolver.ts`: the interface `RequestedState`, the field `#requestedState`, the method `#saveRequestedState()`, steps 1, 2, and 5 of the `ProcessUpdate` phase, and the JSDoc of `DidResolutionResponse`.
- `packages/method/src/core/interfaces.ts`: the JSDoc of `versionId`, `versionTime`, `maxDiscoveryRounds`, and `minConf`.
- `packages/method/tests/resolver.spec.ts`: the tests "a historical request processes the full history (ADR 145)", the test `versionId "0" and "-1" fail with NOT_FOUND: no version is below 1`, and the changed titles in "update-processing limits (versionId / versionTime / deactivated)" and in "resolution options and the update loop of the specification (ADR 111)".
- `packages/method/README.md`, `packages/api/README.md`, and `packages/cli/docs/resolve.md`: the text of `versionId`, `versionTime`, `maxDiscoveryRounds`, and the metadata.
- `packages/api/docs/test-vectors.md`, `packages/api/lib/readme-scenarios.ts`, and the four `23-k1-duplicate-signal.json` recipes: the text of the recorded metadata and of the duplicate case. The README of the vector corpus changes at the next vector pass.

## References

- [did:btcr2 specification, Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html): the state list and [Process Next Update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-next-update).
- [Specification pull request 391](https://github.com/dcdpr/did-btcr2/pull/391) and [specification issue 386](https://github.com/dcdpr/did-btcr2/issues/386).
- [ADR 068](068-resolver-versiontime-duplicate-order.md): the duplicate branch before the `versionTime` test.
- [ADR 110](110-resolution-metadata-and-did-resolution-error-codes.md): the resolution metadata.
- [ADR 111](111-resolver-processes-one-update-per-pass-and-validates-the-resolution-options.md): one update per pass and the resolution options.
