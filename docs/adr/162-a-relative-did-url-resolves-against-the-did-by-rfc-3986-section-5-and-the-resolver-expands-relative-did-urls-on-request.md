# ADR 162: A Relative DID URL Resolves Against the DID by RFC 3986, Section 5, and the Resolver Expands Relative DID URLs on Request

- **Status:** Accepted
- **Date:** 2026-10-29
- **Packages:** `@did-btcr2/method` (MINOR: `Appendix.absoluteDidUrl` resolves each form of a relative DID URL; the read path, the write path, and the DID document check get the new result; `expandRelativeUrls: true` expands the result document); `@did-btcr2/api` (MINOR: `resolveDid` and `tryResolveDid` accept `expandRelativeUrls: true`; `updateDid` and `deactivateDid` refuse `expandRelativeUrls: true` for the source resolution; the message check does not resolve the `controller`; the browser bundle holds the method package); `@did-btcr2/cli` (PATCH: the `resolve`, `update`, `deactivate`, and `message` docs; dependency uptake through api)

## Context

### The library resolved only the `#` form

`Appendix.absoluteDidUrl(input, did)` added the DID before a reference that starts with `#`. It returned each other string unchanged, and it returned `undefined` for `""` and for a value that is not a string. Each DID URL comparison on the read path and on the write path goes through this function (ADR 091, ADR 092). The results for the DID `<did>`:

| Reference | Before | After |
|---|---|---|
| `#k` | `<did>#k` | `<did>#k` |
| `?v=1#k` | `?v=1#k` | `<did>?v=1#k` |
| `/keys#k` | `/keys#k` | `<did>/keys#k` |
| `keys#k` | `keys#k` | `<did>/keys#k` |
| `../keys#k` | `../keys#k` | `<did>/keys#k` |
| `""` | `undefined` | `<did>` |
| `//host#k` | `//host#k` | `//host#k` |
| `urn:x:1`, `<other did>#k` | unchanged | unchanged |

Thus one reference had two results on the paths of the library:

- The read path refused an update whose `capabilityInvocation` entry is `?v=1#k2` and whose proof names `<did>?v=1#k2`. The error was `INVALID_DID_UPDATE` (`verificationMethod is not authorized for capabilityInvocation`). With the entry `<did>?v=1#k2`, the same update applied.
- The write path refused the relative ids `?key=1` and `/keys/1` (ADR 147, decision 6, rule 1). It accepted the absolute ids `<did>?key=1` and `<did>/keys/1` (rule 2).
- The DID document check refused a document with the service ids `#s` and `<did>#s`, because the two ids are one id. It accepted a document with `?s` and `<did>?s`, or with `s` and `/s`.
- `absoluteDidUrl('#k', {})` gave `"[object Object]#k"`, and a DID that is an object with no prototype gave a raw `TypeError`.

### The specification and DID Core

The section "Data Structures" of the specification says: "Implementations MUST resolve a relative DID URL against the document `id` before they compare that URL with another reference." Its footnote says: "When an implementation resolves a relative DID URL against a DID base, the result cannot contain an authority component."

DID Core v1.1, section 3.2.1, says:

- "A relative DID URL is any URL value in a DID document that does not start with did:<method-name>:<method-specific-id>."
- "Relative DID URLs MAY contain relative path components, query parameters, and fragment identifiers."
- "When resolving a relative DID URL reference, the algorithm specified in RFC3986 Section 5: Reference Resolution MUST be used."
- "The scheme is did. The authority is a combination of <method-name>:<method-specific-id>, and the path, query, and fragment values are those defined in Path, Query, and Fragment, respectively."

DID Core v1.1, section 3.2, gives the syntax `did-url = did path-abempty [ "?" query ] [ "#" fragment ]`.

The URL parser of the URL Standard cannot resolve against a DID. The path of a DID is opaque to the parser, so `new URL('?v=1', did)` throws.

### The resolver refused `expandRelativeUrls: true`

DID Resolution v1, section 4.1, defines the option: "A boolean flag which instructs a DID resolver to expand relative DID URLs in the DID document to absolute DID URLs conformant with DID URL Syntax." Section 4.4, step 6, gives the expansion:

1. "Iterate over all services, verification methods, verification relationships and any extension-defined properties in the output DID document."
2. "For each item, if the item is an object and the value of the id property is a relative DID URL, or if a verification relationship is a relative DID URL:" "Resolve the relative DID URL to an absolute DID URL conformant with DID URL Syntax, according to the rules of section Relative DID URLs in Decentralized Identifiers (DIDs) v1.0."
3. "Update the output DID document by replacing the relative DID URLs with the resolved absolute DID URLs."

ADR 157, decision 4, refused `expandRelativeUrls: true` with `FEATURE_NOT_SUPPORTED`. Its alternative "Expand relative DID URLs now" gives the reason: "An expansion of only the `#` form does not conform to step 6."

### An expanded source document breaks an update

Update says: "`sourceDidDocument` MUST be the [DID document (data structure)] that the same fresh resolution returns." Resolve says: "Hash `current_document` with the [JSON Document Hashing] algorithm. Raise an [`INVALID_DID_UPDATE`] error if the result does not match the decoded `update.sourceHash`."

The api resolves a DID source with the resolution options of the caller (ADR 098). An expanded document has another hash. A test made an update from an expanded document with relative `#` ids. The resolver refused it: `INVALID_DID_UPDATE: Hash mismatch: update.sourceHash !== currentDocumentHash`. If the api broadcasts such an update, each later resolution of the DID fails at that update.

## Decision

### 1. `absoluteDidUrl` resolves a reference by RFC 3986, section 5

`Appendix.absoluteDidUrl(input, did)` applies these rules, in this order:

1. If `input` or `did` is not a string, the result is `undefined`.
2. A value with a scheme stays unchanged. It is not a relative reference (RFC 3986, section 4.1), so the function does not resolve it. The strict mode of RFC 3986, section 5.2.2, removes the dot segments of such a value. The function does not. An absolute DID URL, an id under another DID, and `urn:x:1` stay as they are.
3. A value that starts with `//` (a network-path reference) stays unchanged. The result of RFC 3986 has an authority, and a DID URL cannot have one.
4. Each other value resolves by RFC 3986, section 5.2.2. The base is the DID, as DID Core v1.1, section 3.2.1, gives it: the scheme `did` and the authority `<method-name>:<method-specific-id>`. The DID has no path and no query.

The target path of rule 4 is:

- For an empty path: the empty path of the DID.
- For a path that starts with `/`: the path with no dot segments (RFC 3986, section 5.2.4).
- For another path: `/`, then the path (RFC 3986, section 5.2.3), with no dot segments.

The query and the fragment of the target are those of the reference, because the base has no query. The function writes the result by the DID URL syntax of DID Core v1.1, section 3.2. The order is the DID, the path, the query, and the fragment. The recomposition of RFC 3986, section 5.3, writes `//` and the authority after the scheme, and a DID URL has no authority.

The code is in the internal module `packages/method/src/utils/relative-did-url.ts`. The package does not export it (ADR 132).

### 2. `""` resolves to the DID

RFC 3986, section 5.2.2, gives the base path and the base query for an empty reference, so the target of `""` is the DID. Section 4.4 of RFC 3986 says: "The most frequent examples of same-document references are relative references that are empty or include only the number sign ("#") separator followed by a fragment identifier." A value that is not a string still gives `undefined`.

The old rule for `""` had no ADR. ADR 092 (Context) records it as a guard: two unusable values never compare equal. ADR 088 (decision 2) records the guard for a malformed entry. The guard stays for a value that is not a string.

The write path still refuses `""` as the id of the signing method. Rule 2 of ADR 147, decision 6, needs the DID, then `#`, `?`, or `/`, then more text. The message is `Invalid verificationMethodId: expected "<did>" followed by a fragment, a query, or a path; got "<did>".`

Two sites used `absoluteDidUrl` as a guard for `""`, and they change:

- The api message check does not resolve the `controller` of a method before it compares it with the DID. With decision 2, a resolved `controller` of `""` gives the DID and passes. DID Core v1.1, section 5.2, says: "the controller value MUST conform to Section 3.1 DID Syntax". The method package also does not resolve the `controller`.
- The vector pipeline function `signWithConfig` checks for `""` before it calls `absoluteDidUrl`.

