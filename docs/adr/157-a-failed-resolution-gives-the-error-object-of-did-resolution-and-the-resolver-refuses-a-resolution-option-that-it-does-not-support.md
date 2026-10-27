# ADR 157: A Failed Resolution Gives the Error Object of DID Resolution, and the Resolver Refuses a Resolution Option That It Does Not Support

- **Status:** Accepted
- **Date:** 2026-10-27
- **Packages:** `@did-btcr2/common` (MINOR: the new error type `FEATURE_NOT_SUPPORTED`); `@did-btcr2/method` (MINOR: `DidBtcr2.resolve` refuses an unsupported resolution option and a resolution option value that is not valid; `ResolutionOptions` no longer extends the `@web5/dids` type; `Identifier.decode` checks the DID syntax before the method); `@did-btcr2/api` (MINOR: `raw.didResolutionMetadata.error` of `tryResolveDid` is the error object of DID Resolution v1; `DidResolutionResult` is an api type; the new type `ResolutionError`; `tryResolveDid` gives `INVALID_DID` for a DID that is not a string; the browser bundle holds the method package); `@did-btcr2/cli` (PATCH: `resolve`, `update`, and `deactivate` refuse an unsupported field of the resolution options; dependency uptake through api)

## Context

### A failed resolution gave a bare error code

The did:btcr2 specification says in the Conformance section: "Implementations MUST be conformant to all normative statements in Decentralized Identifiers v1.1". The sentence continues: "and DID Resolution v1". The Resolve operation says: "DID resolution is defined by DID Resolution v1".

DID Resolution v1 (Candidate Recommendation Draft, 26 October 2026), section 4.4, gives each failure of the algorithm in one form. Step 1 is an example: "didResolutionMetadata: error object with type set to https://www.w3.org/ns/did#INVALID_DID". Section 10 says: "Implementers SHOULD use [RFC9457] to encode the error data structure." It continues: "If [RFC9457] is used: The type value of the error object MUST be a URL."

The api gave a bare code and a message in place of the error object:

| Call | Before: `raw.didResolutionMetadata` | After: `raw.didResolutionMetadata` |
|---|---|---|
| `tryResolveDid('did:btcr2:')` | `{ error: 'INVALID_DID', errorMessage: 'Invalid method-specific id: did:btcr2:' }` | `{ error: { type: 'https://www.w3.org/ns/did#INVALID_DID', title: 'Invalid DID', detail: 'Invalid did: did:btcr2:' } }` |
| `tryResolveDid(did)` of a k1 DID with an update on the chain and no sidecar data | `{ error: 'MISSING_UPDATE_DATA', errorMessage: ... }` | `{ error: { type: 'https://dcdpr.github.io/did-btcr2/errors.html#missing_update_data', title: 'Missing update data', detail: ... } }` |
| `tryResolveDid(did, { versionId: 'x' })` | `{ error: 'INVALID_OPTIONS', errorMessage: ... }` | `{ error: { type: 'https://www.w3.org/ns/did#INVALID_OPTIONS', title: 'Invalid resolution options', detail: ... } }` |

The api also re-exported the `DidResolutionResult` type of `@web5/dids`. That type gives `didResolutionMetadata.error` the type `string`.

### The did:btcr2 errors have no type URL

The Errors section of the did:btcr2 specification defines four errors: `INVALID_DID_UPDATE`, `INVALID_SIGNAL_DATA`, `LATE_PUBLISHING`, and `MISSING_UPDATE_DATA`. Each error says which DID Resolution error type it refines, for example "Refines [`INVALID_DID_DOCUMENT`]." No error gives a URL.

DID Resolution v1, section 10, says: "A specification that defines an error type not defined in this section MUST define the URL to use as its type value, and MAY declare that it refines one of the error types defined in this section." Thus the did:btcr2 specification does not satisfy this MUST. An implementation still needs a URL for each of the four errors.

RFC 9457, section 3.1.1, says: "Consumers MUST use the "type" URI (after resolution, if necessary) as the problem type's primary identifier." Thus the type URL of a refined error type cannot identify a did:btcr2 error.

### The resolver ignored each unsupported option

