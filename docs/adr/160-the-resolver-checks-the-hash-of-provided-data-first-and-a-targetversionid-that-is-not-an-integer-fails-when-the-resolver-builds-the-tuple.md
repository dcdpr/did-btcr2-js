# ADR 160: The Resolver Checks the Hash of Provided Data First, and a targetVersionId That Is Not an Integer Fails When the Resolver Builds the Tuple

- **Status:** Accepted
- **Date:** 2026-10-28
- **Packages:** `@did-btcr2/method` (MINOR: `Resolver.provide` checks the hash first and then only that the value is a JSON object; `Resolver.sidecarData` leaves out an update or a CAS Announcement that is not a JSON object; the tuple build refuses a `targetVersionId` that is not an integer; `Resolver.external` refuses a genesis document that is not a JSON object; each `genesisDocument` value other than `undefined` is a provided value); `@did-btcr2/api` (MINOR: `resolveDid` and `tryResolveDid` give other results for a CAS Announcement from the CAS and for an update with a `targetVersionId` that is not an integer; the browser bundle holds the method package); `@did-btcr2/cli` (PATCH: the `resolve` docs; dependency uptake through api)

## Context

### The two channels gave two results for one input

The sans-I/O `Resolver` gets the data of a beacon signal on two channels. The sidecar data goes into the lookup maps through `Resolver.sidecarData`. A caller gives each other item through `Resolver.provide` for a data need. The api uses the second channel for each item from the CAS.

`provide` ran shape checks before the hash check (ADR 055, decision 2). The sidecar channel had no shape check. Thus one item gave two results:

| Input | Before: sidecar | Before: `provide` | After: both channels |
|---|---|---|---|
| The DID deactivates at version 2. An update with version 3 and no `proof` follows. | `deactivated: true`, version 2 | `INVALID_DID_UPDATE` (shape check) | `deactivated: true`, version 2 |
| A CAS Announcement `{ [did]: hash, 'did:btcr2:other': 7 }` | version 2 | `INVALID_DID_UPDATE` (shape check) | version 2 |
| A signed update `{ foo: 1 }` with another hash | no match: a data need | `INVALID_DID_UPDATE` | `INVALID_SIGNAL_DATA` (sidecar: a data need) |
| A CAS Announcement `{ a: 1 }` with another hash | no match: a data need | `INVALID_DID_UPDATE` | `MISSING_UPDATE_DATA` (sidecar: a data need) |
| A signed update `[]` with the right hash | `LATE_PUBLISHING` | `INVALID_DID_UPDATE` | `MISSING_UPDATE_DATA` (sidecar: a data need first) |
| A signed update with `targetVersionId: 2.5` | `LATE_PUBLISHING` | `INVALID_DID_UPDATE` | `INVALID_DID_UPDATE` |
| A genesis document `["a"]` for an x1 DID made from another document | `INVALID_DID` | `INVALID_DID_UPDATE` | `INVALID_DID` |

The `LATE_PUBLISHING` results came from "Check `update.targetVersionId`". Most values that are not an integer went to the third arm, because they are not equal to the next version. The sort of step 3 subtracted two `targetVersionId` values. A value such as `undefined` or `"a"` gave `NaN`, so the order depended on the engine.

### The specification checks the hash first

"Find Beacon Signals" builds a tuple for each beacon signal. It hashes the retrieved update and names no other check: "The resolver MUST hash the update with the [JSON Document Hashing] algorithm. The resolver MUST compare the hash to `update_hash`. Raise an [`INVALID_SIGNAL_DATA`] error if the two hashes are not equal." "Process CAS Beacon" says: "The announcement is not available from [CAS] if the hash of the retrieved content is not equal to `map_update_hash`". The steps of "Process Next Update" then read the fields of the update.

"Process CAS Beacon" reads only one entry: "Read the decoded value of the announcement entry keyed by `did` as `update_hash`. If the announcement has no entry for `did`, the [Beacon Signal] announces no update for `did`."

### The specification needs an integer `targetVersionId`

The BTCR2 Unsigned Update says: "The `targetVersionId` MUST be one more than the integer form of the `versionId` of the DID document being updated." The BTCR2 Signed Update has the same properties. Thus a `targetVersionId` that is not an integer names no version. The specification names no step and no error type for such a value.

"Confirm Duplicate Update" says: "Raise an [`INVALID_DID_UPDATE`] error if `update.targetVersionId` is less than `2`."

### The genesis document channel refused `null`

