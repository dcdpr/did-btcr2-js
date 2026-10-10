# ADR 146: The Resolver Ignores a Sidecar SMT Proof Whose Id Does Not Decode, and a CAS Announcement Entry Must Decode to a Hash

- **Status:** Accepted
- **Date:** 2026-10-10
- **Packages:** `@did-btcr2/method` (MINOR: a CAS Announcement value for the DID that is not a hash now fails. The resolver now treats a proof whose `id` has non-zero pad bits as no proof); `@did-btcr2/api` (MINOR: the browser bundle holds the method package. `resolveDid` and `tryResolveDid` refuse a CAS Announcement value `''`, `null`, `0`, `NaN`, or `false` in `sidecar.casUpdates` that they accepted before. The `NeedSMTProof` error says that the resolver ignores a proof whose `id` does not decode to 32 bytes); `@did-btcr2/cli` (PATCH: dependency uptake)

## Context

### The specification reads the decoded value

Specification pull request 390 ("Key the SMT proof lookup by the decoded proof `id`", merged 2026-10-09, specification main `cc96c580`) closes specification issue 382. It changes "Process Sidecar Data", "Process CAS Beacon", and "Process SMT Beacon" of "Resolve".

- "Build a map from `sidecar.smtProofs` keyed by the decoded bytes of proof `id` (`smt_lookup_table`)."
- "Whether or not it builds `smt_lookup_table`, the resolver MUST ignore a proof in `sidecar.smtProofs` whose `id` has non-zero pad bits (RFC 4648 Section 3.5)."
- "Read the decoded value of the announcement entry keyed by `did` as `update_hash`. If the announcement has no entry for `did`, the Beacon Signal announces no update for `did`."
- "Raise an `INVALID_SIGNAL_DATA` error if the decoded `id` of `smt_proof` is not equal to `smt_root`."
- "If `smt_proof` has an `updateId`, use the decoded `updateId` as `update_hash`."

The section "Process" of "Resolve" says: "Sidecar Data that the resolver did not use has no effect on the result." "Process SMT Beacon" raises `MISSING_UPDATE_DATA` if `smt_lookup_table` has no entry for `smt_root`.

The body of the pull request gives the reason for the pad-bit rule. An encoder that conforms to RFC 4648 writes zero pad bits, so it never writes an `id` with non-zero pad bits. If the resolver ignores a bad proof, the proof cannot stop a resolution that does not need it. The lookup tables are only a SHOULD. Thus the pad-bit rule and the `id` check must also hold for a resolver that gets the proof another way.

### RFC 4648 lets the decoder choose

RFC 4648 Section 3.5 lets a decoder refuse a value with non-zero pad bits. A lenient decoder ignores the pad bits and gets the same bytes as from the canonical value. Node `Buffer` is lenient. `@scure/base` is strict: the `decode` function of `@did-btcr2/common` and `base64UrlToHash` of `@did-btcr2/smt` refuse the value. They also refuse `=` padding. [ADR 014](014-canonicalization-functions-and-toJSON-convention.md) accepted the strict choice for `=` padding: interoperation uses byte comparison, not a lenient decoder.

### The resolver threw or read a wrong hash

`Resolver.sidecarData` decoded the `id` of each sidecar proof with the strict decoder. A proof that the decoder refused stopped each resolution, also if no beacon signal needed the proof.

`CASBeacon.processSignals` treated an entry with a falsy value as no entry. It decoded each other value with no length check.

The table shows the results for each input. Each CAS row except the last row shows the input in `sidecar.casUpdates`. A string value gives the same result from the CAS.

