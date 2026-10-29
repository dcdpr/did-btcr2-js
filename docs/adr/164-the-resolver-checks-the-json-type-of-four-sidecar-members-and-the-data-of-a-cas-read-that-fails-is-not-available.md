# ADR 164: The Resolver Checks the JSON Type of Four Sidecar Members, and the Data of a CAS Read That Fails Is Not Available

- **Status:** Accepted
- **Date:** 2026-10-29
- **Packages:** `@did-btcr2/method` (MINOR: `DidBtcr2.resolve` and `Resolver.sidecarData` refuse a sidecar member of the wrong JSON type with `INVALID_OPTIONS`); `@did-btcr2/api` (MINOR: `CasApi.retrieve` gives a `ResolveError` of type `MISSING_UPDATE_DATA` for a read that times out, for an executor that throws or rejects, and for bytes that are not UTF-8; the resolve error types change for these reads; the browser bundle holds the method package); `@did-btcr2/cli` (PATCH: the record merge and the flag merge pass a malformed value to the api as it is; the docs; dependency uptake through api)

## Context

### The specification

The data structure "Sidecar Data" says: "The [Sidecar Data] contains optional properties:". It lists these members:

- `@context`: "The context string".
- `genesisDocument`: "OPTIONAL [Genesis Document]".
- `updates`: "OPTIONAL array of [BTCR2 Signed Updates][BTCR2 Signed Update]".
- `casUpdates`: "OPTIONAL array of [CAS Announcements][CAS Announcement (data structure)]".
- `smtProofs`: "OPTIONAL array of [SMT Proofs][SMT Proof (data structure)]".

The Resolve operation says: "[Sidecar Data] that the resolver did not use has no effect on the result." The conformance section says: "Implementations MUST be conformant to all normative statements in Decentralized Identifiers v1.1". The sentence continues: "and DID Resolution v1". DID Resolution v1, section 4.4, step 4, says: "Determine whether the input DID resolution options are valid. If not, the DID resolver MUST return the following result:". The result has an error object of type `INVALID_OPTIONS`.

About data from the CAS, the Resolve operation says:

- For the genesis document: "Raise a [`NOT_FOUND`] error if the [Genesis Document] cannot be retrieved."
- For a signed update: "Raise a [`MISSING_UPDATE_DATA`] error if the update is not available from either source."
- For a CAS Announcement: "Raise a [`MISSING_UPDATE_DATA`] error if the announcement is not in `cas_lookup_table` and not available from [CAS]."

BTCR2 Update Data Distribution says: "If any SHA-256 hash doesn't have a corresponding file, the resolution fails." DID Resolution v1, section 4.4, also says: "If the DID resolver encounters any unexpected errors during the execution of the DID Resolution algorithm, it MUST return the following result:". That result has an error object of type `INTERNAL_ERROR`.

RFC 8259, section 8.1, says: "JSON text exchanged between systems that are not part of a closed ecosystem MUST be encoded using UTF-8".

### A sidecar member of the wrong JSON type

`DidBtcr2.resolve` refused a `sidecar` that is not an object (ADR 157, decision 3, check 4). It did not check the members:

| Resolution options | Result |
|---|---|
| `{ sidecar: { updates: 5 } }` | The resolution continues with no error. The resolver does not use the value. |
| `{ sidecar: { updates: { length: 1 } } }` | A `TypeError` from `Resolver.sidecarData`. `tryResolveDid` gives `INTERNAL_ERROR`. |
| `{ sidecar: { '@context': 5 } }` | The resolution continues with no error. |

`Resolver.sidecarData` is public. A direct call with the same values gave the same results.

### A CAS read that times out or fails

`CasApi.retrieve` limits each read with `timeoutMs` (ADR 076). A read that timed out threw a plain `Error` with the message `CAS operation timed out after <n>ms`. A custom executor that rejected gave its own error. Both errors had no DID Resolution type, so `tryResolveDid` gave `INTERNAL_ERROR`.

The JSDoc of `CasExecutor.retrieve` says "Returns null if not found." The three built-in executors catch each error of a read and also return `null`. Thus a gateway that answers with HTTP 503 gave `NOT_FOUND` for a genesis document. A gateway that does not answer gave `INTERNAL_ERROR`. The two failures are of one kind, but they had two error types.