`provide(NeedGenesisDocument)` refused a value that is not an object with `INVALID_DID_UPDATE`. The constructor took a sidecar `genesisDocument` only if the value was truthy. Thus a sidecar `null` was absent, and the resolver asked for the genesis document with a data need. `Resolver.external` read `genesisDocument.id` with no `null` check, so a DID made from the hash of `null` gave a `TypeError`.

## Decision

### 1. `provide` checks the hash first, then that the value is a JSON object

`provide` does these checks for `NeedSignedUpdate` and `NeedCASAnnouncement`, in this order:

1. The hash. The error types stay: a signed update with no JCS form or another hash gives `INVALID_SIGNAL_DATA`. A CAS Announcement in the same state gives `MISSING_UPDATE_DATA` (ADR 154, decision 3).
2. The value must be a JSON object (decision 2). For a CAS Announcement, the check reads the JSON form (ADR 146, decision 5).

`provide` checks no field of an update and no entry of an announcement. This change removes the functions `isSignedBTCR2Update` and `isCASAnnouncement`. The `Map` check of `NeedBeaconSignals` and the checks of `NeedSMTProof` stay.

### 2. Content with the right hash that is not a JSON object is not available

A signed update or a CAS Announcement with the right hash that is not a JSON object is not available. `provide` raises `ResolveError` of type `MISSING_UPDATE_DATA`, with one of these messages:

- `The signed update <hex> is not a JSON object.`
- `The CAS announcement <hex> is not a JSON object.`

`Resolver.sidecarData` leaves such an item out of `updateMap` and `casMap`. If a beacon signal needs it, the resolver asks for it with a data need. Thus each map value is an object. A falsy map value can no longer make a beacon emit its data need again.

The BTCR2 Signed Update "is a Map data structure". A CAS Announcement is "A data structure that maps DIDs to [BTCR2 Signed Update] hashes." Content that is not such a structure cannot be the data of the signal. "Find Beacon Signals" says: "Raise a [`MISSING_UPDATE_DATA`] error if the update is not available from either source." `CasApi.retrieve` already refuses content that is not a JSON object with `MISSING_UPDATE_DATA` (ADR 110). Thus the three channels have one rule.

### 3. The resolver reads only the entry of the DID in a CAS Announcement

On each channel, `CASBeacon.processSignals` reads only the own entry of the DID. An entry of another DID has no effect, also if its value is not a string. The value of the entry of the DID must decode to a 32-byte hash (ADR 146, decision 4). That rule now applies on each channel.

### 4. The tuple build refuses a `targetVersionId` that is not an integer

The resolver builds the tuples of a beacon address after the beacon has the data of each signal. Before it adds the tuples, it checks each update. A `targetVersionId` that is not an integer raises `ResolveError` of type `INVALID_DID_UPDATE`:

- Message: `Invalid update: targetVersionId is not an integer`.
- Data: `{ targetVersionId }`.

Thus the order of the checks of one update is: the hash, the JSON object, then the integer. The check applies at each position in the history, also after a deactivation and at a beacon that an applied update removed. The specification already fails an update that is not available when the resolver builds the tuple.

Each `targetVersionId` in `updates` is then an integer, so the sort of step 3 is total. The sort does not change.

`confirmDuplicate` checks only the rule of "Confirm Duplicate Update": a `targetVersionId` less than 2 raises `INVALID_DID_UPDATE`. Its message is now `Invalid duplicate: targetVersionId is less than 2`. An integer `targetVersionId` goes to the step of the specification: `1` goes to "Confirm Duplicate Update", and `1e21` gives `LATE_PUBLISHING`.

### 5. Each `genesisDocument` value other than `undefined` is a provided value

The constructor takes a sidecar `genesisDocument` if the value is not `undefined`. `provide(NeedGenesisDocument)` takes each value and does not throw. The flag `#genesisProvided` records the provided value, so the GenesisDocument phase also hashes `null`. `Resolver.external` then does these checks:

1. The hash. A value with no JCS form gives `INVALID_DID_DOCUMENT` (ADR 154, decision 3). Another hash gives `INVALID_DID`.
2. The value must be a JSON object. Another value gives `ResolveError` of type `INVALID_DID_DOCUMENT`, with the message `Invalid genesis document: the value is not a JSON object`.
3. The other checks of the genesis document (ADR 148, ADR 149).

"Process Sidecar Data" says: "hash `sidecar.genesisDocument` with the [JSON Document Hashing] algorithm." It continues: "Raise an [`INVALID_DID`] error if the computed hash does not match `genesis_bytes`." "Establish `current_document`" says: "The resulting [DID Document (data structure)] MUST be conformant to DID Core v1.1". A value that is not a JSON object cannot conform.

