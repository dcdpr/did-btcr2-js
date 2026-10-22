# ADR 154: The JCS Serializer Sorts Every Object and Refuses NaN, Infinity, and a Lone Surrogate

- **Status:** Accepted
- **Date:** 2026-10-22
- **Packages:** `@did-btcr2/common` (MAJOR: `canonicalize` refuses a value with no JCS form and gives other text for an object with a data member named `toJSON`; the package no longer depends on `json-canonicalize`; the error type `PROOF_TRANSFORMATION_ERROR` is new); `@did-btcr2/method` (MINOR: the resolver, the updater, and `GenesisDocument.toGenesisBytes` refuse a value with no JCS form with the error of their step; the browser bundle holds the common package); `@did-btcr2/api` (MINOR: the api exports `CanonicalizationError` and `CryptosuiteError`, and its functions refuse a value with no JCS form through the lower packages; the browser bundle holds method and common); `@did-btcr2/cryptosuite` (PATCH: a document or proof options with no JCS form give a `CryptosuiteError`); `@did-btcr2/aggregation` (PATCH: the participant refuses its own update with no JCS form, and the HTTP envelope check and the CAS strategy catch the `CanonicalizationError`; the browser bundle holds the common package); `@did-btcr2/cli` (PATCH: the sidecar merge keys an entry with no JCS form by its JSON text); `@did-btcr2/keypair`, `@did-btcr2/bitcoin`, and `@did-btcr2/key-manager` (PATCH: dependency uptake)

## Context

### JSON Document Hashing uses JCS

The specification (Algorithms, JSON Document Hashing) has the step "Encode the document using JCS". Each hash of the method uses this algorithm. Examples are the genesis bytes of an EXTERNAL DID and the `sourceHash` and `targetHash` of an update. Other examples are the hash of a signed update or a CAS Announcement, and the lookup tables of the sidecar data. The BIP340 cryptosuite also applies JCS to the document and to the proof configuration.

RFC 8785 has these rules:

> JSON object properties MUST be sorted recursively, which means that JSON child Objects MUST have their properties sorted as well. (section 3.2.3)

> Property name strings to be sorted are formatted as arrays of UTF-16 [UNICODE] code units. (section 3.2.3)

> Note: Since invalid Unicode data like "lone surrogates" (e.g., U+DEAD) may lead to interoperability issues including broken signatures, occurrences of such data MUST cause a compliant JCS implementation to terminate with an appropriate error. (section 3.2.2.2)

> Note: Since Not a Number (NaN) and Infinity are not permitted in JSON, occurrences of NaN or Infinity MUST cause a compliant JCS implementation to terminate with an appropriate error. (section 3.2.2.3)

> Irrespective of the method used, the data to be serialized MUST be adapted for I-JSON [RFC7493] formatting (section 3.1)

The list after the last rule includes "JSON string data MUST be expressible as Unicode [UNICODE]." and "JSON number data MUST be expressible as IEEE 754 [IEEE754] double-precision values." The rules thus apply to parsed data and to data that a program makes.

### The old `canonicalize` did not apply four of these rules

`canonicalize` made a JSON copy with `JSON.parse(JSON.stringify(value))` (ADR 014). Then it gave the copy to `json-canonicalize` 1.2.0. The table shows the results:

| Input | Old result | RFC 8785 |
|---|---|---|
| `{"b":1,"toJSON":"x","a":2}` | `{"b":1,"toJSON":"x","a":2}` | `{"a":2,"b":1,"toJSON":"x"}` |
| `{"v":"\ud800"}` (a lone surrogate) | `{"v":"\ud800"}` | an error |
| `{"v":NaN}`, also `{"v":1e400}` from JSON text | `{"v":null}` | an error |
| `{"v":10n}` (a BigInt), or a cycle | a `TypeError` of `JSON.stringify` | no JSON data, so no JCS text |

The causes:

- The library writes each object with `object.toJSON != null` with `JSON.stringify`, which keeps the member order. The sample code of RFC 8785 Appendix A has the same branch. The JSON copy keeps a data member named `toJSON`, so the copy does not prevent the branch. A method named `toJSON` gave the correct text, because the copy step called it.
- `JSON.stringify` writes NaN, Infinity, and -Infinity as `null`, and the library does too. `JSON.parse` reads the text `1e400` as Infinity, so data from outside the program also got to this step.
- `JSON.stringify` writes a lone surrogate as its escape text and gives no error.

### The effect on the method

The hash of an object with a data member named `toJSON` depended on the member order of that object and of each object in it. Example: an EXTERNAL DID whose genesis document has a top-level data member named `toJSON`. A conformant producer hashes the sorted text. The old resolver gave `INVALID_DID` for that genesis document in another member order. It gave `INVALID_DID_UPDATE` for an update that adds a member, because the text of the patched document had the new member at the end.

For a value with no JCS form, each hash step hashed the `null` form or the escape text. Thus the library made, signed, and verified updates that a conformant implementation refuses. Examples are an update with NaN in a patch value, and a document with a lone surrogate.

The specification names no error type for a JCS failure. The open specification issue 385 asks which errors the resolver raises. This ADR does not depend on an answer to the issue. Each error type below comes from the merged text of the step that hashes the value.

## Decision

### 1. The common package writes JCS with its own serializer

`canonicalize` makes the JSON form of the value first. The JSON form is the result of `JSON.parse(JSON.stringify(value))`, as before. `JSON.stringify` calls each `toJSON` method, so a class instance and a plain object with the same content give the same text (ADR 014). A replacer function of `JSON.stringify` checks each value after its `toJSON` method, in input order. The check is necessary, because `JSON.stringify` writes NaN and Infinity as `null`.

Then the internal function `serializeJcs` writes the JSON form with the rules of RFC 8785 section 3.2:

- An object sorts its member names with the default sort of JavaScript, which compares UTF-16 code units (section 3.2.3). The function does not read `toJSON`, so a data member with that name sorts as each other member does.
- An array keeps the order of its items.
- A number gets the text of `JSON.stringify`, which applies the ECMAScript rules that section 3.2.2.3 names.
- A string gets the text of `JSON.stringify` after the lone surrogate check (section 3.2.2.2).

The common package no longer depends on `json-canonicalize`.

### 2. A value with no JCS form gives a `CanonicalizationError`

`canonicalize`, `canonicalHash`, and `canonicalHashBytes` throw a `CanonicalizationError` with one of these types:

| Type | Value |
|---|---|
| `NON_FINITE_NUMBER` | NaN, Infinity, or -Infinity. This includes a Number object, a number from a `toJSON` method, and a number that raw JSON text gives as Infinity. |
| `LONE_SURROGATE` | A string or a member name with a lone surrogate. A surrogate pair is correct data. |
| `NOT_JSON_DATA` | A BigInt (also a BigInt object), a cycle, or a top-level value with no JSON form, for example `undefined`. |

`data.path` gives the location of the value as an RFC 6901 JSON Pointer into the JSON form. For a member name with a lone surrogate, the location is the object that holds the name, and the message does not print the name. Each lone surrogate in the location shows as `\uXXXX` text, so an error message has no lone surrogate.

The checks run in two passes. The replacer checks the numbers, the BigInt values, and the cycles in input order. `serializeJcs` checks the strings, the member names, and the numbers of raw JSON text in sorted order. The first error stops the canonicalization.

An error from a `toJSON` method, a getter, a Proxy trap, or a `valueOf` method passes through unchanged. A Number object is a value with a `[[NumberData]]` internal slot, so a changed `Symbol.toStringTag` does not hide it.

`canonicalize` sets no limit on the depth of a value. A value with too many levels for the call stack gives the error of the JavaScript engine, a `RangeError` in V8.

### 3. The resolver gives the error of the step that hashes the value