### Bytes that are not UTF-8

`CasApi.retrieve` decoded the bytes with a `TextDecoder` that replaces each invalid byte sequence with U+FFFD. For example, the bytes of `{"a":"<0xFF>"}` parsed to `{"a":"�"}`. The raw hash matched, so `CasApi.retrieve` returned the value. The resolver then hashed the decoded value, and that hash did not match the expected hash. The result was `INVALID_DID` for a genesis document and `INVALID_SIGNAL_DATA` for a signed update. ADR 110 says that content that is not JSON is not available: `MISSING_UPDATE_DATA`.

### The cli merges changed a malformed value

For an identifier with a record, the cli merges the sidecar data of the record into the resolution options (ADR 133). The merge read each value of the flags as the correct type:

| `-r` value, for an identifier with a record | Result |
|---|---|
| `{"sidecar":{"updates":5}}` | `TypeError: (a ?? []) is not iterable` |
| `{"sidecar":5}` | The resolution continues with the sidecar data of the record. With no record, the api refuses the value with `INVALID_OPTIONS`. |
| `[1]` | The spread makes the option name `0`. The api gives `FEATURE_NOT_SUPPORTED`. |

The merge also keyed each entry by its canonical hash. An entry that is not an object, for example `null` in `updates`, made `identifier add --sidecar` throw.

`--min-conf` and `--genesis-document` add their value to the options of `-r` or `-p`. The same problem occurred there, also with no record:

| Flags | Result |
|---|---|
| `-r 'null' --min-conf 1` | The options become `{ minConf: 1 }`, and the resolution continues. |
| `-r '{"sidecar":5}' --genesis-document g.json` | The sidecar becomes `{ genesisDocument }`, and the resolution continues. |
| `-r '[1]' --min-conf 1` | The api gives `FEATURE_NOT_SUPPORTED` for the option name `0`. |

## Decision

### 1. The resolver checks the JSON type of four sidecar members

`checkResolutionOptions` calls the internal function `checkSidecar` for a `sidecar` value other than `undefined`. `checkSidecar` does these checks in this order. Each failure is a `ResolveError` of type `INVALID_OPTIONS`.

1. The value must be an object that is not `null` and not an array (ADR 157, decision 3, check 4).
2. `updates`, `casUpdates`, and `smtProofs` must be arrays.
3. `@context` must be a string.

A member with the value `undefined` is absent. A value of another JSON type, also `null`, fails. The message has the form of ADR 156, for example `Invalid resolution option sidecar.updates: expected an array, got 5.` The `data` is `{ 'sidecar.updates': 5 }`.

`checkSidecar` does not check these values:

- `genesisDocument`. The resolver hashes each value other than `undefined` (ADR 160, decision 5).
- An item of an array. The resolver ignores an item that it cannot use (ADR 146, decision 2; ADR 154, decision 4; ADR 160, decision 2).
- A member with another name, and the value of the `@context` string. The resolver does not use them.

The check runs at step 4, after the check of the option names (ADR 157, decision 3). An unknown option name still gives `FEATURE_NOT_SUPPORTED` before a member error.

### 2. `Resolver.sidecarData` does the same check

`Resolver.sidecarData` calls `checkSidecar` first. A direct caller then gets `INVALID_OPTIONS`, not a `TypeError`. After the check, each array member is an array or `undefined`.

### 3. The data of a CAS read that times out or fails is not available

`CasApi.retrieve` catches each failure of the executor read. The failures are the timeout of `timeoutMs`, a rejection of the executor, and a synchronous throw of the executor. Each failure gives a `ResolveError` of type `MISSING_UPDATE_DATA`.

The message is `CAS content for <hash> cannot be retrieved: <cause>`. `<cause>` is the message of an `Error` cause, else the primitive text of the value (ADR 156). For an object that is not an `Error`, and for a function, the message is `CAS content for <hash> cannot be retrieved.` The `data` is `{ hash, cause }`.