### 3. Each comparison gets the new result

Each caller of `absoluteDidUrl` gets the new result with no other code change:

- The read path finds the `capabilityInvocation` entry of `update.proof` in each form. The multikey of the proof gets the absolute id.
- The write path accepts a relative id in each form (ADR 147, decision 6, rule 1). The message for an id that does not resolve to a DID URL is now `Invalid verificationMethodId: expected a DID URL, or a relative DID URL that resolves to a DID URL; got "<id>".` The error type stays `INVALID_DID_UPDATE`.
- The beacon lookup of `DidBtcr2.update` finds a `beaconId` of `?service=x` as `<did>?service=x`.
- The lookup of the aggregation communication key and the lookup of the api message check match each form.
- The DID document check resolves each service id before the duplicate rule of ADR 149, decision 3, rule 8. Thus `?s` and `<did>?s` are one id, and `s` and `/s` are one id.
- The producer rules of ADR 149, decision 4, resolve each form: rule 1 (a repeated reference) and rule 7 (a shared id). Thus the write path and the create path refuse the method ids `k` and `/k` as one id. They also refuse the references `?k` and `<did>?k` in one relationship as a repeated item.

### 4. `expandRelativeUrls: true` expands the result document

`DidBtcr2.resolve` accepts `expandRelativeUrls: true`. A value that is not a boolean gives a `ResolveError` of type `INVALID_OPTIONS`. `false` and an absent option give no expansion.

The `Resolver` keeps the option. In the Complete phase, if the option is `true`, the result `didDocument` is a `DidDocument` made from an expanded copy. The state document of the resolver does not change, so each later step uses the document with no expansion.

The expansion walks the document as follows:

- Each map with a string `id` member, at any depth below the document: the `id` resolves by decision 1. This covers each service, each verification method, each embedded method of a relationship, and each method that an extension-defined property holds. The function has no list of the extension-defined properties, so each member that is not a DID Core member counts as one.
- Each string item of the five verification relationships: the item resolves by decision 1.
- `@context` stays unchanged. A map in it is a JSON-LD context, and its `id` member, for example `"id": "@id"`, is not a DID URL.
- Each `serviceEndpoint` value stays unchanged. A map in it is endpoint data, not an item of step 6.1.
- The walk does not resolve the document `id`. `controller` and `alsoKnownAs` hold only strings, so the walk does not change them.

A value with a scheme and a value that starts with `//` stay unchanged (decision 1). The copy keeps a member with the name `__proto__` as data.

### 5. The api refuses `expandRelativeUrls: true` for the source of an update

If the source of `updateDid` or `deactivateDid` is a DID, the api refuses `expandRelativeUrls: true` in `options.resolutionOptions` before any I/O. The refusal is an `UpdateError` of type `INVALID_OPTIONS`, with the data `{ expandRelativeUrls: true }`. The message is:

`` The source resolution of an update cannot use `expandRelativeUrls: true`: the `sourceHash` must be the hash of the document with no expansion. ``

The cli `update` and `deactivate` give their `-r` and `--resolution-options-path` flags to this resolution, so they get the same refusal. A `SourceState` is data of the caller, and the api cannot detect if it comes from an expanded resolution. The docs tell the caller not to use an expanded document as a source.

The guard meets the api guard criterion of ADR 135. The api refuses a write only if the failure is permanent for the DID and the api already holds the data to find the failure. After the broadcast, the DID does not resolve. The api holds the option.

