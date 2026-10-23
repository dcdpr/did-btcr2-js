# ADR 155: JSONPatch Applies the Rules of RFC 6901 and RFC 6902 with Its Own Engine and Accepts Each Member Name

- **Status:** Accepted
- **Date:** 2026-10-23
- **Packages:** `@did-btcr2/common` (MAJOR: `JSONPatch.apply` refuses patches that it applied before and applies patches that it refused before; `JSONPatchApplyOptions`, the options parameter of `apply`, the `strict` parameter of `validateOperations`, `JSONPatch.diff`, `JSONPatch.joinPointer`, and `JSONPatch.escapeSegmentPath` are removed; the package no longer depends on `fast-json-patch`); `@did-btcr2/method` (MINOR: both update paths refuse and apply other patches through the common package; the browser bundle holds the common package); `@did-btcr2/api` (MINOR: `applyPatch`, `constructUpdate`, the update functions, and the resolve functions apply the new rules through method; the browser bundle holds method and common); `@did-btcr2/aggregation` (PATCH: dependency uptake; the browser bundle holds the common package and no longer holds `fast-json-patch`); `@did-btcr2/cli` (PATCH: dependency uptake through api; documentation); `@did-btcr2/keypair`, `@did-btcr2/cryptosuite`, `@did-btcr2/bitcoin`, and `@did-btcr2/key-manager` (PATCH: dependency uptake)

## Context

### The update paths apply the patch by the rules of RFC 6902

The specification has the same rule on the write path and on the read path:

> Apply `jsonPatch` to `sourceDidDocument` to create `targetDidDocument`. An [`INVALID_DID_UPDATE`] error MUST be raised if `jsonPatch` is malformed or fails to apply. (Update, Construct BTCR2 Unsigned Update)

> Raise an [`INVALID_DID_UPDATE`] error if `update.patch` is malformed or fails to apply. JSON Patch operations are evaluated in order; the first operation that fails, including a failed `test` operation, fails the whole patch. (Resolve, Apply `update`)

RFC 6901 and RFC 6902 define when a patch is malformed and when it fails to apply:

| Rule | Text |
|---|---|
| Pointer syntax | RFC 6901 section 3 gives `escaped = "~" ( "0" / "1" )` and says: "It is an error condition if a JSON Pointer value does not conform to this syntax (see Section 7)." |
| Object token | RFC 6901 section 4: "If the currently referenced value is a JSON object, the new referenced value is the object member with the name identified by the reference token." |
| Array token | RFC 6901 section 4: the token must be "characters comprised of digits (see ABNF below; note that leading zeros are not allowed)" or "exactly the single character "-"". |
| Index bound | RFC 6902 section 4.1: "The specified index MUST NOT be greater than the number of elements in the array." |
| Location exists | RFC 6902 sections 4.2 and 4.3: "The target location MUST exist for the operation to be successful." Sections 4.4 and 4.5: "The "from" location MUST exist for the operation to be successful." |
| Move into a child | RFC 6902 section 4.4: "The "from" location MUST NOT be a proper prefix of the "path" location; i.e., a location cannot be moved into one of its children." |
| Copy is an add | RFC 6902 section 4.5: "This operation is functionally identical to an "add" operation at the target location using the value specified in the "from" member." |
| Object equality | RFC 6902 section 4.6: "objects: are considered equal if they contain the same number of members, and if each member can be considered equal to a member in the other object, by comparing their keys (as strings) and their values (using this list of type-specific rules)." |
| Ignored members | RFC 6902 section 4: "Members that are not explicitly defined for the operation in question MUST be ignored" |
| Failure | RFC 6902 section 5: "If a normative requirement is violated by a JSON Patch document, or if an operation is not successful, evaluation of the JSON Patch document SHOULD terminate and application of the entire patch document SHALL NOT be deemed successful." |

### The old engine did not apply these rules

`JSONPatch.apply` ran the operation checks of the common package and then called `fast-json-patch` 3.1.1. The last release of that library is from 2022-03-24. The table shows the results of the old engine and the results of the RFC rules:

| Document | Patch | Old result | RFC result |
|---|---|---|---|
| `{"alsoKnownAs":["a"]}` | `add /alsoKnownAs/00` | inserts at index 0 | fails: `00` is not an array index |
| `{"a":["p","q"]}` | `add /a/` (an empty token) | inserts at index 0 | fails: an empty token is not an array index |
| `{"a":["p","q"]}` | `add /a/4294967296` | inserts at index 0 | fails: the index is greater than the number of elements |
| `{}` | `add /x~2y` | adds the member `x~2y` | fails: `~2` is not an escape |
| `{"service":[{"id":"#s"}]}` | `remove /service/0/toString` | applies, no change | fails: the location does not exist |
| `{"o":{"x":1}}` | `replace /o/valueOf` | adds the member `valueOf` | fails: the location does not exist |
| `{"s":[{"x":1},{"y":2}]}` | `move` from `/s/0` to `/s/0/z` | applies | fails: a move into a child |
| `{"a":"A","c":[1,2,3]}` | `copy` from `/a` to `/c/9` | appends | fails: the index is greater than the number of elements |
| `{"c":[1,2,3]}` | `move` from `/c/0` to `/c/3` | appends | fails: after the remove, the array has 2 elements |
| `{"a":1}` | `move` from `''` to `/c` | a document with a cycle | fails: a move into a child |
| `{"o":{"hasOwnProperty":"x"}}` | `test /o` with the value `{"hasOwnProperty":"x"}` | fails with a `TypeError` | applies |
| `{"service":[{"id":"#s"}]}` | `add /service/0/constructor` | fails | applies |
| `{"o":{}}` | `add /o/__proto__` | fails | applies |
| `{}` | `add /a` with the member `"from":"/constructor"` | fails | applies: `from` is an ignored member |
| `{"a":1}` | `remove ''` | gives `null` | no rule (decision 4) |

The causes:

- `fast-json-patch` converts an array token to a number with `~~`. Thus `00`, an empty token, and `4294967296` became an index, and `4294967296` wrapped to 0. The library keeps `~2` as text.
- The library tests if a location exists with `obj[key] === undefined`. Thus an inherited JavaScript member, for example `toString`, exists.
- The library checks the index bound for an `add` only, not for the `add` of a `move` or a `copy`. It does not check the proper prefix of a `move`.
- The `test` operation of the library calls `hasOwnProperty` on the operation value.
- The common package refused each `path` and each `from` with a `__proto__`, `constructor`, or `prototype` segment. The common 9.3.0 CHANGELOG gives the reason. `fast-json-patch` walks an intermediate `constructor` segment to the global `Object` function. The operation then writes a static member for the whole process. No ADR records the guard.

The two update paths use `JSONPatch.apply`. Thus the library signed and resolved updates that a conformant resolver refuses. It also refused updates that a conformant resolver applies.

### The strict option

ADR 112 added the `strict` option to `JSONPatch.apply`, with the default `false`. ADR 112 also says: "the default flips at the next major version of the common package". Common 10.0.0 made this change. Its CHANGELOG says: "`JSONPatch.apply` is strict by default (ADR 112)." Both method paths passed `strict: true`. Only the scenario tool of the test vectors passed `strict: false`, and the tool uses the source document if the apply fails.

## Decision

### 1. The common package applies JSON Patch with its own engine

`JSONPatch.apply(sourceDocument, operations)` applies the rules of RFC 6901 and RFC 6902 with an engine in `packages/common/src/json-patch.ts`. The common package no longer depends on `fast-json-patch`. The steps of `apply`:

1. If `operations` is not an array, the apply fails. This check runs before the JSON copy, because `undefined` has no JSON form.
2. The engine makes a JSON copy of the operations (ADR 139) and checks the copy with `validateOperations`.
3. The engine makes a JSON copy of the source document.
4. The operations run in order on the copy of the document. The first operation that fails stops the patch (RFC 6902 section 5).

Each failure is a `MethodError` of type `JSON_PATCH_APPLY_ERROR` (ADR 085). Operations or a document with no JSON form also give this error, for example a value with a cycle or a BigInt. Before, these values gave a `TypeError`. The message names the index, the `op`, and the `path` of the operation that fails. `data` holds `index`, `op`, and `path`, and also `from` for a `move` or a `copy`.

### 2. The checks of the engine

`validateOperations(operations)` checks each operation with no document, in this order:

1. The operation is a JSON object.
2. `op` is one of the six operation codes of RFC 6902.
3. `path` is a JSON Pointer by the syntax of RFC 6901 section 3.
4. `add`, `replace`, and `test` have an own `value` member that is not `undefined`.
5. `move` and `copy` have a `from` that is a JSON Pointer.
6. The `from` of a `move` is not a proper prefix of its `path`.