The resolve path of the api does not change. For the genesis document, it changes the `MISSING_UPDATE_DATA` error of `CasApi.retrieve` to a `NOT_FOUND` error, with the original error as its cause. For a signed update and a CAS Announcement, the type stays `MISSING_UPDATE_DATA`. Thus a read that times out gives the same type as a read that finds no content. The message shows which of the two failures occurred.

`CasApi.publish` keeps the plain timeout `Error`. A write is not a resolution.

### 4. Content that is not UTF-8 is not JSON

`CasApi.retrieve` decodes the bytes with `new TextDecoder('utf-8', { fatal: true })`. A byte sequence that is not UTF-8 makes the decoder throw. The content then gives `CAS content for <hash> is not JSON.` with the type `MISSING_UPDATE_DATA` (ADR 110). The genesis document path gives `NOT_FOUND`.

### 5. The cli record merge passes a malformed value to the api

`withRecordSidecar` adds the sidecar data of a record only to options that are absent or an object. The `sidecar` of the options must also be absent or an object. Else it returns the options unchanged. The api then refuses them with `INVALID_OPTIONS`, as for an identifier with no record. `withRecordSidecar` keeps the other members of the flags sidecar, for example `@context`.

`mergeSidecar` has these rules:

- A `genesisDocument` of the flags wins if it is not `undefined`, also if it is `null`. The resolver hashes that value (ADR 160, decision 5).
- An array member of the flags with a value that is not an array goes into the result as it is. The api refuses it (decision 1).
- An entry that is not an object (`null`, a string, a number, a boolean) has no hash. Its key is `json:` and its JSON text, as for an entry with no JCS form (ADR 154, decision 9).
- The result holds only `genesisDocument` and the three arrays. A record also holds only these members.

### 6. The cli flag merge passes a malformed value to the api

`readResolutionOptions` reads the `--genesis-document` file first. Then it adds the `--min-conf` value and the genesis document only to options that are absent or an object. It adds the genesis document only to a `sidecar` that is absent or an object. Else it does not add the value, and the api refuses the options.

A bad genesis document file still fails before the api sees the options. The documented check order of `resolve` does not change.

### 7. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| A sidecar member of the wrong JSON type gives `INVALID_OPTIONS` (decision 1). | DID Resolution v1, section 4.4, step 4: "Determine whether the input DID resolution options are valid. If not, the DID resolver MUST return the following result:". Sidecar Data: "OPTIONAL array of [BTCR2 Signed Updates]". | Conforms. The data structure gives each member a type. A value of another type is not a valid option. |
| An unknown member and the `@context` value have no effect (decision 1). | Resolve: "[Sidecar Data] that the resolver did not use has no effect on the result." | Conforms. The resolver does not use them. |
| The check does not read an item of an array (decision 1). | Resolve: "the resolver MUST ignore a proof in `sidecar.smtProofs` whose `id` has non-zero pad bits". | Conforms. The specification ignores an item that the resolver cannot use. It does not refuse the options. |
| `genesisDocument` gets no type check (decision 1). | Resolve: "If `genesis_bytes` is a SHA-256 hash, hash `sidecar.genesisDocument` with the [JSON Document Hashing] algorithm." | Conforms. The resolver hashes the value, and the hash check gives the error type (ADR 160, decision 5). |
| `Resolver.sidecarData` does the check (decision 2). | DID Resolution v1, section 4.4, step 4. | Conforms. One input gives one result through `DidBtcr2.resolve` and through a direct call. |
| A read that times out or fails gives `MISSING_UPDATE_DATA`, and `NOT_FOUND` for the genesis document (decision 3). | Resolve: "Raise a [`NOT_FOUND`] error if the [Genesis Document] cannot be retrieved." Resolve: "Raise a [`MISSING_UPDATE_DATA`] error if the update is not available from either source." | Conforms. A read that fails does not retrieve the data. The built-in executors already give these types for each failure. |
| A read that times out is not an unexpected error (decision 3). | DID Resolution v1, section 4.4: "If the DID resolver encounters any unexpected errors during the execution of the DID Resolution algorithm, it MUST return the following result:". | Conforms. `timeoutMs` makes a timeout an expected result of a read. |
| Bytes that are not UTF-8 are not JSON (decision 4). | RFC 8259, section 8.1: "JSON text exchanged between systems that are not part of a closed ecosystem MUST be encoded using UTF-8". | Conforms. The specification has no text about the decode of the bytes. ADR 110 makes content that is not JSON not available. |
| A `genesisDocument` of `null` in the flags wins the merge (decision 5). | Resolve: "If `genesis_bytes` is a SHA-256 hash, hash `sidecar.genesisDocument` with the [JSON Document Hashing] algorithm." | Conforms. The flags give the value, and the resolver hashes it. |
| The cli merges pass a malformed value to the api (decisions 5 and 6). | The specification has no text about the cli. DID Resolution v1, section 4.4, step 4, through the api. | Conforms. ADR 157 puts the option check in `DidBtcr2.resolve`, and the cli gets the check through the api. |