### 6. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| The base is the DID with an empty path, and the result follows the DID URL syntax (decision 1). | DID Core v1.1, section 3.2.1: "The scheme is did. The authority is a combination of <method-name>:<method-specific-id>". Step 6.2.1: "Resolve the relative DID URL to an absolute DID URL conformant with DID URL Syntax". Footnote of "Data Structures": "the result cannot contain an authority component". | Conforms. The result starts with the DID, so `//` never comes directly after `did:`. An RFC 3986 parse of the result has no authority. |
| Each relative form resolves, and the write path accepts it (decisions 1 and 3). | "Data Structures": "Implementations MUST resolve a relative DID URL against the document `id` before they compare that URL with another reference." DID Core v1.1, section 3.2.1: "Relative DID URLs MAY contain relative path components, query parameters, and fragment identifiers." | Conforms. |
| `""` resolves to the DID (decision 2). | RFC 3986, section 5.2.2: `if (R.path == "") then T.path = Base.path;`. DID Core v1.1, section 3.2.1: "A relative DID URL is any URL value in a DID document that does not start with did:<method-name>:<method-specific-id>." | Conforms. |
| A value that starts with `//` stays unchanged, for a comparison and for the expansion. | "Data Structures": "A resolver MAY treat all other URLs in the document as opaque strings." Step 6.2.1 asks for "an absolute DID URL conformant with DID URL Syntax". | Conforms for a comparison. For the expansion, DID Core calls the value a relative DID URL, but no result of RFC 3986 is a DID URL. The specification does not define this case. |
| A value with a scheme stays unchanged, with no removal of dot segments. | "Data Structures": "Implementations MUST resolve a relative DID URL against the document `id`". An absolute URI is not a relative reference (RFC 3986, section 4.1). | Conforms for a comparison. For the expansion, step 6.2.1 gives no DID URL for an `https:` or a `urn:` value. The value stays. |
| No normalization of case or percent-encoding before a comparison. | RFC 3986, section 5.2.1: "Normalization of the base URI, as described in Sections 6.2.2 and 6.2.3, is optional." Section 4.4: "Normalization of the base and target URIs prior to their comparison, as described in Sections 6.2.2 and 6.2.3, is allowed but rarely performed in practice." | Conforms. |
| Service ids resolve before the duplicate rule (decision 3). | Controlled Identifiers v1.0, section 2.1.4: "A conforming document MUST NOT include multiple service entries with the same id." DID Core v1.1, section 3.2.1: "When resolving a relative DID URL reference, the algorithm specified in RFC3986 Section 5: Reference Resolution MUST be used." | Conforms. "Data Structures" also lets a resolver treat a service `id` as opaque. The choice keeps ADR 149, decision 3, rule 8, and agrees with the beacon lookup. |
| The expansion walks each map with a string `id` at any depth (decision 4). | Step 6.1: "Iterate over all services, verification methods, verification relationships and any extension-defined properties in the output DID document." | Conforms. |
| The expansion does not walk `@context` (decision 4). | Step 6.1 names services, verification methods, verification relationships, and extension-defined properties. `@context` is none of them. | Conforms. |
| The api refuses `expandRelativeUrls: true` for the source of an update (decision 5). | Update: "`sourceDidDocument` MUST be the [DID document (data structure)] that the same fresh resolution returns." Resolve: "Raise an [`INVALID_DID_UPDATE`] error if the result does not match the decoded `update.sourceHash`." | Conforms. The specification does not name the option for the source resolution. |

## Alternatives

**Use the URL parser of the URL Standard.** Rejected. The parser throws for each form except `#`, because the path of a DID is opaque to it.

**Recompose the result by RFC 3986, section 5.3.** Rejected. It writes `did://btcr2:...`, which is not a DID URL. The footnote of "Data Structures" says that the result cannot contain an authority component.

**Parse the DID by RFC 3986 and use that parse as the base.** Rejected. A strict parse gives the scheme `did` and the path `btcr2:...`, so `/keys#k` gives `did:/keys#k`. That is not a DID URL. DID Core v1.1, section 3.2.1, makes the DID the base URI and gives the authority. The DID has no path.

**`""` gives `undefined`.** Rejected. RFC 3986 and DID Core make `""` a relative DID URL whose target is the DID. With the result `undefined`, each comparison refuses a reference that the DID document check accepts.

**A value that starts with `//` gives `did://host#k`, or `undefined`.** Rejected. `did://host#k` is not a DID URL. With `undefined`, the read path refuses an update that the old code and an RFC 3986 resolver accept.

**Keep the refusal of `expandRelativeUrls: true`.** Rejected. Decision 1 resolves each form, so the reason of ADR 157 no longer applies. DID Resolution v1 defines the option.

**Expand only the DID Core members.** Rejected. Step 6.1 names "any extension-defined properties". A `VerifiableCondition2021` method of the DID Extensions registry holds methods with an `id`, and these ids then stay relative.

**Walk `@context` as an extension-defined property.** Rejected. A JSON-LD context map `{"id": "@id"}` then gives `<did>/@id`.