The engine ignores each other member, for example a `from` in an `add` (RFC 6902 section 4). Then `apply` checks each operation against the document:

- In an object, a token names an own member. An inherited JavaScript member, for example `toString`, does not exist.
- In an array, a token is an array index with no leading zero, or `-`. The token `-` appends, and only the last token of an `add` target can be `-`. The `add` of a `move` and of a `copy` has the same rule.
- The index of an `add` must not be greater than the number of elements. The `add` of a `move` and of a `copy` has the same check. For a `move`, the check runs on the array after the remove.
- Each target location of `remove`, `replace`, and `test` must exist. Each `from` location must exist.
- A `test` compares by the rules of RFC 6902 section 4.6. The member order is not significant, and the comparison reads own members only.
- A `copy` adds a JSON copy of the value. Thus a later operation that changes one location does not change the other location.

### 3. Each member name is data

The engine refuses no member name. `constructor`, `prototype`, and `__proto__` are member names, as each other name is. The engine reads a member only if it is an own member (`Object.hasOwn`), and it writes each member with `Object.defineProperty`. It works on JSON copies, which hold only plain objects, arrays, and primitive values. Thus no pointer gets to a prototype or a global object, and the guard of common 9.3.0 is removed. A `__proto__` member is an own data member, as in `DidDocument` (ADR 144).

### 4. A patch can replace the whole document, but cannot remove it

An `add` or a `replace` at the pointer `''` replaces the whole document with the value (RFC 6902 section 4.1). The result can be any JSON value, and `apply` keeps the return type `Record<any, any>`. The two method paths then refuse a result that is not a DID document.

A `remove` at `''` fails. RFC 6902 gives no document after the root is removed. Before, `apply` gave `null`, and only `DidMethodApi.applyPatch` showed this `null`. The two method paths refused the patch before and after this change, because `null` is not a DID document.

### 5. The apply has no options

These items are removed:

- `JSONPatchApplyOptions` and the options parameter of `apply` (`strict`, `mutate`, and `clone`). The rules of RFC 6902 always apply. The patch always runs on a copy, so the source document does not change.
- The `strict` parameter of `validateOperations`. The type of its `operations` parameter is now `unknown`.
- `JSONPatch.diff`, `JSONPatch.joinPointer`, and `JSONPatch.escapeSegmentPath`. No package code calls them. `diff` used the `compare` function of `fast-json-patch`, and it escaped a path prefix two times: `JSONPatch.diff({}, { x: 1 }, '/a~1b')` gave the path `/a~01b/x`.

The two method update paths, `DidMethodApi.applyPatch`, and the scenario tool of the test vectors call `apply` with no options.

### 6. The common tests run the JSON Patch test suite

The common package adds the JSON Patch test suite of the `json-patch/json-patch-tests` repository as a devDependency. The suite holds data only, under the Apache-2.0 license. The dependency names the commit `2a928f90` (2025-02-21), because the npm release 1.1.0 (2022) has only 91 enabled cases. The commit has 108 enabled cases.

`json-patch-test-suite.spec.ts` runs each enabled case. A case with `error` must fail with `JSON_PATCH_APPLY_ERROR`. A case with `expected` must give that document. The spec also checks that the suite has 108 enabled cases. The old engine failed 2 of the 108 cases.

### 7. Each judgment call conforms to the specification texts

