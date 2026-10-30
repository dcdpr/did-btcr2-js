# ADR 165: The api Refuses versionId and versionTime in the Source Resolution of an Update

- **Status:** Accepted
- **Date:** 2026-10-30
- **Packages:** `@did-btcr2/api` (MINOR: `updateDid` and `deactivateDid` refuse `versionId` and `versionTime` in `options.resolutionOptions` for a DID source, before any I/O); `@did-btcr2/cli` (PATCH: the `update` and `deactivate` docs; dependency uptake through api)

## Context

### ADR 098 left the version options to the docs

`updateDid` and `deactivateDid` take a DID or a resolved state as the source (ADR 123). For a DID, the api resolves the DID with `options.resolutionOptions` (ADR 098). The source document and its `versionId` come from that resolution. The new update gets the `targetVersionId` `versionId + 1`.

`ResolutionOptions` also has `versionId` and `versionTime`. These options select a version of the DID, for example an earlier version. ADR 098 did not refuse them: "**The version-targeting fields are documented away, not stripped.**" Its reason: "Silently deleting fields from a caller's object was rejected as worse than the footgun; the method documentation instructs callers to leave them unset." The JSDoc of `DidUpdateOptions.resolutionOptions` said: "Leave `versionId` and `versionTime` unset." No code did a check.

The cli `update` and `deactivate` give their `-r` and `--resolution-options-path` flags to this resolution. Thus `btcr2 update -r '{"versionId":"1"}'` gave the source resolution the option `versionId: '1'`.

The check of ADR 135 runs after the resolution. It refuses the update only if the sidecar updates of the DID have a `targetVersionId` above the resolved `versionId`. Without such sidecar updates, the api signed and broadcast an update on the earlier version. With them, the message of the refusal told the caller to wait for confirmations. That remedy does not apply.

### The specification requires the current version

Update, "Construct BTCR2 Unsigned Update", says: "`targetVersionId` MUST be derived from the `versionId` returned in the [DID document metadata (data structure)] by a fresh resolution of the DID, rather than from a locally maintained count. Announcing a [BTCR2 Signed Update] whose `targetVersionId` is wrong in either direction can permanently prevent the DID from resolving." It also says: "`sourceDidDocument` MUST be the [DID document (data structure)] that the same fresh resolution returns."

### The result is worse than ADR 098 says

ADR 098 gives this consequence: "a caller who passes `versionId`/`versionTime` gets an update built on a historical version, signed and broadcast, that no resolver will apply." The specification gives a worse result.

An update on version N has the `targetVersionId` N + 1. If the current version is N + 1 or more, Resolve, "Check `update.targetVersionId`", sends the update to "Confirm Duplicate Update". That step says: "Raise a [`LATE_PUBLISHING`] error if the hashes differ." The hashes differ unless the update, without its `proof`, is the same as the update that the DID already has at version N + 1. Thus each resolution of the DID fails, with two exceptions:

- The document at version N + 1 has no beacon with the address of the update. "Process Next Update", step 4, then ignores the update: "If `current_document` has no [BTCR2 Beacon] with the tuple's [Beacon Address], ignore the tuple."
- Version N + 1 deactivates the DID. "Process Next Update", step 2, then gives the result before the resolver gets to the update.

## Decision

### 1. The api refuses `versionId` and `versionTime` for the source of an update

If the source of `updateDid` or `deactivateDid` is a DID, the api refuses `versionId` and `versionTime` in `options.resolutionOptions` before any I/O. The api refuses each value that is not `undefined`, also `''` and `null`. The method also treats only `undefined` as an absent option. The refusal is an `UpdateError` of type `INVALID_OPTIONS`, with the data `{ versionId, versionTime }`. The data has both keys, and one of the two values can be `undefined`. The message is:

`` The source resolution of an update cannot use `versionId` or `versionTime`: the source must be the current version of the DID, from a fresh resolution. ``

The check runs after the `expandRelativeUrls` check of ADR 162. If both checks fail, the api gives the `expandRelativeUrls` refusal. The cli `update` and `deactivate` give `-r` and `--resolution-options-path` to this resolution, so they get the same refusal.

### 2. A state source does not change

A `SourceState` is data of the caller. The api does not resolve it, so the api ignores `options.resolutionOptions` (ADR 098). The api cannot detect if a `SourceState` holds an earlier version. The docs tell the caller that a `SourceState` must hold the current version. `DidMethodApi.update`, `DidMethodApi.deactivate`, and the method package do not change.

### 3. The type does not change

`DidUpdateOptions.resolutionOptions` keeps the type `ResolutionOptions`. The refusal is a runtime check only. The cli gives parsed JSON to the api, so a type does not stop a cli value. ADR 162 made the same choice for `expandRelativeUrls`. The JSDoc of `DidUpdateOptions.resolutionOptions` names the three refused options.

### 4. The refusal meets the api guard criterion

ADR 135 gives the api guard criterion. The api refuses a write only if two conditions are true:

1. The failure is permanent for the DID. The specification says that a wrong `targetVersionId` "can permanently prevent the DID from resolving."
2. The api already holds the data to find the failure. The options are an input of the call, so the check needs no I/O.