**The api removes the option before the source resolution.** Rejected. The api then ignores an input of the caller with no notice. For the same reason, the cli refuses its resolution flags with the source pair, because the api ignores them there (ADR 106).

**Docs only for the write path.** Rejected. A broadcast is irreversible, and after it the DID does not resolve.

**Resolve only the `#` form of a service id.** Rejected. The beacon lookup resolves each service id, and ADR 149, decision 3, rule 8, resolves a relative `id` before the duplicate rule.

## Consequences

- The method and api packages get a MINOR release. The cli gets a PATCH release.
- The read path changes in two directions. It applies updates that the old code refused: a query, a path, or a relative-path entry, and `""`. It refuses documents that the old code accepted: two service ids that give one absolute DID URL. Another implementation that compares raw strings, or that uses a strict RFC 3986 parse of the DID, can give another result.
- The write path and the create path refuse more documents than the old code. Two method ids that give one absolute DID URL are one id. Two such references in one relationship are a repeated item.
- No test vector holds a query, a path, `""`, or a `//` form. A scan of 2,510 vector and scenario files found only `#` forms. The `#` result does not change, so no vector changes.
- The api derives the signing method of `update` from the `capabilityInvocation` entries. A document with a relative `?` or `/` entry can now give two candidates where the old code gave one. The api then refuses and names both.
- A signed message still names the method by `<did>#fragment` (ADR 137). A method with a `?` or a `/` id cannot sign a message.
- `expandRelativeUrls: true` returns the expanded copy. The metadata of the result does not change.
- The api refuses an `updateDid` or `deactivateDid` call with a DID source and `expandRelativeUrls: true` before any I/O. The error is an `UpdateError` of type `INVALID_OPTIONS`. Before, it failed with a plain `Error` (`Failed to resolve DID <did>: ...`).

These residuals stay:

- A proof whose `verificationMethod` is a relative DID URL still fails (ADR 092). For a relative proof id that does not start with `#`, the message changes. It was `Invalid update: verificationMethod is not found in the verificationMethod of the current document`. It is now `Invalid update: proof verification failed: Id mismatch: config.verificationMethod !== this.multikey.fullId()`. The error type stays `INVALID_DID_UPDATE`.
- The read path accepts a proof that names the bare DID, if a `capabilityInvocation` entry is `""`. Controlled Identifiers v1.0, section 3.3, steps 7 and 8, refuse such a proof. The read path does not apply section 3.3: the specification step "Check `update.proof`" makes its own checks of the method (ADR 147). For the same entry `""`, `getAggregationCommunicationKey` now gives the key of the method whose id is `""` or the DID.
- The expansion keeps a `//` value and a value with another scheme. Step 6.2.1 gives no DID URL for these values.
- A relationship can list `#k` and `<did>#k`. The DID document check of a consumer accepts it, and the expansion gives the same item two times. Step 6.3 does not remove an item.
- A `SourceState` or a cli `--source-document` from an expanded resolution makes an update that the resolver refuses. The api cannot detect it. A specification issue can state that the source resolution of an update does not expand.

**Superseded.**

- ADR 088, decision 2, the first safety property: "Only a `#`-prefixed string has the document id prepended." Decision 1 of this ADR resolves each relative form. The rest of the property stays: a value with a scheme stays unchanged, so an entry under another DID stays a full URL.
- ADR 091, the decision "Resolve relative DID URLs to absolute, then compare": "`Appendix.absoluteDidUrl(input, did)` prefixes a leading-`#` reference with `did` and returns every other string unchanged." Decision 1 of this ADR replaces the rule.
- ADR 147, decision 6, rule 1: "A relative id resolves only in the `#` form (`Appendix.absoluteDidUrl`). A relative `?key=1` or `/keys/1` fails." Also the last sentence of the reason: "On each path, the library resolves only the `#` form of a relative DID URL (`Appendix.absoluteDidUrl`, ADR 091 and ADR 092)." Decision 3 of this ADR gives the new rule 1 and its message.
- ADR 157, decision 3, item 3, and decision 4: `expandRelativeUrls: true` gives `FEATURE_NOT_SUPPORTED`. Also the consequence "The resolver does not expand relative DID URLs." Decision 4 of this ADR expands the document.
- The rule that `""` gives `undefined`, which ADR 092 (Context) records. Decision 2 of this ADR replaces it.

