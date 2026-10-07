# ADR 142: The Deactivation Checks Use Strict Equality, and DidDocument Keeps the `deactivated` Property

- **Status:** Accepted
- **Date:** 2026-10-07
- **Packages:** `@did-btcr2/method` (PATCH: `DidDocument` keeps `deactivated`; the resolver stops only if `deactivated` is the boolean `true`; the metadata is a boolean); `@did-btcr2/api` (PATCH: the write guards refuse a document only if `deactivated` is the boolean `true`; the browser bundle holds the method package)

## Context

The specification (Deactivate) says: "the DID controller MUST add the property `deactivated` with the value `true` to the DID document." The resolver reads the property at two places of the specification (Resolve):

1. **Process Next Update, step 2.** "If `updates` is empty or `current_document.deactivated` is `true`", the resolver resolves `current_document`, or raises `NOT_FOUND` for a requested `versionId`.
2. **The resolver returns.** The DID document metadata holds "`deactivated`: `current_document.deactivated`." The specification (Data Structures) defines this field as a "REQUIRED boolean".

The code had three gaps:

1. **The `DidDocument` constructor lost the property.** The constructor did not copy `deactivated`, and `DidDocument.sanitize` then removed the empty property. `Resolver.external` makes `current_document` of an `x1` identifier with this constructor. Thus a genesis document with `"deactivated": true` resolved with the metadata `deactivated: false`, and the resolver applied the later updates.
2. **Step 2 tested for truth.** The test was `document.deactivated`, not a strict equality test with `true`. A value such as `"no"`, `1`, or `{}` stopped resolution and hid the later updates. A request for a later `versionId` got `NOT_FOUND`.
3. **The metadata copied the value.** The Complete phase set `deactivated` to `current_document.deactivated || false`. A string or a number went into the metadata, but the `ResolverResult` type declares a boolean.

The two api write guards of ADR 100 also tested for truth. They refused an update on a document with `"deactivated": "yes"`, but a resolver that follows the specification applies such an update.

## Decision

### 1. `DidDocument` keeps the `deactivated` property

The constructor copies `document.deactivated` as the input holds it. If the input has no `deactivated` property, `DidDocument.sanitize` removes the undefined property, and the document has no `deactivated` property. `GenesisDocument` extends `DidDocument`, so it also keeps the property.

The constructor copies only this property. The other properties that the constructor loses (`alsoKnownAs`, `controller`, extension properties) need a separate change.

### 2. A DID is deactivated only if `deactivated` is the boolean `true`

Step 2 tests `document.deactivated === true`, a strict equality test. The `NOT_FOUND` message uses the same test. A different value does not stop resolution, and the value stays in the document as is.

### 3. The metadata is a boolean

The Complete phase sets `deactivated` to `current_document.deactivated === true`. Thus the metadata is `true` only if the document holds the boolean `true`. For each other value, and for a document with no `deactivated` property, the metadata is `false`.

For the values `true` and `false`, the two texts of the specification agree. For a different value, they do not agree: Resolve copies the value, but Data Structures requires a boolean. The resolver follows the data structure, because the result type and DID Resolution also require a boolean.

### 4. The api write guards use the same test

The update chokepoint of `DidMethodApi` and `DidMethodApi.deactivate` refuse a source document only if `deactivated === true`. This is the same test as step 2. Thus the api refuses a write only if resolution stops at the source document.

## Alternatives

- **Reject a non-boolean value in `DidDocument.validate`.** Rejected. No rule of the specification rejects such a value, and DID Core v1.1 does not define `deactivated` as a DID document property. A reject makes the resolver fail on a history that a resolver that follows the specification resolves.
- **Copy all properties of the input in the constructor.** Rejected for this change. The other properties need their own tests, and the change can change the hash of more documents.
- **Copy the value into the metadata, as Resolve says.** Rejected. The metadata then holds a value that is not a boolean, and the result type and DID Resolution require a boolean.

## Consequences

- An `x1` genesis document with `"deactivated": true` resolves as deactivated at version 1. A request for version 2 gets `NOT_FOUND`.
- An `x1` genesis document with the `deactivated` property keeps it in `current_document`. Thus the hash of `current_document` includes the property, and the `sourceHash` of a version 2 update agrees with the specification.
- A document with no `deactivated` property gets the same hash and the same result as before.
- Resolution continues past a value that is not `true`, and the metadata reports `false`.
- The genesis bytes of an `x1` identifier do not change. `GenesisDocument.toGenesisBytes` hashes the input as given.

## Implementation

- `packages/method/src/utils/did-document.ts`: the `DidDocument` constructor.
- `packages/method/src/core/resolver.ts`: step 2 of Process Next Update and the Complete phase.
- `packages/api/src/method.ts`: the guards in the update chokepoint and in `deactivate`.
- `packages/method/tests/resolver.spec.ts`: the tests "deactivated in the genesis document (ADR 142)" and "does not stop at a deactivated value other than true, and reports false (ADR 142)".
- `packages/method/tests/did-document.spec.ts`: the tests "DidDocument deactivated property (ADR 142)".
- `packages/api/tests/did-btcr2-api.spec.ts`: the two tests "does not refuse ... whose deactivated value is not true (ADR 142)".

## References

- [did:btcr2 specification, Deactivate](https://dcdpr.github.io/did-btcr2/operations/deactivate.html).
- [did:btcr2 specification, Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html) and [Process Next Update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#process-next-update).
- [did:btcr2 specification, DID Document Metadata](https://dcdpr.github.io/did-btcr2/data-structures.html#did-document-metadata).
- [ADR 100](100-update-path-refuses-a-deactivated-source.md): the update path refuses a deactivated source document.
