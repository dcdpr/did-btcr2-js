# ADR 151: The Common Package Removes `JSONUtils.deleteKeys` and 11 Error Types That No Code Uses

- **Status:** Accepted
- **Date:** 2026-10-19
- **Packages:** `@did-btcr2/common` (MAJOR: `JSONUtils.deleteKeys` and 11 members of `MethodErrorCode` are removed); `@did-btcr2/keypair`, `@did-btcr2/cryptosuite`, `@did-btcr2/bitcoin`, `@did-btcr2/key-manager`, `@did-btcr2/method`, `@did-btcr2/aggregation`, and `@did-btcr2/api` (PATCH: dependency uptake; the browser bundles of method, aggregation, and api hold the common package)

## Context

### `JSONUtils.deleteKeys`

`JSONUtils.deleteKeys(value, keys)` returns a copy of a JSON value without the keys in `keys`. It removes a key at each depth, also in the items of an array.

The specification (Resolve, Apply `update`) removes only the top-level `proof` property before it hashes an update: "Create `unsigned_update` by removing the `proof` property from `update`, hash it with the [JSON Document Hashing] algorithm, and append the hash to `update_hash_history`." The Confirm Duplicate Update step uses the same words.

Before ADR 141, the Apply step of the resolver called `JSONUtils.deleteKeys(update, ['proof'])`. Thus a patch that added a member named `proof` gave a different hash at the two steps. ADR 141 replaced the call with an object rest destructure in `Resolver.unsignedUpdateHash`.

ADR 141, decision 3, kept the function: "This ADR does not remove the function from the common package, because its removal is a MAJOR change of the common package. A separate change removes it."

No source file in the packages calls the function. Only 4 tests in `packages/common/tests/utils-json.spec.ts` and the demo script `packages/common/lib/test-json-utils.ts` call it.

### 11 members of `MethodErrorCode`

`MethodErrorCode` holds the error types of a `DidMethodError`. No code in `src`, `lib`, or `tests` of a package reads or raises these 11 members:

| Member | Also a named export of the common package |
|---|---|
| `INVALID_DID_DOCUMENT_LENGTH` | no |
| `INVALID_PREVIOUS_DID_PROOF` | yes |
| `INVALID_PUBLIC_KEY` | yes |
| `INVALID_PUBLIC_KEY_MULTIBASE` | yes |
| `INVALID_PUBLIC_KEY_LENGTH` | yes |
| `INVALID_PUBLIC_KEY_TYPE` | yes |
| `INVALID_SIGNATURE` | yes |
| `UNSUPPORTED_PUBLIC_KEY_TYPE` | no |
| `INVALID_SIDECAR_DATA` | yes |
| `INVALID_UPDATE` | no |
| `MISSING_RESOLUTION_OPTIONS` | yes |

No cited specification defines these error types:

- The did:btcr2 specification (Errors) defines `INVALID_DID_UPDATE`, `INVALID_SIGNAL_DATA`, `LATE_PUBLISHING`, and `MISSING_UPDATE_DATA`. It also allows "Additional error types defined in the Errors section of DID Resolution v1".
- DID Resolution v1 (Errors) defines `INVALID_DID`, `INVALID_DID_DOCUMENT`, `NOT_FOUND`, `REPRESENTATION_NOT_SUPPORTED`, `INVALID_DID_URL`, `METHOD_NOT_SUPPORTED`, `INVALID_OPTIONS`, `INTERNAL_ERROR`, and `FEATURE_NOT_SUPPORTED`.
- Controlled Identifiers v1.0 (Processing Errors) and VC Data Integrity v1.0 (Processing Errors) define other error types. The BIP340 cryptosuite uses only error types of VC Data Integrity. None of these error types is in the table.

The api uses `Object.values(MethodErrorCode)` as the set of error types that a resolution result can carry. The api does not report another type. For an error with another type, the api uses the type of the nearest `cause` that is in this set, or else `INTERNAL_ERROR`. No code raises the 11 types, so no resolution result holds them.

## Decision

### 1. The common package removes `JSONUtils.deleteKeys`

This change removes the function, its JSDoc, its tests, and its demo lines. `defineOwn` stays, because `JSONUtils.sanitize` and other functions of `JSONUtils` use it.

To remove a top-level key, use an object rest destructure, as `Resolver.unsignedUpdateHash` does (ADR 141, decision 1):