`ResolutionOptions` extended the `DidResolutionOptions` type of `@web5/dids`. That type has the index signature `[key: string]: any`. `DidBtcr2.resolve` read five options and ignored each other member. DID Resolution v1, section 4.4, says:

- Step 3: "Determine whether the input DID resolution options are supported by the DID resolver that implements this algorithm. If not, the DID resolver MUST return the following result:", with the type `https://www.w3.org/ns/did#FEATURE_NOT_SUPPORTED`.
- Step 4: "Determine whether the input DID resolution options are valid. If not, the DID resolver MUST return the following result:", with the type `https://www.w3.org/ns/did#INVALID_OPTIONS`.

At the earlier code, `{ foo: 1 }`, `{ expandRelativeUrls: 'yes' }`, `{ maxDiscoveryRounds: '5' }`, and the options `[]` resolved with no error. The options `null` and the option `sidecar: null` gave a raw `TypeError`, and `tryResolveDid` reported `INTERNAL_ERROR`.

### The resolver did not expand relative DID URLs

DID Resolution v1, section 4.1, defines `expandRelativeUrls`: "A boolean flag which instructs a DID resolver to expand relative DID URLs in the DID document to absolute DID URLs conformant with DID URL Syntax." Step 6 of section 4.4 does the expansion if the option has the value `true`. The resolver did no expansion. An x1 genesis document with `authentication: ['#key-0']` resolved with `{ expandRelativeUrls: true }` and returned `'#key-0'`.

### `Identifier.decode` checked the method before the DID syntax

Step 1 of section 4.4 checks "the did rule of the DID Syntax" and gives `INVALID_DID`. Step 2 checks the DID method and gives `METHOD_NOT_SUPPORTED`. `Identifier.decode` split the identifier at each colon. It refused an identifier with more than three parts with `INVALID_DID`, then it checked the method:

| Identifier | Before | After |
|---|---|---|
| `did:example:123` | `METHOD_NOT_SUPPORTED` | `METHOD_NOT_SUPPORTED` |
| `did:example:a:b` | `INVALID_DID` | `METHOD_NOT_SUPPORTED` |
| `did:BTCR2:k1...` | `METHOD_NOT_SUPPORTED` | `INVALID_DID` |
| `did:ex%zz:1` | `METHOD_NOT_SUPPORTED` | `INVALID_DID` |

`did:example:a:b` is a valid DID: the method-specific id of DID Core v1.1, section 3.1, can hold a colon. `did:BTCR2:...` is not a valid DID: a method name holds only lowercase letters and digits.

The did:btcr2 specification and DID Resolution v1 disagree on the code for a valid DID of another method. The section "DID-BTCR2 Identifier Decoding" says: "Any errors encountered during this algorithm MUST raise an [`INVALID_DID`] error." It also says: "(I.e., the first 10 characters in the string MUST be exactly `"did:btcr2:"`.)" Step 2 of DID Resolution v1, section 4.4, gives `METHOD_NOT_SUPPORTED` for each DID of a method that the resolver does not support.

### `tryResolveDid` threw for a DID that is not a string

`tryResolveDid` called `assertString(did, 'did')` before its `try` block. Thus a DID that is not a string made the method throw. The method contract is a result object, not a throw.

## Decision

### 1. A failed resolution gives the error object of DID Resolution v1, section 10

The api builds the error object of RFC 9457 with three members:

- `type`: the URL of the error type.
- `title`: a short text for the error type, for example `Invalid DID`.
- `detail`: the root cause message (ADR 097).

The object has no `status` member. RFC 9457, section 3.1.2, says: "The "status" member, if present, is only advisory". DID Resolution v1 needs no HTTP status in a result that is not an HTTP response.

The error object goes into `raw.didResolutionMetadata.error` of `tryResolveDid`. A failure gives `didDocument: null` and an empty `didDocumentMetadata`, as each failure of section 4.4 says. The top-level `error` of `tryResolveDid` stays the code, for example `INVALID_DID`. The top-level `errorMessage` stays the root cause message. The code walk of `resolutionErrorCode` (ADR 110) now knows only 13 error types. Each other `DidMethodError` type gives `INTERNAL_ERROR`.