| Step | Value with no JCS form | Error type |
|---|---|---|
| `Resolver.external` (also `NeedGenesisDocument`) | the genesis document | `INVALID_DID_DOCUMENT` |
| `Resolver.provide` for `NeedSignedUpdate` | the signed update | `INVALID_SIGNAL_DATA` |
| `Resolver.provide` for `NeedCASAnnouncement` | the CAS Announcement | `MISSING_UPDATE_DATA` |

Each error is a `ResolveError`. `data.cause` gives the type and the message of the `CanonicalizationError`.

- A genesis document with no hash cannot give genesis bytes or an initial DID document. DID Resolution defines `INVALID_DID_DOCUMENT` as "The DID document was malformed."
- For a retrieved update, the step "Process Beacon Signals" says: "The resolver MUST hash the update with the [JSON Document Hashing] algorithm. The resolver MUST compare the hash to `update_hash`. Raise an [`INVALID_SIGNAL_DATA`] error if the two hashes are not equal." An update with no hash has no hash that is equal to `update_hash`. Thus it gets the error of an update with another hash.
- For a CAS Announcement, the step "Process CAS Beacon" says: "The announcement is not available from [CAS] if the hash of the retrieved content is not equal to `map_update_hash`". It raises `MISSING_UPDATE_DATA` for an announcement that is not available. An announcement with no hash gets the same error.

The other errors of a toJSON method or a getter pass through unchanged.

### 4. The sidecar maps leave out an item with no JCS form

`Resolver.sidecarData` puts no update and no CAS Announcement with no JCS form into its maps. No signal can name such an item, because it has no hash. If a beacon signal needs an item that is not in a map, the resolver asks for it with a data need. The caller can then provide it, and decision 3 applies, or the resolution ends with `MISSING_UPDATE_DATA`.

The basis is the rule for unused sidecar data (Resolve): "[Sidecar Data] that the resolver did not use has no effect on the result." RFC 8785 section 5 says "If any of these steps fail, the operation in progress MUST be aborted." That rule applies "before acting upon received data" in a signature scheme. The resolver does not act upon an unused item, and an item that a signal needs still fails. ADR 146, decision 2, ignores a sidecar SMT proof whose `id` does not decode for the same reason.

The CAS map keeps the JSON form of each announcement, as before (ADR 146, decision 5).

### 5. The write and create paths refuse a value with no JCS form

- `Updater.construct` and `Updater.sign` refuse a source document with no JCS form with an `UpdateError` of type `INVALID_DID_UPDATE`, `data.field` `sourceDocument`. The specification defines `INVALID_DID_UPDATE` as "An error was found when creating or applying a [BTCR2 Update]."
- `Updater.construct` also refuses a patch with no JCS form, with the message `Invalid patch: ...`. `JSONPatch.apply` works on a JSON copy of the operations, which writes NaN as `null`. Thus the target document can have a hash while the patch has none. The check runs after `JSONPatch.apply`, so a patch that is not an array keeps the error of `JSONPatch.apply`.
- `Updater.sign` gets these refusals through its check of the unsigned update (ADR 147, decision 7). An extra member with no JCS form gives the error of the cryptosuite in `data.cause` (decision 6).
- `GenesisDocument.toGenesisBytes` throws a `DidDocumentError` of type `INVALID_DID_DOCUMENT`. Thus the api `createExternalFromDocument` and the cli `create -t x --document` refuse the document.
- `Identifier.validate` reports a failed `genesisDocument` check with the message `Invalid genesis document: ...`. It does not throw, as for each other check.
- The set check of the DID Core rules (`itemKey`) gives no key for a map item with no JCS form. Thus the check compares no such item. The hash step of the operation then refuses the document with the error of that step.
- The `broadcastSignal` methods of the three beacons document the `CanonicalizationError`. They hash the signed update, and `Updater.sign` refuses such an update before this step.

### 6. The cryptosuite gives a `CryptosuiteError`