| Judgment call | Text | Result |
|---|---|---|
| Remove the guard for `__proto__`, `constructor`, and `prototype`. | RFC 6901 section 4: "If the currently referenced value is a JSON object, the new referenced value is the object member with the name identified by the reference token." Resolve, Apply `update`: "Raise an [`INVALID_DID_UPDATE`] error if `update.patch` is malformed or fails to apply." | Conforms. A patch that names such a member is not malformed, and it applies. |
| An inherited JavaScript member does not exist. | RFC 6901 section 4 (the same text). RFC 6902 section 4.2: "The target location MUST exist for the operation to be successful." | Conforms. An inherited function is not a member of the JSON object. |
| A `remove` at `''` fails. | Update, Construct BTCR2 Unsigned Update: "Apply `jsonPatch` to `sourceDidDocument` to create `targetDidDocument`." RFC 6902 section 4.2: "The "remove" operation removes the value at the target location." | Conforms. After the root is removed, no document exists, so the patch fails to apply. Both method paths refused the patch before this change too. |
| A `move` to its own location makes no change after the `from` check. | RFC 6902 section 4.4: "This operation is functionally identical to a "remove" operation on the "from" location, followed immediately by an "add" operation at the target location with the value that was just removed." RFC 8259 section 1: "An object is an unordered collection of zero or more name/value pairs" | Conforms. A remove and an add at one location give the same value. Only the member order can be different, and the member order is not significant. JCS sorts the members, so the hash is the same. |
| A `test` compares with a list of pairs, not with recursion. | RFC 6902 section 4.6 (the object rule above). | Conforms. The result is the same, and a deep value cannot overflow the call stack. |
| A `value` must be an own member that is not `undefined`. | RFC 6902 section 4.1: "The operation object MUST contain a "value" member whose content specifies the value to be added." | Conforms. An inherited member is not a member of the operation object, and `undefined` has no JSON form. |
| The error data has `from` only for `move` and `copy`. | RFC 6902 section 4: "Members that are not explicitly defined for the operation in question MUST be ignored" | Conforms. A `from` in another operation is an ignored member. |
| A location that does not exist gives `path "<p>" does not exist`. Only the last token of an `add` in an array gives `"<t>" is not an array index (RFC 6901 section 4)`. | RFC 6901 section 4 (the array token rule). RFC 6902 section 4.2 (the rule above). | Conforms. The specification and the RFCs define no error text. Each case fails. |
| A thrown value that is not an `Error` gives a fixed text. A `toJSON` method of an operation value can throw such a value. | The specification and the RFCs define no error text. | Conforms. The text does not convert the thrown value to a string, so the text cannot throw. ADR 085 applies. |

## Alternatives

- **A wrap of `fast-json-patch` for each operation.** Rejected. The wrap needs its own pointer walk, its own equality, and its own bound checks, so it holds most of an engine. The library writes a member with an assignment, so a `__proto__` member stays refused or changes a prototype. The library has no release after 2022-03-24.
- **A check of the operations before `fast-json-patch` only.** Rejected. The existence of a location and the bound of an index depend on the document after the earlier operations. A check with no document cannot see them.
- **Another library.** Rejected. `rfc6902` 5.3.0, the most used other library, also applies `add /arr/01`, `add /arr/`, `add /x~2y`, `remove /o/toString`, and a `copy` past the end of an array.
- **Keep the guard and record it as a deviation.** Rejected. A patch that names such a member is not malformed, and it applies (decision 7). With the guard, the resolver of this library refuses an update that a conformant resolver applies.
- **Keep a lenient mode.** Rejected. No package code uses it, and the specification has no use for it. The scenario tool of the test vectors uses the source document if the apply fails.
- **Give `null` for a `remove` at `''`.** Rejected. RFC 6902 gives no result for it, and a `null` result hides the failure from a caller of `DidMethodApi.applyPatch`.
- **Use the npm release 1.1.0 of the test suite.** Rejected. It has 91 enabled cases. The 17 other cases test leading zeros, a `from` or a `remove` target that does not exist, and the replacement of the root.

## Consequences

- The common package gets a MAJOR release. A caller of a removed item, or of `apply` with options, must change its code. `apply` refuses or applies other patches.
- Both update paths refuse each patch that fails in the table with `INVALID_DID_UPDATE`, and they apply each patch that applies in the table. This changes the consensus in both directions: the library before and after this change gives different results for such an update. No user data exists yet. No test vector and no example of the specification holds such a patch.
- Each other patch gives the same result. A probe applied the 252 patch inputs of the test vectors with the two engines. 248 gave the same document, 4 failed with the two engines, and 0 were different. `verify-scenarios` gives the same PASS or FAIL for each of the 289 resolve cases as the last release. The example tool of the specification gives `14 files match`. The scenario tool gives the same target hash for its 3 scenarios with a patch that is not valid.
- The browser bundles no longer hold `fast-json-patch`: aggregation is 11 KB smaller, method 9 KB, and api 18 KB. The engine is 6.1 KB minified (2.3 KB gzip, with the error classes).
- A later vector pass can add a negative vector for one of the new refusals. Each negative vector needs a failure rule id.
- RFC 6902 section 4 says that operation objects "MUST have exactly one "op" member" and "exactly one "path" member". `JSON.parse` keeps only the last of two members with one name, so the engine cannot see a second `op` or `path` member. The same is true for two members with one name in a document.