The api exports two new types. `ResolutionError` is the error object. `DidResolutionResult` is the result of `resolveDid` and of `raw`: `didDocument` is a `Btcr2DidDocument` or `null`. The api no longer re-exports the `DidResolutionResult` of `@web5/dids`.

### 2. Each error type has one URL

| Error type | `type` URL |
|---|---|
| The 9 error types of DID Resolution v1, section 10 | `https://www.w3.org/ns/did#<TYPE>`, for example `https://www.w3.org/ns/did#NOT_FOUND` |
| `INVALID_DID_UPDATE` | `https://dcdpr.github.io/did-btcr2/errors.html#invalid_did_update` |
| `INVALID_SIGNAL_DATA` | `https://dcdpr.github.io/did-btcr2/errors.html#invalid_signal_data` |
| `LATE_PUBLISHING` | `https://dcdpr.github.io/did-btcr2/errors.html#late_publishing` |
| `MISSING_UPDATE_DATA` | `https://dcdpr.github.io/did-btcr2/errors.html#missing_update_data` |

The four did:btcr2 URLs are the anchors of the errors on the published specification. The anchors are in the source of the Errors section, for example `{ #missing_update_data }`. Section 10 names the URL that each of its 9 error types uses. `FEATURE_NOT_SUPPORTED` is one of the 9.

### 3. `DidBtcr2.resolve` checks the options in the order of section 4.4

`DidBtcr2.resolve` decodes the DID (steps 1 and 2), then it checks the options (steps 3 and 4). It throws before it returns the `Resolver`, so the caller does no I/O for a refused request. The internal function `checkResolutionOptions` does these checks in this order:

1. The options must be an object. Options that are not an object, for example `null` or an array, give a `ResolveError` of type `INVALID_OPTIONS`. Section 4.1 makes the options a metadata structure, a map.
2. Each option name must be one of `accept`, `expandRelativeUrls`, `noCache`, `versionId`, `versionTime`, `minConf`, `sidecar`, and `maxDiscoveryRounds`. Another name gives a `ResolveError` of type `FEATURE_NOT_SUPPORTED`. An option with the value `undefined` is absent.
3. `expandRelativeUrls: true` gives `FEATURE_NOT_SUPPORTED` (decision 4).
4. Each value must be valid. A wrong value of `accept`, `expandRelativeUrls`, `noCache`, `sidecar`, or `maxDiscoveryRounds` gives `INVALID_OPTIONS`. A `sidecar` must be an object, and a `maxDiscoveryRounds` must be a number.

The `Resolver` constructor still checks `versionId`, `versionTime`, and `minConf` (ADR 111, ADR 105).

`ResolutionOptions` no longer extends the `@web5/dids` type. It declares `accept`, `expandRelativeUrls`, and `noCache`. A TypeScript caller that gives another option name gets a compile error.

### 4. `expandRelativeUrls: true` gives `FEATURE_NOT_SUPPORTED`

The resolver does not expand relative DID URLs. Step 3 makes the refusal the conformant result for an option that the resolver does not support. `expandRelativeUrls: false` asks for no expansion, so the resolver accepts it. The resolver returns each relative DID URL of the DID document unchanged.

### 5. `accept` and `noCache` are supported, and their values are checked

Section 4.1 says that the value of `accept` "MUST be expressed according to the Accept header value as defined in HTTP Semantics, Section 12.5.1." The resolver accepts a string that matches the `Accept` grammar of RFC 9110, section 12.5.1. Another value gives `INVALID_OPTIONS` (step 4). The resolver returns the DID document as a data structure, so the value has no effect.

Section 12.2 of DID Resolution v1 gives the values of `noCache` as `"false"` (the default value) and `"true"`. The section also says: "Resolvers that deny resolution without caching MUST respond with a FEATURE_NOT_SUPPORTED error". The resolver keeps no cache, so it does not deny such a request. It accepts `true`, `false`, `"true"`, and `"false"`. Another value gives `INVALID_OPTIONS`.

### 6. `Identifier.decode` checks the DID syntax first