### 5. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The api refuses `versionId` and `versionTime` for the source of an update (decision 1). | Update: "`targetVersionId` MUST be derived from the `versionId` returned in the [DID document metadata (data structure)] by a fresh resolution of the DID, rather than from a locally maintained count." and "`sourceDidDocument` MUST be the [DID document (data structure)] that the same fresh resolution returns." | Conforms. A version option selects a version that the caller gives, not the version that the resolution finds. |
| The api refuses each value that is not `undefined`, also a version that is equal to the current version (decision 1). | The specification does not define a fresh resolution with a version option. | Conforms. The rule is stricter than the specification. Before the resolution, the api cannot know the current version. A current version gives the same source as no option. |
| The error type is `INVALID_OPTIONS` (decision 1). | DID Resolution v1, section 9: `INVALID_OPTIONS`: "One or more of the options provided for DID Resolution or DID URL dereferencing are invalid." | Conforms. The fault is an option of the caller, not the update. |
| A state source does not change, and the type does not change (decisions 2 and 3). | The specification does not define the input of the api. | Conforms. |

## Alternatives

**Remove the two options from a copy of the options, then resolve.** Rejected. ADR 098 rejected a silent removal for a reason that stays true. The caller asks for an earlier version and gets an update on the current version, with no error. An error shows the mistake of the caller.

**Refuse only a version that is less than the current version.** Rejected. The api must then resolve the DID two times: one time with the option, and one time without it. The second resolution gives the current version, so the option has no use.

**Narrow the type to `Omit<ResolutionOptions, 'versionId' | 'versionTime' | 'expandRelativeUrls'>`.** Rejected. A type does not stop a value from parsed JSON or from JavaScript, so the runtime check is necessary in each case. The narrow type adds a second place for the rule. ADR 162 also kept the type for `expandRelativeUrls`.

**Refuse in the method package.** Rejected. `DidBtcr2.update` and the `Updater` take a source document and a `sourceVersionId`. They get no resolution options, so they cannot see the two options.

**Use `INVALID_DID_UPDATE`.** Rejected. The fault is an option of the caller. ADR 162 uses `INVALID_OPTIONS` for the `expandRelativeUrls` refusal of the same helper.

## Consequences

- The api gets a MINOR release. The cli gets a PATCH release.
- An `updateDid` or `deactivateDid` call with a DID source and `versionId` or `versionTime` now fails with an `UpdateError` of type `INVALID_OPTIONS` before any I/O. Before, the api resolved the earlier version. Then it signed and broadcast an update on that version, or the check of ADR 135 refused it with `INVALID_DID_UPDATE`. A `versionId` above the current version gave a plain `Error` (`Failed to resolve DID <did> for update: NOT_FOUND`). A value that does not parse, or both options, gave the same `Error` with `INVALID_OPTIONS`.
- A call with `versionId` and `versionTime` both `undefined` resolves as before.
- A call with a `versionId` that is equal to the current version now fails. A call with a `versionTime` after the last update also fails. Before, these calls gave a correct update. The caller must remove the option.
- No test vector changes. The vector scripts do not call `updateDid` or `deactivateDid`. The e2e scripts in `packages/api/lib/` give no `versionId` or `versionTime` to them.

These residuals stay:

- A state source does not change. The api cannot detect an earlier version in a `SourceState`.

**Superseded.**

- ADR 098, the decision "**The version-targeting fields are documented away, not stripped.**" Decision 1 of this ADR refuses the two options. The rejection of a silent removal stays (Alternatives).
- ADR 098, the negative consequence "The footgun stays reachable: a caller who passes `versionId`/`versionTime` gets an update built on a historical version, signed and broadcast, that no resolver will apply." Decision 1 of this ADR stops the update before any I/O. The Context of this ADR gives the result that the specification gives.

**Unchanged.**

- ADR 098: the source resolution takes the resolution options of the caller, and the api ignores the options for a state source. Decision 1 of this ADR adds the refusal of `versionId` and `versionTime`.
- ADR 135: the api refuses a resolved `versionId` that is less than the highest `targetVersionId` of the sidecar updates of the DID. Decision 1 of this ADR adds a refusal before the resolution, also without sidecar updates.
- ADR 162, decision 5: the api refuses `expandRelativeUrls: true` for the source of an update. Decision 1 of this ADR adds a second refusal after it.

## Implementation

- `packages/api/src/api.ts`: the check in `#resolveUpdateSource`, after the `expandRelativeUrls` check; the JSDoc of `updateDid` and of the helper.
- `packages/api/src/method.ts`: the JSDoc of `DidUpdateOptions.resolutionOptions`.
- Docs: `packages/api/README.md`, `packages/cli/docs/update.md`, `packages/cli/docs/deactivate.md`.
- Tests: api `did-btcr2-api.spec.ts` (for each write: the refusal of `versionId`, `versionTime`, both, `''`, and `null`; `undefined` values resolve; a state source ignores the options).

## References

- did:btcr2 specification: [Update](https://dcdpr.github.io/did-btcr2/operations/update.html) ("Construct BTCR2 Unsigned Update"), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html) ("Process Next Update", "Check `update.targetVersionId`", "Confirm Duplicate Update").
- [DID Resolution v1](https://www.w3.org/TR/did-resolution-1.0/), section 9.
- ADRs 098, 123, 135, 162.