| Input | Before | After |
|---|---|---|
| An unused sidecar proof whose `id` has non-zero pad bits | A plain `Error`. `tryResolveDid` gave `INTERNAL_ERROR`. | Resolves |
| An unused sidecar proof with an `=`-padded `id`, a number `id`, or no `id`, or an item of `sidecar.smtProofs` that is not an object | A plain `Error` or a `TypeError` | Resolves |
| An unused sidecar proof whose `id` decodes to another length, for example 31 bytes | Resolves. The table held the proof under a key of another length. | Resolves |
| A needed sidecar proof whose `id` the strict decoder refuses, for example an `id` with non-zero pad bits or `=` padding, with no good copy | A plain `Error` | `NeedSMTProof`. The api raises `MISSING_UPDATE_DATA`. |
| A good copy of a needed proof, and a copy whose `id` the strict decoder refuses | A plain `Error` | The resolver uses the good copy |
| `provide(NeedSMTProof)` with a proof whose `id` has non-zero pad bits | `INVALID_SIGNAL_DATA` | `MISSING_UPDATE_DATA` |
| A caller-built map with a proof whose `id` has non-zero pad bits | `INVALID_SIGNAL_DATA` | `NeedSMTProof` |
| A CAS Announcement value for the DID that is `''`, `null`, `0`, `NaN`, or `false` | Resolves, no update | `MISSING_UPDATE_DATA` |
| A CAS Announcement value for the DID that is not a string and not in the row above, for example `1`, `true`, or an object | A plain `Error` | `MISSING_UPDATE_DATA` |
| A CAS Announcement value for the DID that is a string with non-zero pad bits or `=` padding | A plain `Error` | `MISSING_UPDATE_DATA` |
| A CAS Announcement value for the DID that decodes to another length, for example `abc` or 20 letters | `NeedSignedUpdate` with a 2-byte or 15-byte hash | `MISSING_UPDATE_DATA` |
| An own entry for the DID with the value `undefined`, in a caller-built `casMap` | No update | `MISSING_UPDATE_DATA` |

## Decision

### 1. The key of `smt_lookup_table` stays the hex of the decoded `id`

[ADR 035](035-smt-proof-base64url-wire-format.md), decision 4, stays. One function, `smtProofRootHex`, gives the key on each path: `Resolver.sidecarData`, `provide(NeedSMTProof)`, and the root check of `SMTBeacon.processSignals`.

### 2. `Resolver.sidecarData` ignores each proof whose `id` does not decode to 32 bytes

The resolver ignores an item of `sidecar.smtProofs` that is not an object. It also ignores a proof whose `id` the strict decoder does not decode to 32 bytes. `smtProofRootHex` gives no value for such an `id`, so no `smt_root` can match it. The basis for an `id` with non-zero pad bits is the MUST of "Process Sidecar Data". The basis for each other `id` is the rule for unused sidecar data. For a beacon signal that needs an ignored proof, the resolver emits `NeedSMTProof`.

### 3. A pad-bit `id` counts as ignored on each path

- `provide(NeedSMTProof)` raises `MISSING_UPDATE_DATA` for a proof whose `id` has non-zero pad bits. This check runs before the shape check. The need stays open.
- `SMTBeacon.processSignals` treats a proof in a caller-built map whose `id` has non-zero pad bits as absent. It emits `NeedSMTProof`.

Reason: the pad-bit rule must hold for a resolver that gets the proof another way. In this library, `provide()` is the late sidecar channel. An ignored proof leaves `smt_lookup_table` with no entry for `smt_root`, so the code is `MISSING_UPDATE_DATA`.

On those two paths, each other `id` that does not decode stays `INVALID_SIGNAL_DATA`, and so does each root mismatch. Only a sans-I/O driver sees this difference from the sidecar path, because the api never calls `provide(NeedSMTProof)`.

The pad-bit test applies at each length of the `id`. It reads the text before `=` padding. The function `hasNonZeroPadBits` does not decode the text, so ADR 014 still applies.

### 4. A CAS Announcement value for the DID must decode to a 32-byte hash

`CASBeacon.processSignals` skips a signal only if the announcement has no own entry for the DID (`Object.hasOwn`). A present value that the strict decoder does not decode to 32 bytes raises `CASBeaconError` of type `MISSING_UPDATE_DATA`. The data of the error is `{ did, value, announcementHash, beaconServiceId }`. A value that is not a string gives the same error.

Reason: for a value that decodes to another length, the update is not available from either source. Thus "Find Beacon Signals" raises `MISSING_UPDATE_DATA`. For a value that does not decode, the specification names no code. A value that is not a hash cannot name a signed update. Thus the data that the signal announces is not available. An ignored SMT proof gives the same code.

### 5. `casMap` keeps the JSON form of each announcement

`Resolver.sidecarData` and `provide(NeedCASAnnouncement)` store the JSON form of each announcement in `casMap`. `map_update_hash` covers only the JSON content. JSON drops an own entry whose value is `undefined`, and it drops an entry that is not enumerable. Thus such an entry is not an entry for the DID, and the signal announces no update. Two announcements with one hash then give one result, in each order of `sidecar.casUpdates`. In `provide(NeedCASAnnouncement)`, the shape check first refuses an announcement with an own entry whose value is `undefined` (`INVALID_DID_UPDATE`).