`Identifier.decode` does these checks in this order:

1. The identifier must be a string. Another value gives `INVALID_DID`.
2. The identifier must match the `did` rule of DID Core v1.1, section 3.1. The check uses `isDid` of `src/utils/url-syntax.ts`. A failure gives `INVALID_DID`.
3. The method must be `btcr2`. Another method gives `METHOD_NOT_SUPPORTED`.
4. The checks of the did:btcr2 decoding algorithm follow. Each failure gives `INVALID_DID`.

This order follows steps 1 and 2 of DID Resolution v1, section 4.4. Each valid DID of another method gives `METHOD_NOT_SUPPORTED`. Each value that is not a valid DID gives `INVALID_DID`. The did:btcr2 text gives `INVALID_DID` for each identifier that does not start with `did:btcr2:`. Thus only a valid DID of another method gets a different error type. For that DID, this ADR follows DID Resolution v1.

### 7. `tryResolveDid` gives `INVALID_DID` for a DID that is not a string

`tryResolveDid` has no check before its `try` block. `Identifier.decode` refuses a DID that is not a string (decision 6). Thus `tryResolveDid(42)` and `tryResolveDid('')` give a result with `error: 'INVALID_DID'`.

### 8. The test vectors keep the bare code until the next regeneration

The test suite holds 128 negative resolve vectors. Each records the bare code in `didResolutionMetadata.error`. The pipeline reads both forms: `readExpected` reads a string, or the code of `error.type`. The offline generator writes `{ type, title }`. `scenario:verify:live --record` writes the full object. The next regeneration writes the error object into each negative vector. The vector results do not change.

### 9. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| A parameter with the name `q` in `accept` is a weight, and its value must be a `qvalue`. `'application/did;q=x'` gives `INVALID_OPTIONS`. | RFC 9110, section 12.5.1: "Recipients SHOULD process any parameter named "q" as weight, regardless of parameter ordering." Section 12.4.2: `weight = OWS ";" OWS "q=" qvalue`. | Conforms. |
| An `accept` value with an empty list element is valid, for example `''` or `'application/did,'`. | RFC 9110, section 5.6.1.2: "In other words, a recipient MUST accept lists that satisfy the following syntax: `#element => [ element ] *( OWS "," OWS [ element ] )`". | Conforms. |
| The option name check reads only the own enumerable members of the options. | DID Resolution v1, section 4.1, makes the options a metadata structure, a map. An inherited member is not an entry of the map. | Conforms. |
| `Identifier.decode` refuses a value that is not a string with `INVALID_DID` and the message `Invalid did: expected a string.` | DID Resolution v1, section 4.4, step 1: a DID that does not conform to the did rule gives `INVALID_DID`. A value that is not a string does not conform. | Conforms. |
| The message of the `DidMethodApi.resolve` wrapper prints a DID that is not a string as no text. | ADR 156: an error message prints only a primitive value. The specification defines no message text. | Conforms. |
| The `title` of each error type is a short text. `NOT_FOUND` has the title `DID not found`. | Section 10: "The title value SHOULD provide a short but specific human-readable string for the error." Example 8 of DID Resolution v1 uses `"title": "DID not found"`. | Conforms. |
| The map holds `REPRESENTATION_NOT_SUPPORTED`. No resolve path raises it. | Section 10 lists the error type with its URL. | Conforms. |
| The defensive branch of `tryResolveDid` (a result with no document and no error) gives `INTERNAL_ERROR`. Before, it gave `'unknown'`. | Section 10: `INTERNAL_ERROR`: "An unexpected error occured during DID Resolution or DID URL dereferencing." `'unknown'` is not an error type of section 10. | Conforms. |
| The type of `didDocumentMetadata` is the metadata type of the method result with each member optional. A failure gives an empty map. | Section 4.4: each failure gives "didDocumentMetadata: «[ ]»". | Conforms. |

## Alternatives

**The error type URLs `https://btcr2.dev/ns#<TYPE>`.** Rejected. The btcr2.dev vocabulary has no error term. Only a change of the specification can define such a term, and no such change exists.

