# ADR 139: JSONPatch.apply Runs the Patch on a JSON Copy of the Operations

- **Status:** Accepted
- **Date:** 2026-10-07
- **Packages:** `@did-btcr2/common` (PATCH: `JSONPatch.apply` copies the operations, and the error message names the correct operation index); `@did-btcr2/method`, `@did-btcr2/api`, `@did-btcr2/aggregation` (PATCH: dependency uptake; the browser bundle of each package holds the common package)

## Context

`JSONPatch.apply` in the common package gave the operations to fast-json-patch with no copy. For `add` and `replace`, fast-json-patch writes `operation.value` into the document by reference. Thus the patched document and the operation share that object. A later operation that writes inside the object also changes the operation.

An example patch with two operations:

```json
[
  { "op": "add", "path": "/alsoKnownAs", "value": ["https://a.example"] },
  { "op": "add", "path": "/alsoKnownAs/-", "value": "https://b.example" }
]
```

After the apply, the `value` of the first operation is `["https://a.example", "https://b.example"]`.

The specification (Update, Construct BTCR2 Unsigned Update) embeds the patch as given: "`jsonPatch` embedded as JSON". The specification (Resolve, Apply `update`) hashes the update as received and appends the hash to `update_hash_history`. The defect broke both rules:

1. **The write path.** `Updater.construct` puts the patch array in the unsigned update. Then it gives the same array to `JSONPatch.apply` and computes `targetHash` from the result. The apply changed the embedded patch, so the signed patch did not give `targetHash`. In the example, a resolver adds the array with two items and then appends a third item. The hash does not match, and each resolver raises `INVALID_DID_UPDATE`. If the controller announces such an update, the DID does not resolve past it.
2. **The read path.** `Resolver.applyUpdate` gives `update.patch` to `JSONPatch.apply`. The apply changed the update in the sidecar data of the caller. Then the resolver hashed the changed update into `update_hash_history`. A later Beacon Signal that announces the same update has the hash of the update as received. That hash was not in the history, so the resolver raised `LATE_PUBLISHING`. A second resolve with the same sidecar object did not find the update, because the hash of the changed update did not match the announced hash.

A second defect was in the error message of a failed patch. fast-json-patch 3.1.1 calls its operation validator with the index 0 for each operation. Thus each failure of a path check said "at operation 0", also for a later operation.

## Decision

### 1. The patch runs on a JSON copy of the operations

`JSONPatch.apply` makes a copy of the operations with the `deepClone` function of fast-json-patch. That function is a JSON round trip (`JSON.parse(JSON.stringify(...))`). fast-json-patch applies the copy. The operations of the caller stay unchanged, and the patched document shares no object with them.

The copy is a JSON copy because the signed update carries the JSON form of the patch. A `Date` value becomes its ISO string. An object with a `toJSON` method becomes the result of that method. A resolver applies the JSON form. Thus the updater and each resolver apply the same values and compute the same `targetHash`.

The copy is outside the `try` block, like the copy of the document. A value with a cycle or a `BigInt` value makes the copy throw a `TypeError`. `Updater.construct` and `Resolver.applyUpdate` wrap each error as `INVALID_DID_UPDATE` ([ADR 112](112-update-paths-check-the-proof-fields-and-apply-the-patch-strictly.md)).

### 2. The checks run on the copy

`validateOperations` checks the copy, not the given operations. An operation object with a `toJSON` method can show a safe `path` to a check on the given operations. Its JSON form can have the path `/constructor/keys`. The check on the copy sees the path that fast-json-patch applies.

### 3. The error message names the correct operation index

`describePatchFailure` gets the index from the position of the failing operation in the copy. If the error carries no operation of the copy, the message uses the index of the error, as before.

## Alternatives

- **A `structuredClone` of the operations.** Rejected. A `structuredClone` copies the own properties of a class instance and drops its `toJSON` method. Thus the updater applies the own properties, and the signed update carries the result of `toJSON`. The two forms can give different documents. The advantage of `structuredClone` is that the strict mode keeps the refusal of a nested `undefined`.
- **A copy in `Updater.construct` and `Resolver.applyUpdate` only.** Rejected. Each caller of `JSONPatch.apply` had the defect, for example `DidMethodApi.applyPatch`. One copy in the common package removes it for each caller.

## Consequences

- An update whose patch writes inside an added value now resolves. Before, the write path embedded a changed patch, and each resolver refused the update with `INVALID_DID_UPDATE`.
- The resolver hashes the update as received. A duplicate of such an update is confirmed, and a second resolve with the same sidecar object finds the update.
- Each apply makes one more JSON round trip, of the operations. A patch of a DID document is small, so the cost is low.
- The strict mode does not refuse a nested `undefined` any more. The JSON copy drops it: `{ "a": undefined }` adds `{}`, and `[undefined]` adds `[null]`. The signed update drops it in the same way, so the two paths agree. A `value` that is `undefined` at the top level still fails, because the copy has no `value`.
- `Updater.construct` still embeds the patch array of the caller, not a copy. The library does not write to the array any more. If the caller changes the array after `construct`, the update changes too. This behavior is not new.

## Implementation

- `packages/common/src/json-patch.ts`: `JSONPatch.apply` (the copy `opsClone`; the checks on the copy), `describePatchFailure` (the index).
- `packages/common/tests/json-patch.spec.ts`: the tests "a JSON copy of the operations (ADR 139)".
- `packages/method/tests/updater.spec.ts`: the tests "the embedded patch (ADR 139)".
- `packages/method/tests/resolver.spec.ts`: the tests "the update as received (ADR 139)".
- `packages/common/README.md`: one comment line in the Quick Start.

## References

- [did:btcr2 specification, Construct BTCR2 Unsigned Update](https://dcdpr.github.io/did-btcr2/operations/update.html#construct-btcr2-unsigned-update).
- [did:btcr2 specification, Apply `update`](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update) and [Confirm Duplicate Update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#confirm-duplicate-update).
- [RFC 6902, JavaScript Object Notation (JSON) Patch](https://datatracker.ietf.org/doc/html/rfc6902).
- [ADR 112](112-update-paths-check-the-proof-fields-and-apply-the-patch-strictly.md): the strict apply and the `INVALID_DID_UPDATE` wrap of both update paths.
