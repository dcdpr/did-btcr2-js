---
title: "ADR 067: Resolver Duplicate-Update Confirmation - Conditional Increment and Compare-Only History"
---

# ADR 067: Resolver Duplicate-Update Confirmation - Conditional Increment and Compare-Only History

**Status:** Accepted

**Date:** 2026-07-02

**Branch / PR:** `fix/resolver-duplicate-handling`

**References:** [ADR 016](016-sans-io-resolver.md), [ADR 055](055-resolver-provide-trust-boundary.md), [ADR 060](060-resolver-cross-round-version-continuity.md), [did:btcr2 Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [W3C DID Resolution](https://w3c.github.io/did-resolution/)

## Context

The did:btcr2 read algorithm processes beacon signals in a loop, keeping two pieces of
loop-invariant state: a monotonic `current_version_id` (starting at 1) and an
`update_hash_history`. For each signal's update it compares `targetVersionId` against
`current_version_id`:

- `targetVersionId <= current_version_id`: the update re-announces a version that was
  already applied. It is a **duplicate**. The "Confirm Duplicate Update" step re-derives the
  unsigned-update hash and checks it against the history, then moves on. A duplicate is not
  an error: the same update can legitimately appear more than once on chain.
- `targetVersionId == current_version_id + 1`: the next update in the linear history. Apply it.
- `targetVersionId > current_version_id + 1`: a version was skipped, which indicates late
  publishing. Raise `LATE_PUBLISHING_ERROR`.

Duplicates are readily reachable, and not only through a non-conformant writer. A deterministic
KEY (k1) DID derives three Singleton beacons (P2PKH, P2WPKH, P2TR) from its one key, at
distinct, publicly-derivable addresses. Announcing the same update on two of a controller's own
beacons is a plausible redundancy pattern; a third party can also replay a 32-byte update hash
in an `OP_RETURN` at a second derivable beacon address. Signal discovery has no per-update
dedup and `SingletonBeacon.processSignals` emits one tuple per signal, so each announcement
reaches the update loop as a genuine duplicate whose content-hash binding ([ADR 055](055-resolver-provide-trust-boundary.md)) is satisfied - the duplicate really is the update.

Two questions decide how a duplicate is handled, and the specification, its reference
implementation, and this implementation disagreed on both:

| point | current spec prose | reference Rust impl | this impl (before this change) |
|---|---|---|---|
| (a) increment the version counter after a confirmed duplicate | unconditional (a flat "Process updates Array" list whose "Increment current_version_id" is a sibling step of the duplicate/apply check) | conditional (increments only inside the apply branch) | unconditional |
| (b) append to `update_hash_history` in the duplicate branch | compare-only, no append (the history is defined to hold unsigned-update hashes only) | pushes the contemporary document hash | pushed the contemporary document hash |

This implementation was a broken hybrid: the spec's unconditional increment (a) combined with
the reference impl's contemporary-hash push (b).

The provenance explains the split. The duplicate push descends from the predecessor did:btc1
method, where the increment was conditional and the duplicate branch did push. The did:btcr2
rewrite reversed **both** in the prose (unconditional increment, compare-only history), but the
reference Rust implementation kept the did:btc1 shape. This implementation adopted the spec's
(a) and the reference impl's (b), taking the one combination that is wrong on both counts.

### Why the hybrid is wrong, with traces

Trace `[v2, v2-dup, v3]` (a v2 update, a duplicate of v2, then a genuine v3):

- v2 applies; `current_version_id` becomes 2.
- v2-dup enters the duplicate branch. The unconditional increment (a) then advances
  `current_version_id` to 3, and the push (b) appends the current document hash to the history.
- v3 arrives with `targetVersionId` 3. Because the counter was inflated to 3, `3 <= 3` routes
  v3 into the duplicate branch. Confirmation reads a history slot that holds a document hash,
  not v3's unsigned-update hash, so it raises a **false** `LATE_PUBLISHING_ERROR`. A perfectly
  linear history is bricked by one duplicate.

Observable effects, both reproduced against the compiled build: `metadata.versionId` inflates
by one per duplicate (a v2 document reported as v3), and the next genuine update fails to
resolve. The failure also survives across discovery rounds: a v3 announced on a beacon that v2
added (discovered a round later) fails the same way when v2 is redundantly re-announced there.

Neither maintainer combination is fully correct either. The spec prose (unconditional increment
+ compare-only) still bricks `[v2, v2-dup, v3]`, because the increment alone inflates the
counter. The reference impl (conditional increment + contemporary-hash push) instead bricks
`[v2, v2-dup, v3, v3-dup]`, because the pushed document hashes misalign the history index once
duplicates of two different non-final versions appear.

[ADR 060](060-resolver-cross-round-version-continuity.md) deliberately left this question open
under its "Out of scope": it carried the version counter and history across discovery rounds
without changing how they respond to a duplicate. This ADR is that change.

## Decision

Adopt the one combination that handles every duplicate pattern - conditional increment plus
compare-only history:

### 1. Increment the version counter only on the apply path

A confirmed duplicate calls the confirmation step and then continues to the next tuple. It does
**not** advance `current_version_id`. The increment, and the `metadata.versionId` it produces,
run only when an update is actually applied. This removes the version inflation and the false
`LATE_PUBLISHING_ERROR` that followed it, both in a single discovery round and across rounds
(the counter and history carried by [ADR 060](060-resolver-cross-round-version-continuity.md)
now stay correct when a later round re-encounters an already-applied version).

### 2. Confirm duplicates against the history without appending to it

The duplicate branch compares the unsigned-update hash against
`update_hash_history[targetVersionId - 2]` and appends nothing. That slot already holds the
applied update for the duplicated version - the apply path recorded it - so the historical
contemporary-hash push is unnecessary and, as the traces show, harmful. The history holds
unsigned-update hashes only, matching the spec's definition.

Together, (1) and (2) are the increment fix from the reference implementation combined with the
compare-only history from the specification prose. This is a deliberate deviation from the
current spec text on point (a): the spec's "Increment current_version_id" is treated as
belonging to the apply branch, not to every tuple. The deviation is being pursued as an erratum
to the did:btcr2 specification (move the increment into the apply step) and as a fix to the
reference implementation (drop the duplicate-branch push); until those land, this implementation
carries the traced deviation, with a code comment at the site pointing here.

### 3. Scope: the document-metadata timestamps are left unchanged

`metadata.updated` and `metadata.confirmations` continue to be set from each processed signal's
block, exactly as before this change. Only the version counter and `metadata.versionId` are
gated to the apply path. This keeps the change confined to the duplicate-confirmation defect and
avoids a regression in the sans-I/O resolver's multi-round design (see Rejected alternatives).
As a consequence, `metadata.updated`/`confirmations` still reflect the block of the last signal
processed, which for a resolution ending on a duplicate is that duplicate's block. Refining
those fields to track only real state changes is a separate, larger change and is left out of
scope.

### Verification

The behavior is proven in both directions. The regression tests resolve `[v2, v2-dup, v3]`,
`[v2, v2-dup, v3, v3-dup]`, and `[v2, v3, v3-dup]` to the correct final version, assert a
duplicate does not inflate `versionId`, exercise one update announced on two of a k1 DID's own
beacons, and exercise a cross-round duplicate re-announced on a beacon an earlier update added.
As a negative control, the same tests were run against the pre-change `updates()` and six of the
seven fail (versionId inflation and thrown false `LATE_PUBLISHING_ERROR`), which confirms they
exercise the defect rather than passing vacuously. The confirmation guard still rejects a genuine
mismatch: an update that claims an already-used `targetVersionId` but carries different content
is still rejected as invalid (the seventh test, which passes under both old and new code).

## Consequences

- A linear history that includes a duplicate re-announcement now resolves, instead of failing
  with a false `LATE_PUBLISHING_ERROR`, in a single round and across discovery rounds. This is
  the headline fix.
- `metadata.versionId` reports the document's true version regardless of how many times updates
  were re-announced; a duplicate no longer inflates it.
- The `update_hash_history` holds only unsigned-update hashes, matching the spec's definition
  and making duplicate confirmation index-correct for duplicates of any non-final version.
- `metadata.updated` and `metadata.confirmations` are unchanged by this fix; their existing
  behavior (reflecting the block of the last processed signal) is preserved.
- This is a behavior change to resolution output for inputs that contain duplicates. Under
  semantic versioning on a `0.x` line it is released as a minor bump.
- The implementation now deviates from the current did:btcr2 spec prose on point (a) by design.
  The deviation, its rationale, and the traces are recorded here, and the code comment at the
  duplicate branch references this ADR so the deviation is discoverable at the site.

## Rejected alternatives

- **Keep the spec prose exactly (unconditional increment + compare-only).** Rejected: it bricks
  `[v2, v2-dup, v3]`. The unconditional increment inflates the counter on the duplicate, so the
  next genuine update is misread as a duplicate against an index that does not hold its hash.
- **Match the reference implementation exactly (conditional increment + contemporary-hash push).**
  Rejected: it bricks `[v2, v2-dup, v3, v3-dup]`. Once duplicates of two different non-final
  versions appear, the pushed document hashes shift the history index out of alignment with the
  `targetVersionId - 2` read.
- **Drop only the duplicate-branch push, keep the unconditional increment.** This is the shape a
  prior local audit reached. Rejected: removing the push alone is insufficient, because the
  unconditional increment on a duplicate still inflates the counter and false-trips
  `LATE_PUBLISHING_ERROR` on the following genuine update. The two changes are needed together.
- **Set `metadata.updated`/`confirmations` only on the apply path, so a duplicate cannot move
  them.** This looks more faithful to the W3C meaning of `updated` (the last operation that
  changed the document), and it was tried. Rejected for this change: the sans-I/O resolver runs
  `updates()` once per discovery round with a freshly initialized response, so a discovery round
  that processes only duplicates applies nothing and returns empty `updated`/zero `confirmations`,
  discarding the real last-apply metadata carried from an earlier round. This was reproduced: a
  two-round resolution whose second round is a duplicate-only re-announcement returned
  `updated: ""`, `confirmations: 0`. Making the apply-only placement correct would require
  carrying the timestamp and confirmation metadata across rounds, a larger change orthogonal to
  the duplicate-confirmation defect. It is left as a possible follow-up (see Out of scope).

## Out of scope

- **Document-metadata timestamp semantics.** As above, `metadata.updated`/`confirmations` are
  left as-is. A follow-up could carry them across discovery rounds and set them only on real
  applies so a duplicate or third-party replay cannot move them.
- **`versionTime` interaction with an out-of-order duplicate.** Updates are sorted by
  `targetVersionId` first, so a duplicate of an early version that was mined *after* a genuine
  later update sorts *before* that later update. Under a `versionTime` query, the duplicate's
  block can trip the `versionTime` early-return before the genuine in-window update is applied,
  returning an earlier version than the one valid at `versionTime`. This is pre-existing (present
  before and after this change) and left for a separate review.
- **`confirmDuplicate` index underflow.** `confirmDuplicate` reads
  `update_hash_history[targetVersionId - 2]` directly. A malformed update crafted with
  `targetVersionId` below 2 would index before the start of the history; conformant updates
  (whose `targetVersionId` is at least 2) never reach it, and hardening that index is left to a
  separate change.

This ADR does not alter cross-round version continuity
([ADR 060](060-resolver-cross-round-version-continuity.md)) or the `provide()` trust boundary
([ADR 055](055-resolver-provide-trust-boundary.md)); it changes only how a confirmed duplicate
affects the version counter and the update-hash history.