## Alternatives

**Require the btcr2 context string in `@context`, and refuse a member with another name.** Rejected. The resolver does not use these values, and "[Sidecar Data] that the resolver did not use has no effect on the result."

**Also check the shape of each item of an array.** Rejected. The specification ignores an SMT proof that the resolver cannot use, and ADRs 146, 154, and 160 apply the same rule to the other items. A shape check refuses options that the specification accepts.

**Refuse a `genesisDocument` that is not an object with `INVALID_OPTIONS`.** Rejected. The resolver hashes each provided value (ADR 160, decision 5). One value then has two error types: `INVALID_OPTIONS` in the sidecar, and `INVALID_DID` or `INVALID_DID_DOCUMENT` through `provide`.

**A CAS read that fails gives `INTERNAL_ERROR` on each path.** Rejected. The built-in executors must then throw for each failure that is not "not found". The specification texts "cannot be retrieved" and "not available from either source" then get another error type. The main reason for this alternative is a possible reply to question 2 of specification issue 385.

**Wait for a reply to question 2 of specification issue 385.** Rejected. Until that reply, a gateway that does not answer gives `INTERNAL_ERROR`, and a gateway with HTTP 503 gives `NOT_FOUND`.

**The cli checks the sidecar as `readSidecarFile` checks a `--sidecar` file, and refuses with `CLIError`.** Rejected. One option then has two checks and two error types. ADR 157 puts the option check in `DidBtcr2.resolve`, and the cli gets the check through the api.

## Consequences

- The method and api packages get a MINOR release. The cli gets a PATCH release: its new refusals come from the option check of the api, as in ADR 157. The aggregation package gets no release: `method` is only a devDependency of aggregation.
- A call with `{ sidecar: { updates: 5 } }` resolved before. It now fails with `INVALID_OPTIONS`. A `TypeError` of `Resolver.sidecarData` is now `INVALID_OPTIONS`.
- `CasApi.retrieve` now throws a `ResolveError` for a timeout and for a rejection of the executor. It threw a plain `Error` or the error of the executor. `data.cause` holds the original error. `DidMethodError` does not set `.cause`, so the root cause message of `tryResolveDid` is the new message.
- `tryResolveDid` gives `NOT_FOUND` or `MISSING_UPDATE_DATA` for a CAS read that times out or fails. It gave `INTERNAL_ERROR` for a timeout and for a custom executor that throws or rejects. `message sign` and `message verify` of the cli put `result.error` in the `CLIError` type, so their error type changes the same way.
- CAS content that is not UTF-8 gives `MISSING_UPDATE_DATA` or `NOT_FOUND`. It gave `INVALID_SIGNAL_DATA` for a signed update and `INVALID_DID` for a genesis document. A CAS Announcement already gave `MISSING_UPDATE_DATA`. No content changes from accepted to refused.
- For an identifier with a record, `-r` and `-p` values of the wrong type now fail with `INVALID_OPTIONS`, as with no record. Some of these values resolved before.
- `--min-conf` and `--genesis-document` no longer change options or a `sidecar` that are not an object. Such options now fail with `INVALID_OPTIONS`, also for an identifier with no record. Some of them resolved before, for example `-r 'null' --min-conf 1`.

These residuals stay:

- The timeout of `CasApi` does not stop the read of the executor. The read stays open after the timeout. With the built-in gateway executor, a Node.js process, for example the cli, exits only after the read ends. In a test with `--cas-timeout 300` and a gateway that does not answer, the cli printed the error after 0.5 seconds. It exited after 7.6 seconds, when the gateway closed.
- Questions 2 and 6 of specification issue 385 are open. Question 2 asks about a CAS that cannot be reached. Question 6 asks which error each requirement with no named error raises. One of these requirements is a malformed `sidecar`, and the issue names `INVALID_OPTIONS` as the closest case. A later reply can change the error types of decisions 1 and 3.

**Unchanged.**

- ADR 023: the `CasExecutor` interface. `retrieve` returns `Uint8Array | null`. Decision 3 of this ADR adds the type of a read that fails.
- ADR 076: `cas.timeoutMs` keeps its default of 30000, and `0` disables the timeout. Decision 3 of this ADR adds the error type of a read that times out.
- ADR 110: `CasApi.retrieve` refuses content that does not hash to the address, is not JSON, or is not a JSON object, with `MISSING_UPDATE_DATA`. Decision 4 of this ADR adds bytes that are not UTF-8.
- ADR 133: the record merge. The sidecar data of the flags wins, and the arrays merge. Decision 5 of this ADR adds the rule for a malformed value.
- ADR 146, decision 2: the resolver ignores an item of `smtProofs` that it cannot use. Decision 1 of this ADR adds a member check that does not read an item.
- ADR 154, decision 9: the cli keys an entry with no JCS form by its JSON text. Decision 5 of this ADR adds an entry that is not an object.
- ADR 157, decision 3: the order of steps 3 and 4. Decision 1 of this ADR adds the member checks to step 4.
- ADR 160, decision 5: each `genesisDocument` value other than `undefined` is a provided value. Decision 5 of this ADR adds the same rule to the cli merge.

## Implementation

- `packages/method/src/core/resolution-options.ts`: `checkSidecar`; `checkResolutionOptions` calls it; JSDoc.
- `packages/method/src/core/resolver.ts`: `Resolver.sidecarData` calls `checkSidecar` first; JSDoc.
- `packages/method/src/core/types.ts`: the JSDoc of `Sidecar`.
- `packages/api/src/cas.ts`: the `try` around the executor read in `retrieve`; the fatal `TextDecoder`; JSDoc.
- `packages/api/src/method.ts`: the comment of the genesis document catch; the JSDoc of `resolve`.
- `packages/cli/src/identifier-records.ts`: `withRecordSidecar`, `mergeSidecar`, `union`, and `entryKey`.
- `packages/cli/src/resolution-options.ts`: `readResolutionOptions` adds a flag value only to an object; `isObject`.
- Docs: `packages/method/README.md`, `packages/api/README.md`, `packages/api/docs/DEMO.md`, `packages/cli/docs/resolve.md`, `packages/cli/docs/config-file.md`, `packages/cli/docs/DEMO.md`.
- Tests:
  - method: `resolution-options.spec.ts` (each member and each wrong value; the accepted forms; the order with an unknown option name), `resolver.spec.ts` (`Resolver.sidecarData` with a member of the wrong type).
  - api: `cas-api.spec.ts` (a timeout, a rejection, and a synchronous throw of the executor; bytes that are not UTF-8), `did-method-api.spec.ts` (`NOT_FOUND` and `MISSING_UPDATE_DATA` for a read that times out), `did-btcr2-api.spec.ts` (`tryResolveDid` for a read that times out, and for a member of the wrong type).
  - cli: `identifier-records.spec.ts` (the merge rules of decision 5), `cli.spec.ts` and `genesis-commands.spec.ts` (the flag merge of decision 6).

## References

- did:btcr2 specification: [Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html) (Sidecar Data), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [Errors](https://dcdpr.github.io/did-btcr2/errors.html), [BTCR2 Update Data Distribution](https://dcdpr.github.io/did-btcr2/update-data-distribution.html), [Conformance](https://dcdpr.github.io/did-btcr2/conformance.html).
- [DID Resolution v1](https://www.w3.org/TR/did-resolution/), sections 4.4 and 10.
- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259), section 8.1.
- Specification issue 385, "Which errors does resolve raise, and when?" (open).
- ADRs 023, 076, 110, 133, 146, 154, 156, 157, 160.