**The type URL of the refined error type, with the did:btcr2 code in `title`.** Rejected. RFC 9457, section 3.1.1, makes `type` the primary identifier. Thus `INVALID_DID_UPDATE`, `LATE_PUBLISHING`, and `INVALID_DID_DOCUMENT` would have one identifier, because the two did:btcr2 errors refine `INVALID_DID_DOCUMENT`.

**Wait for the specification to define the URLs.** Rejected. The api must give a URL now, because section 10 says that the type value MUST be a URL. A later definition in the specification can change the four URLs.

**A `ProblemDetails` type in the common package.** Rejected. The method package throws typed errors and builds no error object. Only the api builds the object, so the type is in the api.

**Expand relative DID URLs now.** Rejected. Step 6 expands each relative DID URL of the DID document: the `#`, `?`, and `/` forms. The expansion needs a DID URL resolver for each form. An expansion of only the `#` form does not conform to step 6.

**Rewrite the 128 negative vectors now.** Rejected. The vector suite changes only at a regeneration. The pipeline reads both forms, so no vector result changes.

**Keep the bare code in the vectors.** Rejected. A vector records the result that the api returns. The api now returns the error object.

**`noCache` as a boolean only, and any string as `accept`.** Rejected. Section 12.2 writes the `noCache` values as strings. Section 4.1 gives `accept` a grammar, and step 4 refuses a value that is not valid.

**Keep `INVALID_DID` for `did:example:a:b`.** Rejected. It gives two codes to two valid DIDs of one method that the resolver does not support.

**`INVALID_DID` for each identifier that does not start with `did:btcr2:`.** Rejected. It changes `did:example:123` to `INVALID_DID`, against step 2 of DID Resolution v1, section 4.4.

## Consequences

- The common, method, and api packages get a MINOR release. The cli gets a PATCH release.
- A consumer that reads `raw.didResolutionMetadata.error` as a string must read `error.type`, or the top-level `error` of `tryResolveDid`. `raw.didResolutionMetadata.errorMessage` is removed. `error.detail` holds the same text.
- The api `DidResolutionResult` is not assignable to the `DidResolutionResult` of `@web5/dids`, because its `error` is an object. A TypeScript caller that uses the web5 type for an api result gets a compile error.
- A TypeScript caller that gives an option name that `ResolutionOptions` does not declare gets a compile error. A JavaScript caller gets `FEATURE_NOT_SUPPORTED` before any I/O. The cli refuses such a field of `-r` or `-p` in `resolve`, `update`, and `deactivate`.
- `did:example:a:b` gives `METHOD_NOT_SUPPORTED`. `did:BTCR2:...` and `did:ex%zz:1` give `INVALID_DID`. The message of `did:btcr2:` is now `Invalid did: did:btcr2:`.
- The map holds the 13 error types of a resolve result. DID Resolution v1, section 10, says: "Additionally, this specification uses some errors defined in Section 3.5 Processing Errors of the [CID] specification." Those errors use the type `https://w3id.org/security#<TYPE>`. No resolve path raises one, so the map leaves them out.
- A `sidecar` that is not an object gives `INVALID_OPTIONS`, under step 4 of DID Resolution v1, section 4.4. The specification issue 385 asks in question 6 which error each such requirement gives. The issue is open. A later answer can change this error type. It can also change the error type of a `minConf` that does not parse.
- The did:btcr2 specification does not give the URL of its four error types, against section 10 of DID Resolution v1. A later definition in the specification can change the four URLs of decision 2.
- The resolver does not expand relative DID URLs. A later change can add the expansion and accept `expandRelativeUrls: true`.
- `accept` and `noCache` have no effect on the result.
- 128 negative vectors keep the bare code until the next regeneration. The vector results are the same as before the change: 100 pass and 189 fail offline.

**Superseded.**

- ADR 110, the bare code in `raw.didResolutionMetadata.error` of `tryResolveDid`. Decision 1 of this ADR puts the error object there. The top-level `error` stays the code.
- ADR 110, the text "`Identifier.decode` wraps the Bech32m decoder and raises an `IdentifierError` of type `INVALID_DID` for every decoding failure": only for an identifier that is a DID of the did:btcr2 method. Decision 6 of this ADR gives `METHOD_NOT_SUPPORTED` for a valid DID of another method.
- ADR 097, the text "`tryResolveDid` sets `errorMessage` (top-level and inside `raw.didResolutionMetadata`)": the part inside `raw.didResolutionMetadata`. Decision 1 of this ADR puts the root cause message into `error.detail`.

