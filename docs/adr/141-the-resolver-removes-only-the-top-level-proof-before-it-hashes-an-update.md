# ADR 141: The Resolver Removes Only the Top-Level Proof Before It Hashes an Update

- **Status:** Accepted
- **Date:** 2026-10-07
- **Packages:** `@did-btcr2/method` (PATCH: the hash in `update_hash_history` keeps each nested member named `proof`); `@did-btcr2/api` (PATCH: the browser bundle holds the method package)

## Context

The resolver hashes the unsigned form of each BTCR2 Signed Update at two algorithm steps of the specification (Resolve):

1. **Apply `update`.** "Create `unsigned_update` by removing the `proof` property from `update`, hash it with the JSON Document Hashing algorithm, and append the hash to `update_hash_history`."
2. **Confirm Duplicate Update.** The step uses the same words. It compares the hash with the entry of `update_hash_history` for the `targetVersionId` of the update.

The specification (Data Structures) defines a BTCR2 Signed Update as the properties of a BTCR2 Unsigned Update "and one additional property", `proof`. Thus both steps remove only that top-level property.

The two steps of the resolver did not agree:

- The Apply step used `JSONUtils.deleteKeys(update, ['proof'])`. That function removes each key named `proof` at each depth, also inside the `value` of a patch operation.
- The Confirm Duplicate step removed only the top-level `proof`.

A patch can add a member named `proof`, for example in a service:

```json
[
  {
    "op": "add",
    "path": "/service/-",
    "value": { "id": "did:btcr2:k1...#nested", "type": "LinkedDomains", "serviceEndpoint": "https://example.com", "proof": { "value": "a" } }
  }
]
```

For such an update, the two steps computed different hashes. If two Beacon Signals announced the same update, the resolver applied the update at the first signal. At the second signal, the hash did not match the history entry, and the resolver raised `LATE_PUBLISHING`. The DID did not resolve past that point.

## Decision

### 1. One function makes the hash of the unsigned update

`Resolver.unsignedUpdateHash` removes the top-level `proof` property with an object rest destructure. Then it hashes the result with `canonicalHashBytes`. The Apply step and the Confirm Duplicate step both call this function.

The specification uses the same words at the two steps. One function makes sure that the two steps cannot compute different hashes again.

### 2. A nested member named `proof` is data of the update

The hash keeps each member named `proof` below the top level. The member is part of the patch, and the signature of the update covers it. Thus two updates that differ only in a nested `proof` member have different hashes. A duplicate check that compares them raises `LATE_PUBLISHING`.

### 3. `JSONUtils.deleteKeys` stays in the common package

The resolver does not call `JSONUtils.deleteKeys` any more. No other source file in the packages calls it. This ADR does not remove the function from the common package, because its removal is a MAJOR change of the common package. A separate change removes it.

## Alternatives

- **An inline destructure at the Apply step only.** Rejected. The fix is the same, but the two steps keep two copies of one rule. A later change to one copy can make the steps disagree again.
- **A deep removal at both steps.** Rejected. The specification removes only the top-level `proof` property. Also, two updates that differ only in a nested `proof` member then get the same hash, and the resolver confirms one as a duplicate of the other.

## Consequences

- An update whose patch holds a member named `proof` now resolves when two or more Beacon Signals announce it. Before, the second signal raised `LATE_PUBLISHING`.
- An update with no nested `proof` member gets the same hash as before. The fix does not change the result of such a resolution.
- `update_hash_history` now holds the hash that the specification defines. A different implementation that follows the specification computes the same history.

## Implementation

- `packages/method/src/core/resolver.ts`: `Resolver.unsignedUpdateHash`; the calls in `confirmDuplicate` and in the Apply arm of step 6.
- `packages/method/tests/resolver.spec.ts`: the tests "the top-level proof of the update (ADR 141)".

## References

- [did:btcr2 specification, Apply `update`](https://dcdpr.github.io/did-btcr2/operations/resolve.html#apply-update) and [Confirm Duplicate Update](https://dcdpr.github.io/did-btcr2/operations/resolve.html#confirm-duplicate-update).
- [did:btcr2 specification, BTCR2 Signed Update](https://dcdpr.github.io/did-btcr2/data-structures.html#btcr2-signed-update).
- [ADR 139](139-json-patch-apply-runs-the-patch-on-a-json-copy-of-the-operations.md): the resolver hashes the update as received.