The api CAS path keeps `NOT_FOUND` for a genesis document that is not a JSON object (ADR 110).

### 6. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| A `targetVersionId` that is not an integer fails when the resolver builds the tuple, also after a deactivation. | BTCR2 Unsigned Update: "The `targetVersionId` MUST be one more than the integer form of the `versionId` of the DID document being updated." "Find Beacon Signals": "Build a tuple with:". The specification names no step for this value. | Conforms. |
| A `targetVersionId` that is not an integer gives `INVALID_DID_UPDATE`. | Errors: `INVALID_DID_UPDATE` refines `INVALID_DID_DOCUMENT`. "Confirm Duplicate Update" gives `INVALID_DID_UPDATE` for a `targetVersionId` less than 2. The specification names no error type for this value. | Conforms. |
| Content with the right hash that is not a JSON object gives `MISSING_UPDATE_DATA`. | "Find Beacon Signals": "Raise a [`MISSING_UPDATE_DATA`] error if the update is not available from either source." BTCR2 Signed Update: "is a Map data structure". | Conforms. |
| A sidecar item that is not a JSON object stays out of the maps. | Resolve: "[Sidecar Data] that the resolver did not use has no effect on the result." | Conforms. |
| An entry of another DID in a CAS Announcement has no effect on each channel. | "Process CAS Beacon": "Read the decoded value of the announcement entry keyed by `did` as `update_hash`." | Conforms. |
| A sidecar `genesisDocument` of `null` is a provided value. | "Process Sidecar Data": "hash `sidecar.genesisDocument` with the [JSON Document Hashing] algorithm." Only an absent value goes to the CAS: "If `sidecar.genesisDocument` is not provided, retrieve it from [CAS]". | Conforms. |
| A genesis document with the right hash that is not a JSON object gives `INVALID_DID_DOCUMENT`. | "Establish `current_document`": "The resulting [DID Document (data structure)] MUST be conformant to DID Core v1.1". The specification names no error type. DID Resolution v1 defines `INVALID_DID_DOCUMENT` as "The DID document was malformed." | Conforms. |

## Alternatives

**Sort a `targetVersionId` that is not a number after each number, and check it in "Process Next Update".** Rejected. A string `"3"` before a deactivation then gave `deactivated: true`. The BTCR2 Unsigned Update needs an integer, so such an update is not valid at each position.

**Literal arms for each number.** Rejected. `2.5` at version 1 then gave `LATE_PUBLISHING`, and `1.5` at version 2 went to "Confirm Duplicate Update". Two error types for one malformed field.

**A non-object announcement has no entry, so it announces no update. A non-object update fails in "Process Next Update".** Rejected. `CasApi.retrieve` then needs a return type for content that is not a JSON object (ADR 110). The three channels then have two rules.

**Refuse the whole CAS Announcement if an entry of another DID is not a hash.** Rejected. One bad entry of another DID then stops the resolution of this DID. In an aggregate beacon, the coordinator or another participant writes those entries.

**A sidecar `genesisDocument` that is not an object gives `INVALID_OPTIONS`.** Rejected. One value then has two error types: `INVALID_OPTIONS` in the sidecar and `INVALID_DID` through `provide`. "Process Sidecar Data" hashes the value and names `INVALID_DID`.

**`null` through `provide(NeedGenesisDocument)` is not a provided value.** Rejected. A driver that gives the same value again then loops on the same data need.

## Consequences

- The method and api packages get a MINOR release. The cli gets a PATCH release.
- The sidecar channel and `provide` give one result for one input.
- A sidecar genesis document of `null`, `0`, `""`, or `false` for an x1 DID is now a provided value. Before, the resolver asked for the genesis document with a data need. Now the hash check gives `INVALID_DID`. For a DID made from the hash of the value, the object check gives `INVALID_DID_DOCUMENT`.
- This change removes three error messages: `Provided data for NeedSignedUpdate is not a signed BTCR2 update.`, `Provided data for NeedCASAnnouncement is not a CAS announcement.`, and `Provided data for NeedGenesisDocument must be a document object.`
- `provide(NeedCASAnnouncement)` with an own entry `undefined` for the DID gives no update. Before, it gave `INVALID_DID_UPDATE`.
- A DID made from the hash of `null` gives `INVALID_DID_DOCUMENT`, not a `TypeError`. For a DID made from the hash of another value that is not a JSON object, `Resolver.external` and the sidecar keep `INVALID_DID_DOCUMENT`, with the new message. Through `provide`, such a value gave `INVALID_DID_UPDATE` before.
- A resolution that gets its data from the CAS can now give a result where it failed before. Example: an object update with no `proof` after a deactivation now gives `deactivated: true`, as the sidecar channel did. An update that is not a JSON object in the same place gives `MISSING_UPDATE_DATA`. An update with a `targetVersionId` that is not an integer gives `INVALID_DID_UPDATE` on each channel. An implementation that checks the fields of an update at retrieval fails in the first case. The specification names no such check.
- The test vectors give the same result for each vector offline, on regtest, signet, mutinynet, and testnet4.
- The specification names no error type for a `targetVersionId` that is not an integer or for content that is not a JSON object. A later change of the specification can change the error types of decisions 2, 4, and 5.