**Unchanged.**

- ADR 097: `rootCauseMessage` gives the root cause, and `DidMethodApi.resolve` throws `Failed to resolve DID <did>: <root cause>`. The defensive branch of `tryResolveDid` stays. Decision 9 of this ADR changes its code from `'unknown'` to `INTERNAL_ERROR`.
- ADR 110: the read path raises `NOT_FOUND`, `INVALID_DID`, and `MISSING_UPDATE_DATA` as before. `resolutionErrorCode` walks the cause chain, and the nearest typed failure wins.
- ADR 105 and ADR 111: the `Resolver` constructor checks `minConf`, `versionId`, and `versionTime`.
- ADR 132: the api exports as little as possible. The two new api types replace one re-export.
- ADR 156: an error message prints only a primitive value. The new option messages use the same rule.

## Implementation

- `packages/common/src/errors.ts`: `MethodErrorCode.FEATURE_NOT_SUPPORTED` and its named export.
- `packages/method/src/core/resolution-options.ts` (new, internal): `RESOLUTION_OPTION_NAMES`, `isAcceptValue` (the RFC 9110 grammar), and `checkResolutionOptions`.
- `packages/method/src/did-btcr2.ts`: `DidBtcr2.resolve` calls `checkResolutionOptions` after `Identifier.decode`.
- `packages/method/src/core/interfaces.ts`: `ResolutionOptions` declares `accept`, `expandRelativeUrls`, and `noCache`, and extends no web5 type.
- `packages/method/src/core/identifier.ts`: `Identifier.decode` checks the type, then `isDid`, then the method.
- `packages/method/src/utils/message-text.ts`: `gotValue` moves here from `resolver.ts`.
- `packages/api/src/helpers.ts`: the map of the 13 error types, `resolutionError`, `resolutionErrorOfCode`, and `resolutionErrorCodeOfType`.
- `packages/api/src/types.ts` and `packages/api/src/index.ts`: the types `ResolutionError` and `DidResolutionResult`.
- `packages/api/src/api.ts` and `packages/api/src/method.ts`: `tryResolveDid` and `resolve` have no `assertString`; `tryResolveDid` builds the error object.
- `packages/api/lib/_scenario-helpers.ts`: `errorEnvelope` writes `{ type, title }`, and `readExpected` reads both forms. `packages/api/lib/readme-scenarios.ts`: the compare text of a negative vector.
- Tests: `resolution-options.spec.ts` (new), `decode-identifier.spec.ts`, `message-text.spec.ts`, `did-btcr2-api.spec.ts`, `did-method-api.spec.ts`, `helpers.spec.ts`, `index-exports.spec.ts`.

## References

- did:btcr2 specification: [Conformance](https://dcdpr.github.io/did-btcr2/conformance.html), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [DID-BTCR2 Identifier Decoding](https://dcdpr.github.io/did-btcr2/algorithms.html#did-btcr2-identifier-decoding), [Errors](https://dcdpr.github.io/did-btcr2/errors.html).
- [DID Resolution v1](https://www.w3.org/TR/did-resolution-1.0/) (Candidate Recommendation Draft, 26 October 2026): section 4.1 (DID Resolution Options), section 4.4 (DID Resolution Algorithm), section 10 (Errors), section 12.2 (Caching).
- [DID Core v1.1](https://www.w3.org/TR/did-1.1/), section 3.1 (DID Syntax).
- [Controlled Identifiers v1.0](https://www.w3.org/TR/cid-1.0/), section 3.5 (Processing Errors).
- [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457), sections 3.1.1 and 3.1.2.
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110), sections 5.6.1.2, 12.4.2, and 12.5.1.
- Specification issue 385, "Which errors does resolve raise, and when?" (open).
- ADRs 097, 105, 110, 111, 132, 156.