### 6. The decoders stay strict

The resolver uses no lenient decoder. A proof whose `updateId` has non-zero pad bits fails SMT Proof Verification: `INVALID_SIGNAL_DATA`. The strict choice for the CAS Announcement value and for `updateId` is provisional. The specification does not yet give one pad-bit rule for each base64url value.

### 7. The helpers are internal

The functions `base64UrlHashHex`, `smtProofRootHex`, and `hasNonZeroPadBits` are in `packages/method/src/utils/base64url-hash.ts`. `index.ts` does not export the module. The precedent is `utils/error-cause.ts`.

## Alternatives

- **Ignore only a proof whose `id` has non-zero pad bits.** Rejected. Each other `id` that does not decode then still stops the resolution with an untyped error, also if no beacon signal needs the proof.
- **Raise `INVALID_SIGNAL_DATA` in `provide(NeedSMTProof)` for a pad-bit `id`.** Rejected. The resolver must ignore a proof whose `id` has non-zero pad bits, so the `id` check of "Process SMT Beacon" does not apply to it. An ignored proof leaves `smt_lookup_table` with no entry for `smt_root`. For a pad-bit copy of the correct proof, a lenient decoder also gives the bytes of `smt_root`.
- **Raise `INVALID_SIGNAL_DATA` for a CAS Announcement value that is not a hash.** Rejected. The value does not disagree with the signal bytes. The announcement hash matches them. The update that the value must name is not available.
- **Use a lenient decoder in `@did-btcr2/common`.** Rejected. ADR 014 records the strict choice. The change also needs a release of nine packages (each package except `smt`). Also, `Buffer` is not available in a browser.
- **Export the helpers from `smt-beacon.ts`.** Rejected. `index.ts` exports each symbol of that file, so the helpers become public API.
- **Keep the given announcement object in `casMap`.** Rejected. An own entry whose value is `undefined` then raises `MISSING_UPDATE_DATA`, but the hash does not cover the entry. Also the result of two announcements with one hash then depends on the order of `sidecar.casUpdates`.

## Consequences

- A CAS Announcement value for the DID that is not a hash now fails the resolution. Before, in `sidecar.casUpdates`, the values `''`, `null`, `0`, `NaN`, and `false` gave no update. The method and api packages get a MINOR release.
- An unused proof in `sidecar.smtProofs` whose `id` the strict decoder refuses no longer stops a resolution. The same is true for an unused item that is not an object.
- The api error for each `NeedSMTProof` gets one more sentence, also if the sidecar holds no proof for the root: "The resolver ignores a proof whose id does not decode to 32 bytes, for example an id with non-zero pad bits." The error still starts with "SMT proof required but not in sidecar".
- `provide(NeedCASAnnouncement)` still refuses an announcement that has a value that is not a string, with `INVALID_DID_UPDATE`. This rule also applies to the entry of another DID. In `sidecar.casUpdates`, a value that is not a string in the entry for the DID raises `MISSING_UPDATE_DATA`, if the JSON form keeps the entry (decision 5). There, the entry of another DID has no effect. A later change aligns the two paths.
- A pad-bit copy of a proof does not replace the canonical proof in `smt_lookup_table`, in each order. Before, the copy stopped the resolution. If two canonical proofs have one `id`, `smt_lookup_table` still keeps the last proof. The specification does not say which proof stays.
- A lenient resolver and this library can still give different results for a pad-bit value in other fields. These fields are the CAS Announcement value, `updateId`, `sourceHash`, `targetHash`, `nonce`, `collapsed`, and `hashes`. An `=`-padded SMT proof `id` is a similar case. A specification issue can ask for one rule for each base64url value.
- The participant checks of `@did-btcr2/aggregation` stay stricter than the resolver. They do not change.
- The test vectors do not change. Each SMT proof `id` and each CAS Announcement value in the vectors decodes to 32 bytes with zero pad bits. The recorded `errorMessage` of the n30 and n31 sets (8 `resolve/output.json` files) keeps the old text with no last sentence. The pattern of `FAILURE_RULES` still matches the new text, and no verifier compares the full text. The next regeneration records the new text.