**Superseded.**

- ADR 055, decision 2: the field checks of a CAS Announcement and of a signed update, and the object check of a genesis document, at `provide`. Decisions 1 and 2 of this ADR replace them. The `Map` check and the SMT proof check stay.
- ADR 068, decision 2, first bullet: the part "a `targetVersionId` that is not an integer". Decision 4 of this ADR refuses such a value when the resolver builds the tuple. `confirmDuplicate` checks only "less than 2".
- ADR 068, decision 3: the `targetVersionId` check at the `provide` boundary.
- ADR 120: "A malformed update and a malformed announcement stay `INVALID_DID_UPDATE`."
- ADR 146, decision 5, last sentence: "In `provide(NeedCASAnnouncement)`, the shape check first refuses an announcement with an own entry whose value is `undefined` (`INVALID_DID_UPDATE`)."
- ADR 146, the consequence "`provide(NeedCASAnnouncement)` still refuses an announcement that has a value that is not a string, with `INVALID_DID_UPDATE`." Decision 3 of this ADR aligns the two paths.

**Unchanged.**

- ADR 055, decision 1: `provide` checks the hash. ADR 120 and ADR 154 set the error types. Decision 3 of ADR 055 (the bound of the discovery rounds) also stays.
- ADR 068, decision 1 and decision 2 except its "not an integer" part: the duplicate branch runs before the `versionTime` test, and `confirmDuplicate` guards the history read.
- ADR 110: `CasApi.retrieve` refuses content that is not a JSON object with `MISSING_UPDATE_DATA`. The genesis document path gives `NOT_FOUND`.
- ADR 145: a historical resolution processes the full history.
- ADR 146, decisions 4 and 5 except the last sentence of decision 5: `casMap` keeps the JSON form, and the value for the DID must decode to a 32-byte hash. Decision 3 of this ADR applies decision 4 on each channel.
- ADR 154, decisions 3 and 4: the error types for a value with no JCS form, and the sidecar maps leave out such an item. Decision 2 of this ADR adds the object rule.

## Implementation

- `packages/method/src/core/resolver.ts`:
  - The change removes `isSignedBTCR2Update` and `isCASAnnouncement`.
  - `provide`: the hash check, then the object check, for `NeedSignedUpdate` and `NeedCASAnnouncement`; `NeedGenesisDocument` sets `#genesisProvided`.
  - The constructor: `genesisDocument !== undefined`. The BeaconProcess phase: the integer check before the push of the tuples of an address.
  - `Resolver.sidecarData`: the object rule for `updateMap` and `casMap`. `Resolver.external`: the object check after the hash check. `confirmDuplicate`: only `< 2`.
- `packages/api/src/method.ts`: the JSDoc of `resolve` and `getInitialDocument`.
- Docs: `packages/method/README.md`, `packages/method/docs/beacon-system-overview.md`, `packages/api/README.md`, `packages/cli/docs/resolve.md`.
- Tests: `packages/method/tests/resolver.spec.ts` (the describe block "one result for one input on the sidecar and provide() channels (ADR 160)", 4 changed tests, the sidecar map test), `packages/method/tests/beacon.spec.ts` (1 test of `BeaconUtils.getBeaconServiceIds`), `packages/api/tests/did-method-api-cas-policy.spec.ts` (2 tests for a CAS Announcement from the CAS).

## References

- did:btcr2 specification: [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html) ("Process Sidecar Data", "Establish `current_document`", "Find Beacon Signals", "Process CAS Beacon", "Process Next Update", "Confirm Duplicate Update"), [Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html) (BTCR2 Unsigned Update, BTCR2 Signed Update, CAS Announcement), [Errors](https://dcdpr.github.io/did-btcr2/errors.html).
- [DID Resolution v1](https://www.w3.org/TR/did-resolution-1.0/), section 10 (Errors).
- [DID Core v1.1](https://www.w3.org/TR/did-1.1/).
- ADRs 055, 068, 110, 120, 145, 146, 148, 149, 154.