**Superseded.**

- ADR 112, the `strict` option of `JSONPatch.apply`: the option, its default, and the plan to change the default. Decision 5 of this ADR removes the option, and the rules always apply. ADR 112 also says that `fast-json-patch` checks each operation against the document. Decision 2 of this ADR gives these checks to the own engine.
- ADR 139, decision 1: the copy with the `deepClone` function of `fast-json-patch`, and the `TypeError` of a copy that fails. The engine makes the same JSON copy with its own function, and a copy that fails gives `JSON_PATCH_APPLY_ERROR` (decision 1 of this ADR).
- ADR 139, decision 3: `describePatchFailure`. The engine knows the index of each operation, so the function is removed.

**Unchanged.**

- ADR 112: both update paths wrap a patch failure as `INVALID_DID_UPDATE` with `data.cause`. After the patch, they check the `id` and the conformance to DID Core.
- ADR 139, decision 2: the checks run on the JSON copy of the operations, and the patched document shares no object with the operations.
- ADR 144: `DidDocument` keeps a `__proto__` member as data. Decision 3 of this ADR applies the same rule to the patch.
- ADR 154, decision 5: `Updater.construct` checks the JCS form of the patch after `JSONPatch.apply`.

## Implementation

- `packages/common/src/json-patch.ts`: the engine (`resolvePointer`, `add`, `remove`, `replace`, `move`, `jsonEqual`, `jsonCopy`), `JSONPatch.apply`, `JSONPatch.validateOperations`, and the removals.
- `packages/common/package.json`, `pnpm-lock.yaml`: no `fast-json-patch`; the devDependency `json-patch-test-suite` at the commit `2a928f90`.
- `packages/method/src/core/updater.ts`: the call in `Updater.construct`, its comment, and its `@throws` tag.
- `packages/method/src/core/resolver.ts`: the call in `Resolver.applyUpdate` and its comment.
- `packages/api/src/method.ts`: the calls in `applyPatch` and `assertTargetCanSign`, and the JSDoc of `applyPatch`.
- `packages/api/lib/generate-scenario.ts`: `constructLenient` and the scenario loop.
- Tests: `packages/common/tests/json-patch.spec.ts` (the examples of RFC 6902 Appendix A and RFC 6901 section 5, the pointer syntax, the array tokens, own members, member names as data, equality, the move prefix, the index bound, the root, atomicity, and values with no JSON form), `packages/common/tests/json-patch-test-suite.spec.ts`, `packages/method/tests/updater.spec.ts`, `packages/method/tests/resolver.spec.ts`, and `packages/api/tests/did-method-api-offline-steps.spec.ts`.
- Docs: `packages/common/README.md`, `packages/method/README.md`, `packages/api/README.md`, and `packages/cli/docs/update.md`.

## References

- [did:btcr2 specification, Construct BTCR2 Unsigned Update](https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-unsigned-update) and [Apply `update`](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update).
- [RFC 6901, JavaScript Object Notation (JSON) Pointer](https://www.rfc-editor.org/rfc/rfc6901), sections 3, 4, and 5.
- [RFC 6902, JavaScript Object Notation (JSON) Patch](https://www.rfc-editor.org/rfc/rfc6902), sections 4, 4.1 to 4.6, 5, and Appendix A.
- [RFC 8259, The JavaScript Object Notation (JSON) Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259), section 1.
- [JSON Patch test suite](https://github.com/json-patch/json-patch-tests) at the commit `2a928f9044aad35c74e2788d498bcf2c6b91adea`.
- [ADR 085](085-typed-error-policy.md): typed errors.
- [ADR 112](112-update-paths-check-the-proof-fields-and-apply-the-patch-strictly.md): the strict patch and the `INVALID_DID_UPDATE` wrap of both update paths.
- [ADR 139](139-json-patch-apply-runs-the-patch-on-a-json-copy-of-the-operations.md): the JSON copy of the operations.
- [ADR 144](144-did-document-keeps-every-property-and-only-the-key-template-sets-the-initialkey-relationships.md): `DidDocument` keeps each property.
- [ADR 154](154-the-jcs-serializer-sorts-every-object-and-refuses-nan-infinity-and-a-lone-surrogate.md): the JCS serializer.