```ts
const { proof: _, ...unsignedUpdate } = update;
```

This form removes only the top-level key, as the specification requires. A deep removal is not an operation of the specification.

### 2. The common package removes the 11 members of `MethodErrorCode`

This change removes the 11 members and their JSDoc from the enum. It also removes the 8 named exports in the table.

4 other members also have no reader. They stay for these reasons:

- `INVALID_DID_URL` and `REPRESENTATION_NOT_SUPPORTED`: DID Resolution v1 defines them. A later change of the resolution errors can use them.
- `INVALID_DOMAIN_ERROR`: VC Data Integrity v1.0 defines it. A later change of the proof verification can use it.
- `PROOF_PARSING_ERROR`: no specification defines it. VC Data Integrity v1.0 names `PARSING_ERROR` for the same failure. The later change of the proof verification replaces it, so that one change holds the full set of proof error types.

### 3. One MAJOR release holds the removals

The common package needs a MAJOR release for each removal. Both removals go into the next MAJOR release of the common package, with each other breaking change of that release. Thus the dependent packages get one dependency uptake, not two.

### 4. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| Remove the deep key removal. | Resolve, Apply `update`: "Create `unsigned_update` by removing the `proof` property from `update`". | Conforms. The specification removes one top-level property. The packages keep no function for a deep removal. |
| Remove the 11 error types. | did:btcr2 Errors allows "Additional error types defined in the Errors section of DID Resolution v1". | Conforms. Neither specification defines the 11 types, and no code raises them. |

## Alternatives

- **Keep `deleteKeys` and mark it deprecated.** Rejected. The function has no caller and no behavior that the specification uses, so a deprecation period has no value ([ADR 061](061-remove-dead-document-class.md) uses the same reason). A deprecated function also stays in the API until the next MAJOR release.
- **Change `deleteKeys` to remove only top-level keys.** Rejected. An object rest destructure already does this in one line. A second function for the same rule adds API and gives no value.
- **Keep the 11 members until a later MAJOR release of the common package.** Rejected. Each MAJOR release of the common package makes a dependency uptake in 7 packages. The removal of `deleteKeys` already makes a MAJOR release.

## Consequences

- The common package gets a MAJOR release. A caller of `JSONUtils.deleteKeys` must use an object rest destructure or its own function.
- A caller that names one of the 11 members, or imports one of the 8 named exports, gets a TypeScript error. In JavaScript, `MethodErrorCode.<member>` gives `undefined`. An ES module import of a removed named export fails when the module loads.
- The other packages need no code change. No package calls `deleteKeys` or reads the 11 members.
- The api gives the same resolution results. No code raises the 11 types, so the smaller set of types changes no result.
- The test vectors do not change.

**Superseded.**

- ADR 141, decision 3 "`JSONUtils.deleteKeys` stays in the common package". This ADR is the separate change that the decision names (decision 1).

**Unchanged.**

- ADR 141, decisions 1 and 2: `Resolver.unsignedUpdateHash` removes only the top-level `proof` property, and a nested member named `proof` is data of the update.

## Implementation

- `packages/common/src/utils/json.ts`: `JSONUtils.deleteKeys` and its JSDoc are removed.
- `packages/common/src/errors.ts`: the 11 members of `MethodErrorCode`, their JSDoc, and 8 named exports are removed.
- `packages/common/tests/utils-json.spec.ts`: the 4 tests of `deleteKeys` are removed.
- `packages/common/lib/test-json-utils.ts`: the `deleteKeys` lines of the demo are removed.

## References

- [did:btcr2 specification, Apply `update`](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update) and [Errors](https://dcdpr.github.io/did-btcr2/errors.html).
- [DID Resolution v1.0, Errors](https://www.w3.org/TR/did-resolution-1.0/#errors).
- [Controlled Identifiers v1.0, Processing Errors](https://www.w3.org/TR/cid-1.0/#processing-errors).
- [VC Data Integrity v1.0, Processing Errors](https://www.w3.org/TR/vc-data-integrity/#processing-errors) and the [BIP340 Data Integrity cryptosuite](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/).
- [ADR 141](141-the-resolver-removes-only-the-top-level-proof-before-it-hashes-an-update.md): the resolver removes only the top-level `proof` before it hashes an update.