- `BIP340Cryptosuite.transformDocument` throws a `CryptosuiteError` of type `PROOF_TRANSFORMATION_ERROR` for a document with no JCS form. VC Data Integrity defines this type as "An error was encountered during the transformation process." The common package adds the member `PROOF_TRANSFORMATION_ERROR` to `MethodErrorCode`.
- `BIP340Cryptosuite.proofConfiguration` throws `PROOF_GENERATION_ERROR` for proof options with no JCS form. Steps 2 and 3 of "Proof Configuration (bip340-jcs-2025)" give this type for the other failures of the algorithm. Step 4, the JCS step, names no type.
- `createProof` and `verifyProof` thus throw for such data. `createProof` checks the proof options first, and the options get the `@context` of the document. `data.cause` gives the type and the message of the `CanonicalizationError`.
- `verifyProof` gives an error, not a result with `verified: false`. VC Data Integrity (section 3) says that `verifyProof` "produces a cryptosuite verification result or an error", and "If an error is produced, the verification process failed to complete." The BIP340 cryptosuite says: "Conforming processors MUST produce errors when non-conforming documents are consumed."

### 7. The aggregation package refuses or catches a value with no JCS form

- `AggregationParticipant.submitUpdate` refuses an own update with no JCS form with an `AggregationParticipantError` of type `UPDATE_MALFORMED`. The member can then submit another update. The service gives the same type for an update that it cannot canonicalize ("Update could not be canonicalized"). Without this refusal, the member finds the failure only when it validates the aggregated data, and the cohort waits.
- The CAS strategy derives no signal from a CAS Announcement with no JCS form. Thus the validation does not match, and the member does not approve the data. The SMT strategy already gave no signal for data that it cannot read.
- `verifyEnvelope` refuses an envelope with no JCS form with an `HttpTransportError` of type `ENVELOPE_MALFORMED`. Its JSDoc says that it throws "on any failure", and each of its five callers catches the error. `signEnvelope` documents the `CanonicalizationError` for a message with no JCS form.

### 8. The api exports the two error classes

The api exports `CanonicalizationError` and `CryptosuiteError`, because a `@throws` tag of the facade names them (ADR 132, item 4). The `@throws` tags of `hashDocument` and `CasApi.publish` name `CanonicalizationError`. The tags of 7 functions of the crypto sub-facade name `CryptosuiteError`. The JSDoc of `getInitialDocument`, `createExternalFromDocument`, and `constructUpdate` names the new refusal. `CasApi.publish` publishes nothing for an object with no JCS form.

### 9. The cli keeps one copy of an entry with no JCS form

The merge of sidecar data keys each entry by its canonical hash, so two entries with the same hash are one entry. An entry with no JCS form has no hash. Its key is `json:` and its JSON text, so the merge keeps one copy and does not throw. If an entry has no key, it doubles at each write, because each update writes the record again. The resolver does not use such an entry (decision 4).