**Unchanged.**

- ADR 091: the DID goes to each beacon as an argument.
- ADR 092: each comparison refuses an `undefined` target, and the proof names the method by its absolute id.
- ADR 137: a signed message names the method by `<did>#fragment`.
- ADR 147, decision 6, rule 2: the absolute id must be the DID, then `#`, `?`, or `/`, then more text.
- ADR 149, decision 3, rule 8: the rule text stays. Decision 3 of this ADR adds the result for the `?`, `/`, relative-path, and `""` forms.
- ADR 149, decision 4, rules 1 and 7: the rule text stays. Decision 3 of this ADR adds the result for the same forms.
- ADR 149, decision 5, reference rule 2: a consumer still does not check a relative reference that starts with `//`.
- ADR 157, decisions 1 and 2, and each other option check of decision 3.

## Implementation

- `packages/method/src/utils/relative-did-url.ts` (new, internal): `resolveRelativeDidUrl` (RFC 3986, section 5.2, with the base of DID Core) and `expandRelativeDidUrls` (decision 4).
- `packages/method/src/utils/appendix.ts`: `absoluteDidUrl` uses `resolveRelativeDidUrl`, and it gives `undefined` for a `did` that is not a string.
- `packages/method/src/core/updater.ts`: the rule 1 message and the JSDoc of `absoluteMethodId`, the constructor, and `signingMethod`.
- `packages/method/src/core/resolution-options.ts`: the change removes the step 3 refusal of `true`; a value that is not a boolean gives `INVALID_OPTIONS`.
- `packages/method/src/core/resolver.ts`: the constructor option `expandRelativeUrls`; the Complete phase expands the result document.
- `packages/method/src/did-btcr2.ts`: `resolve` gives the option to the `Resolver`.
- `packages/method/src/core/interfaces.ts`: the JSDoc of `ResolutionOptions.expandRelativeUrls`.
- `packages/api/src/api.ts`: the guard of decision 5 in `#resolveUpdateSource`, and the JSDoc of `updateDid`.
- `packages/api/src/message.ts`: the `controller` comparison.
- `packages/api/src/method.ts`: the JSDoc of `resolve`.
- `packages/api/lib/_scenario-helpers.ts`: `signWithConfig` checks for `""` first.
- Docs: `packages/method/README.md`, `packages/api/README.md`, `packages/cli/docs/resolve.md`, `update.md`, `deactivate.md`, `message.md`.
- Tests:
  - method: `relative-did-url.spec.ts` (a table for each form and for rules B, C, and E of RFC 3986, section 5.2.4; the expansion), `updater.spec.ts`, `resolver.spec.ts` (the read path with each form; the expansion), `resolution-options.spec.ts`, `did-sender-resolver.spec.ts`, `tests/data/did-core-cases.ts` (two service ids, a repeated reference, and a shared method id).
  - api: `did-btcr2-api.spec.ts` (`resolveDid` with the expansion; the guard of `updateDid` and `deactivateDid`), `did-method-api-message.spec.ts` (a `controller` of `""`).

## References

- did:btcr2 specification: [Data Structures](https://dcdpr.github.io/did-btcr2/data-structures.html) (DID Document), [Update](https://dcdpr.github.io/did-btcr2/operations/update.html), [Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html) ("Apply `update`").
- [DID Core v1.1](https://www.w3.org/TR/did-1.1/), sections 3.2, 3.2.1, and 5.2.
- [DID Resolution v1](https://www.w3.org/TR/did-resolution-1.0/), sections 4.1 and 4.4.
- [Controlled Identifiers v1.0](https://www.w3.org/TR/cid-1.0/), sections 2.1.4 and 3.3.
- [RFC 3986: Uniform Resource Identifier (URI): Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986), sections 4.1, 4.2, 4.4, 5.2, and 5.3.
- [DID Extensions: properties](https://w3c.github.io/did-extensions/properties/) (`VerifiableCondition2021`).
- ADRs 088, 091, 092, 098, 106, 132, 135, 137, 147, 149, 157.