**Superseded.**

- ADR 120, the decision "The method package raises the codes of the specification": the sentence "Either failure raises `SMTBeaconError` of type `INVALID_SIGNAL_DATA`." For a proof in a caller-built map whose `id` has non-zero pad bits, `SMTBeacon.processSignals` now emits `NeedSMTProof`. The other failures stay `INVALID_SIGNAL_DATA`.
- ADR 120, the same decision: the list item "an SMT proof whose `id` is not the root or does not decode." For an `id` with non-zero pad bits, `provide(NeedSMTProof)` now raises `MISSING_UPDATE_DATA`. The other cases stay `INVALID_SIGNAL_DATA`.
- ADR 120, the same decision: the list item "an SMT proof of another shape". For an object (not an array) whose `id` has non-zero pad bits, `provide(NeedSMTProof)` now raises `MISSING_UPDATE_DATA` before the shape check. Each other value of another shape stays `INVALID_SIGNAL_DATA`.

**Unchanged.**

- ADR 014: the decoder refuses `=` padding.
- ADR 035, decision 4: the hex key of `smtMap` and the same key in `provide(NeedSMTProof)`.
- ADR 041: a member with no update has no entry in the CAS Announcement.
- ADR 110: the error codes in the resolution metadata.
- ADR 120: a malformed announcement in `provide()` stays `INVALID_DID_UPDATE`. The library does not report unused sidecar data.

## Implementation

- `packages/method/src/utils/base64url-hash.ts`: `base64UrlHashHex`, `smtProofRootHex`, `hasNonZeroPadBits`.
- `packages/method/src/core/resolver.ts`: `Resolver.sidecarData`, `provide(NeedSMTProof)`, and `provide(NeedCASAnnouncement)`.
- `packages/method/src/core/beacon/smt-beacon.ts` and `cas-beacon.ts`: `processSignals`.
- `packages/method/src/core/interfaces.ts` and `types.ts`: the JSDoc of `SMTProof`, `Sidecar`, `CASAnnouncement`, `SMTBeaconSidecarData`, and `SidecarData`.
- `packages/method/tests/base64url-hash.spec.ts`, `beacon.spec.ts`, and `resolver.spec.ts`: the tests of the helpers, the beacons, and "SMT proof ids and CAS Announcement values read as decoded bytes (ADR 146)", and the changed title of one `provide(NeedSMTProof)` test.
- `packages/api/src/method.ts`: the sentence of the `NeedSMTProof` error and the JSDoc of `resolve`. `packages/api/lib/verify-scenarios.ts`: the copy of that message.
- `packages/api/tests/did-method-api-cas-policy.spec.ts`: the api tests of the ignored proof and of the CAS Announcement values.
- `packages/api/README.md`, `packages/cli/docs/resolve.md`, and `packages/method/docs/beacon-system-overview.md`: the text of `smtProofs`, `casUpdates`, the CAS read path of the api, and the beacon read paths.

## References

- [did:btcr2 specification, Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html): [Process Sidecar Data](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-sidecar-data), [Find Beacon Signals](https://dcdpr.github.io/did-btcr2/operations/resolve.html#find-beacon-signals), [Process CAS Beacon](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-cas-beacon), and [Process SMT Beacon](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-smt-beacon).
- [did:btcr2 specification, Errors](https://dcdpr.github.io/did-btcr2/errors.html): `MISSING_UPDATE_DATA` and `INVALID_SIGNAL_DATA`.
- [Specification pull request 390](https://github.com/dcdpr/did-btcr2/pull/390) and [specification issue 382](https://github.com/dcdpr/did-btcr2/issues/382).
- [RFC 4648](https://www.rfc-editor.org/rfc/rfc4648), Section 3.5: the pad bits.
- [ADR 014](014-canonicalization-functions-and-toJSON-convention.md): the strict decoder.
- [ADR 035](035-smt-proof-base64url-wire-format.md): the proof wire format and the hex key of `smtMap`.
- [ADR 041](041-cooperative-non-inclusion-signaling.md): CAS non-inclusion is absence.
- [ADR 110](110-resolution-metadata-and-did-resolution-error-codes.md): the resolution error codes.
- [ADR 120](120-smt-leaf-values-proof-bit-sequence-and-signal-results.md): the codes of the SMT beacon and of `provide()`.