### 10. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| Sort an object with a data member named `toJSON`. | RFC 8785 section 3.2.3: "JSON object properties MUST be sorted recursively". | Conforms. A member named `toJSON` is a property of a JSON object. |
| Keep the JSON copy before JCS, so a `toJSON` method gives the JSON form. | BIP340 cryptosuite, Transformation (bip340-jcs-2025), step 2: JCS applies "to a JSON serialization of the `unsecuredDocument`". | Conforms. The JSON serialization of a class instance is the output of its `toJSON` method. |
| Refuse NaN, Infinity, and -Infinity, also in a Number object and in raw JSON text. | RFC 8785 section 3.2.2.3: "occurrences of NaN or Infinity MUST cause a compliant JCS implementation to terminate with an appropriate error." | Conforms. |
| Refuse a lone surrogate in a string or a member name. | RFC 8785 section 3.2.2.2: "occurrences of such data MUST cause a compliant JCS implementation to terminate with an appropriate error." | Conforms. |
| Refuse a BigInt, a cycle, and a top-level value with no JSON form. | RFC 8785 section 3.1: "JSON number data MUST be expressible as IEEE 754 [IEEE754] double-precision values." | Conforms. These values have no I-JSON form. |
| Set no depth limit. | RFC 8785 and the specification set no depth limit. | Conforms. The engine error passes through. |
| Genesis document with no JCS form: `INVALID_DID_DOCUMENT`. | DID Resolution, Errors: "The DID document was malformed." | Conforms. The document gives no genesis bytes and no initial DID document. |
| Provided signed update: `INVALID_SIGNAL_DATA`. | Process Beacon Signals: "Raise an [`INVALID_SIGNAL_DATA`] error if the two hashes are not equal." | Conforms. No hash is equal to `update_hash`. |
| Provided CAS Announcement: `MISSING_UPDATE_DATA`. | Process CAS Beacon: "The announcement is not available from [CAS] if the hash of the retrieved content is not equal to `map_update_hash`". | Conforms. The announcement is not available, so the step raises `MISSING_UPDATE_DATA`. |
| Leave an unused sidecar item out of the maps. | Resolve: "[Sidecar Data] that the resolver did not use has no effect on the result." | Conforms. RFC 8785 section 5 applies "before acting upon received data", and an item that a signal needs still fails. |
| Write path: `INVALID_DID_UPDATE`. | Errors: "An error was found when creating or applying a [BTCR2 Update]." | Conforms. |
| `transformDocument`: `PROOF_TRANSFORMATION_ERROR`. | VC Data Integrity, Processing Errors: "An error was encountered during the transformation process." | Conforms. |
| `proofConfiguration`: `PROOF_GENERATION_ERROR`. | Proof Configuration (bip340-jcs-2025), step 3: "an error MUST be raised and SHOULD convey an error type of PROOF_GENERATION_ERROR." Step 2 gives the same type. | Conforms. Step 4 names no type, and the other steps of the algorithm use this type. |
| `verifyProof` gives an error, not `verified: false`. | VC Data Integrity, section 3: "If an error is produced, the verification process failed to complete." | Conforms. The verification cannot complete with no hash. |
| The participant refuses its own update with no JCS form at `submitUpdate`. | RFC 8785 section 3.2.2.2: "terminate with an appropriate error". | Conforms. The specification names no aggregation step for the refusal. The first JCS step of the member gives the error. |
| The cli keys an entry with no JCS form by its JSON text. | Resolve: "[Sidecar Data] that the resolver did not use has no effect on the result." | Conforms. The resolver ignores the entry, and the cli keeps one copy of it. |

## Alternatives

- **Keep `json-canonicalize`, and check the value before the call.** Rejected. A check does not remove the `toJSON` branch of the library, so an object with a data member named `toJSON` still keeps its member order.
- **Use another JCS library.** Rejected. The sample code of RFC 8785 Appendix A has the same `toJSON` branch, and a library can copy it. The own serializer has about 220 lines with its JSDoc, and the canonicalization step needs no dependency other than `@noble/hashes` and `@scure/base`.
- **Remove the JSON copy, and serialize a class instance directly.** Rejected. ADR 014 makes `toJSON` the serialization contract of each class, and the BIP340 cryptosuite applies JCS to "a JSON serialization" of the document.
- **Give `INVALID_DID_UPDATE` for both provided items.** Rejected. The shape checks of `Resolver.provide` use `INVALID_DID_UPDATE` for each kind of data need, also for a genesis document, so they are no precedent. The text of each step names its own error type (decision 3).
- **Give `INTERNAL_ERROR` for a value with no JCS form.** Rejected. DID Resolution defines `INTERNAL_ERROR` as "An unexpected error occured during DID Resolution or DID URL dereferencing." The word "occured" is the spelling of the source. A value with no JCS form is an error of the input, and each step has a type for it.
- **Stop the resolution with `INVALID_OPTIONS` for a sidecar item with no JCS form.** Rejected. An unused item has no effect on the result (decision 4).
- **Let `verifyProof` throw the `CanonicalizationError` of the common package.** Rejected. VC Data Integrity defines `PROOF_TRANSFORMATION_ERROR` for this failure, and the cryptosuite already raises `CryptosuiteError` for its other failures.
- **Give `verified: false` from `verifyProof`.** Rejected. A verification that cannot hash the document does not complete, and VC Data Integrity then gives an error (decision 6).
- **Give `PROOF_TRANSFORMATION_ERROR` for proof options with no JCS form.** Rejected. "Proof Configuration" gives `PROOF_GENERATION_ERROR` for its other failures, and the transformation step applies only to the document.
- **Refuse an own update with no JCS form at the distribution of the aggregated data.** Rejected. The member then sends no rejection, and the cohort waits. The refusal at `submitUpdate` lets the member submit another update.
- **Do not compare an entry with no JCS form in the cli merge.** Rejected. Each update writes the record again, so such an entry doubles at each write.

