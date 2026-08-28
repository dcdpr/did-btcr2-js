# ADR 094: Deactivation is an ordinary update carrying the deactivation patch

- **Status:** Accepted
- **Date:** 2026-08-28
- **Packages:** `@did-btcr2/api`

## Context

Of the four CRUD operations, deactivation was the only one the api facade did not perform. `DidMethodApi.deactivate()` was a parameterless stub that threw `NotImplementedError` with the message "not yet implemented in the core method", and the main `DidBtcr2Api` facade had no `deactivateDid` at all. A caller wanting to retire a DID had to know the encoding of deactivation and hand-roll it through `updateDid`.

The stub's message was also wrong about where the gap was. The did:btcr2 specification does not define deactivation as a distinct protocol primitive: the DID controller adds a `deactivated: true` property to the DID document via an ordinary DID update, and resolvers treat the flag as terminal. The core `method` package already implements both halves of that contract:

- The write path needs nothing new. The `Updater` state machine applies arbitrary JSON Patch operations; `{ op: 'add', path: '/deactivated', value: true }` is just another patch.
- The read path already honours the flag. `Resolver` checks `didDocument.deactivated` after applying each update, sets `metadata.deactivated`, and stops processing further updates (`resolver.ts`, the deactivation check in the update-application loop).

So "not implemented in the core method" was false; the only missing piece was the api-layer composition.

One hazard is specific to deactivation. The operation is irreversible by construction: once a resolver applies the deactivating update it halts, so no later update, whatever it says, will ever be read. Deactivating an already-deactivated document therefore signs and broadcasts a well-formed update, spends real beacon UTXOs, and produces an artifact that no conformant resolver can ever observe. Nothing in the generic update path refuses this, because to the update path it is just another version bump.

## Decision

**Deactivation is exposed as a first-class facade operation implemented as composition over `update()`, not as a new primitive.**

Three parts:

**The patch is a named constant.** `DidMethodApi.DEACTIVATION_PATCH` is a frozen `Readonly<PatchOperation>` holding `{ op: 'add', path: '/deactivated', value: true }`. Callers who drive `update()` or the `Updater` directly can reference the canonical encoding instead of restating it; the deactivate path spreads a copy into its patches array so the frozen original is never handed to code that might mutate it.

**`DidMethodApi.deactivate(params)` delegates to `update()`.** Its parameters are exactly `update()`'s minus `patches`, which it supplies itself. Signing, the CAS publication policy, funding checks, and the beacon broadcast are all inherited from the update path unchanged, and the return type is the same `DidUpdateResult`.

**An already-deactivated source document is refused up-front.** `deactivate()` throws `UpdateError` before signing when `sourceDocument.deactivated` is set. This is the one behaviour that distinguishes deactivation from a generic update, for the irreversibility reason above: the second deactivation could never be read back, so proceeding would only burn a UTXO to announce an invisible artifact.

**`DidBtcr2Api.deactivateDid(params)` mirrors `updateDid` minus `patches`.** It resolves the current document and version when the caller does not supply them, then delegates to `DidMethodApi.deactivate`. The previously inline resolve-the-source block in `updateDid` moved verbatim into a private `#resolveUpdateSource` helper shared by both operations, so the auto-resolution semantics cannot drift between them.

## Scope boundary

**No change to the `method` package.** The resolver's deactivation handling predates this ADR and is untouched; the `Updater` continues to treat the deactivating update as an ordinary update. All new code is api-layer composition.

**The already-deactivated guard checks only what it is given.** It inspects the source document in hand, whether supplied by the caller or auto-resolved. A caller who passes a stale or doctored `sourceDocument` with the flag absent can still broadcast a second deactivation; guarding against that would require re-resolving on every call, defeating the sidecar-friendly explicit-source path. The guard closes the accidental case, not the adversarial one.

**Deactivation through aggregated beacons follows the same rule as updates.** Multi-party SMT/CAS cohorts drive the `Updater` directly and delegate broadcast to the aggregation runner; they can use `DEACTIVATION_PATCH` but not `deactivate()`, exactly as they use the `Updater` but not `update()`.

## Consequences

**Positive.** The facade now covers the full CRUD cycle; retiring a DID is one call with the same shape as updating it. The irreversibility footgun (paying to broadcast an unreadable second deactivation) is closed on the supported path. `#resolveUpdateSource` gives update and deactivate provably identical auto-resolution behaviour and a single place to extend it.

**Negative.** The `NotImplementedError` contract of the old stub is gone; the one test that pinned it was replaced. Any caller who probed `deactivate` to detect "not supported" (none exist in this repository) would now trigger a real broadcast path. Rides the api MINOR that carries this branch under the 0.x convention.

**Neutral.** Deactivation remains representable as a plain `updateDid` call with the same patch; the new methods add a named, guarded route rather than a new capability.

## Implementation

- `packages/api/src/method.ts`: `DEACTIVATION_PATCH` static; `deactivate(params)` replacing the stub; `NotImplementedError` import dropped.
- `packages/api/src/api.ts`: `deactivateDid(params)`; `#resolveUpdateSource` extracted verbatim from `updateDid` and shared.
- Tests: the stub-pinning test replaced by coverage of the patch constant's shape and frozenness, the already-deactivated refusal, and delegation to `update()` with exactly the deactivation patch; facade tests for empty-DID rejection, already-deactivated refusal, and the post-dispose guard.

## References

- ADR 073: CAS publication policy (`publishToCas`), inherited unchanged by `deactivate()`.
- ADR 093: DID network inheritance; the same review produced both findings.
- `docs/api-crud-review.md`: the api CRUD review that surfaced this, as gap G2.