## Consequences

- The common package gets a MAJOR release. A caller that gives NaN, Infinity, a lone surrogate, a BigInt, or a cycle to `canonicalize` gets a `CanonicalizationError`. Before, the call gave text or a `TypeError`.
- The hash of an object with a data member named `toJSON` changes: js now gives the hash of RFC 8785. A hash or a DID that js made from such data before this change does not match now. No user data exists yet. No test vector and no example of the specification holds such a member, a lone surrogate, or a non-finite number.
- An implementation that copies the `toJSON` branch of RFC 8785 Appendix A gives another hash for such data. The next vector pass adds a positive EXTERNAL vector whose genesis document has a top-level `toJSON` member, and a negative vector for a lone surrogate. Each negative vector needs a failure rule id.
- Each valid value with no data member named `toJSON` gives the same text as before. A probe found 0 differences over the JSON files of the vectors and the test data, the 14 specification examples, and random values.
- The test vectors do not change. `verify-scenarios` gives the same PASS or FAIL for each of the 289 resolve cases as the last release. The example tool of the specification gives `14 files match`.
- `canonicalize` is slower. On Node 24, a DID document with 1 method takes 50 µs (before: 4 µs). A document with 2000 methods takes 14.6 ms (before: 3.1 ms). Most of the time goes to the two `valueOf` probes of the replacer. Each probe throws one `TypeError` for each plain object and each array.
- A later answer to the specification issue 385 can change an error type of decision 3.

**Superseded.**

- ADR 014, the decision "JCS round-trip fix": the `jcsa(plain)` step and the `json-canonicalize` dependency. Decision 1 of this ADR replaces them with the own serializer.

**Unchanged.**

- ADR 014: the standalone canonicalization functions, the `toJSON` convention, and the `base64urlnopad` default. The JSON copy before JCS stays. Decision 1 of this ADR adds a check of each value to the copy step.
- ADR 146, decision 2: `Resolver.sidecarData` ignores a sidecar SMT proof whose `id` does not decode. Decision 4 of this ADR adds the same rule for an update or a CAS Announcement with no JCS form.
- ADR 146, decision 5: the CAS map keeps the JSON form of each announcement.
- ADR 147, decision 7: `Updater.sign` makes six checks of the unsigned update, in the same order. Decision 5 of this ADR adds the JCS form of the source document to check 4.
- ADR 132, item 4: the api exports each error class that a `@throws` tag of the facade names. Decision 8 of this ADR applies it.

## Implementation

- `packages/common/src/canonicalization.ts`: `jsonForm` (the JSON form with a replacer check), `serializeJcs` (the RFC 8785 writer), the helpers of the errors and the path, and the JSDoc of `canonicalize`, `canonicalHash`, and `canonicalHashBytes`.
- `packages/common/src/errors.ts`: the member `PROOF_TRANSFORMATION_ERROR` and its named export.
- `packages/common/package.json`, `pnpm-lock.yaml`: the common package no longer depends on `json-canonicalize`.
- `packages/method/src/core/resolver.ts`: the wraps in `Resolver.external` and in `Resolver.provide` for two data needs, and `sidecarItemHash` for `Resolver.sidecarData`.
- `packages/method/src/core/updater.ts`: `sourceHashOf`, and the check of the patch in `Updater.construct`.
- `packages/method/src/utils/did-document.ts`: the wrap in `GenesisDocument.toGenesisBytes`.
- `packages/method/src/core/identifier.ts`: the `genesisDocument` check of `Identifier.validate`.
- `packages/method/src/utils/did-core-conformance.ts`: `itemKey` gives no key for a map item with no JCS form.
- `packages/method/src/core/beacon/singleton-beacon.ts`, `cas-beacon.ts`, `smt-beacon.ts`: the `@throws` tags of `broadcastSignal`.
- `packages/cryptosuite/src/cryptosuite/index.ts`: the wraps in `transformDocument` and `proofConfiguration`, and the JSDoc; `interface.ts` and `data-integrity-proof/index.ts`: the JSDoc.
- `packages/aggregation/src/participant/participant.ts`: the refusal in `submitUpdate`; `src/core/beacon-strategy.ts`: the CAS `deriveSignal`; `src/core/transport/http/envelope.ts`: the wrap in `verifyEnvelope` and the JSDoc of `signEnvelope`.
- `packages/api/src/index.ts`: the two exports; `src/method.ts`, `src/cas.ts`, `src/crypto.ts`: the JSDoc.
- `packages/cli/src/identifier-records.ts`: `entryKey` for the merge of sidecar data.
- Tests: `packages/common/tests/canonicalization.spec.ts`, `packages/method/tests/resolver.spec.ts`, `updater.spec.ts`, `did-document.spec.ts`, `validate-identifier.spec.ts`, `did-core-conformance.spec.ts`, `packages/cryptosuite/tests/cryptosuite.spec.ts`, `packages/aggregation/tests/aggregation-signal-binding.spec.ts`, `aggregation-http-envelope.spec.ts`, `packages/api/tests/cas-api.spec.ts`, `did-btcr2-api.spec.ts`, `did-method-api-offline-steps.spec.ts`, `genesis.spec.ts`, `index-exports.spec.ts`, and `packages/cli/tests/identifier-records.spec.ts`.
- Docs: `packages/common/README.md`, `docs/architecture/overview.md`, `packages/method/README.md`, `packages/method/docs/aggregation.md`, `packages/cryptosuite/README.md`, `packages/api/README.md`, and `packages/cli/docs/create.md`, `identifier.md`, `resolve.md`.

## References

- [did:btcr2 specification, JSON Document Hashing](https://dcdpr.github.io/did-btcr2/algorithms.html#json-document-hashing), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), and [Errors](https://dcdpr.github.io/did-btcr2/errors.html).
- [RFC 8785, JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785), sections 3.1, 3.2.2.2, 3.2.2.3, 3.2.3, 5, and Appendix A.
- [RFC 6901, JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901).
- [DID Resolution v1.0, Errors](https://www.w3.org/TR/did-resolution-1.0/#errors).
- [VC Data Integrity v1.0](https://www.w3.org/TR/vc-data-integrity/), section 3 and Processing Errors, and the [BIP340 Data Integrity cryptosuite](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/).
- [Specification issue 385](https://github.com/dcdpr/did-btcr2/issues/385): which errors the resolver raises (open).
- [ADR 014](014-canonicalization-functions-and-toJSON-convention.md): canonicalization functions and the `toJSON` convention.
- [ADR 132](132-the-api-exports-only-its-facade-and-a-sub-facade-function-does-each-crud-step.md), [ADR 146](146-the-resolver-ignores-a-sidecar-smt-proof-whose-id-does-not-decode-and-a-cas-announcement-entry-must-decode-to-a-hash.md), and [ADR 147](147-only-the-method-that-signs-an-update-must-be-a-bip340-multikey-and-both-update-paths-check-that-method.md).
