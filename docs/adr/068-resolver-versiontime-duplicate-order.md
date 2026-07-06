---
title: "ADR 068: versionTime Evaluation Order for Duplicates and Guarded Duplicate Confirmation"
---

# ADR 068: versionTime Evaluation Order for Duplicates and Guarded Duplicate Confirmation

**Status:** Accepted

**Date:** 2026-07-06

**Branch / PR:** `fix/resolver-duplicate-edges`

**References:** [ADR 055](055-resolver-provide-trust-boundary.md), [ADR 060](060-resolver-cross-round-version-continuity.md), [ADR 067](067-resolver-duplicate-confirmation.md), [did:btcr2 Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [W3C DID Resolution](https://w3c.github.io/did-resolution/)

## Context

[ADR 067](067-resolver-duplicate-confirmation.md) fixed how a confirmed duplicate update
affects the version counter and the update-hash history, and recorded two adjacent
pre-existing edges as out of scope. This ADR closes both. Each was reproduced empirically
against the published build before being fixed, and each traces back to the specification
text, so both extend the erratum conversation ADR 067 opened.

### Edge 1: an out-of-order duplicate truncates a versionTime query

The read algorithm sorts the updates array by `targetVersionId` first, block height second.
A duplicate re-announcement of an early version that was mined *after* the queried
`versionTime` therefore sorts *ahead of* a genuine later update mined *before* it. The
spec's "Process updates Array" evaluates the versionTime early-return as step 3, before
step 4 dispatches to duplicate-confirmation / apply / late-publishing, so the over-window
duplicate ends resolution before the genuine in-window update is ever processed.

Reproduced trace: version 2 applied November 2023; a duplicate of that update re-announced
in 2030; a genuine version 3 mined December 2024; `versionTime: 2025-01-01`. The resolver
returned version **2** instead of the correct **3**, silently dropping the in-window update,
and stamped `metadata.updated` with the duplicate's 2030 blocktime, itself past the
requested versionTime. No error is raised; the answer is simply wrong.

This contradicts the spec's own definition of `versionTime` ("the most recent version of
the DID document that was valid for the DID before the specified versionTime"): an
announcement mined after the query point cannot change which versions were valid before
it. The spec has no language about how versionTime interacts with duplicates; the
implementation faithfully transcribed the step order and inherited the defect. The same
redundancy and replay patterns that make duplicates reachable (ADR 067's context: one
update announced on two of a DID's own derivable beacons, or a third-party OP_RETURN
replay) make this reachable for any resolver offering versionTime queries.

### Edge 2: duplicate confirmation crashes on a crafted targetVersionId

"Confirm Duplicate Update" indexes `update_hash_history[targetVersionId - 2]` with no
bound check, in the spec and in this implementation. The duplicate branch admits any
`targetVersionId <= current_version_id`, and the update data structure never restates
that `targetVersionId` must be an integer of at least 2 (it is only implied by "MUST be
one more than the versionId of the DID document being updated"). A crafted update object
carrying `targetVersionId: 1` (or 0, a negative, or a fractional value below the current
version) enters the duplicate branch, reads an undefined history slot, and crashes the
byte comparison with a raw `TypeError: Cannot read properties of undefined (reading
'length')` - not the typed `ResolveError` resolver callers handle. Reproduced with a
sidecar entry plus a single beacon signal carrying the crafted update's hash; the
content-hash binding of [ADR 055](055-resolver-provide-trust-boundary.md) is satisfied
because the signal commits to the crafted update itself.

## Decision

### 1. Confirm duplicates before evaluating versionTime

The duplicate branch now runs before the versionTime early-return. A tuple that
re-announces an already-applied version is confirmed against the update-hash history and
skipped whatever its blocktime; the versionTime check gates only the state-changing paths
(apply and late-publishing). The reproduced trace now resolves to version 3.

The rule this encodes: **versionTime is a view over the history, not an integrity
waiver.** Confirming over-window duplicates rather than skipping them keeps late-publishing
detection intact: a *false* duplicate (different content claiming an already-applied
version) mined after versionTime now fails resolution with `LATE_PUBLISHING_ERROR`, where
the previous order silently hid the equivocation evidence behind the early return. That
strengthening is deliberate, and it is scoped to the window: evidence that an
already-applied portion of the history is equivocal taints every answer about that
portion, including answers about the past. Equivocation confined entirely to
announcements after versionTime (competing updates for a version never applied in the
window, or an over-window gap update) remains outside the view: only tuples that reach
the duplicate branch are integrity-checked past versionTime, and every other over-window
tuple still ends resolution cleanly at the early return, exactly as before.

This is a deviation from the current spec step order (versionTime at step 3, dispatch at
step 4), taken for the same reason as ADR 067's increment deviation and pursued in the
same erratum conversation: evaluate the versionTime return after (or scoped to exclude)
the duplicate branch.

### 2. Guard the duplicate-confirmation history read

`confirmDuplicate` now validates before indexing:

- a `targetVersionId` that is not an integer or is below 2 cannot name an applied update;
  it is a malformed update, not a duplicate, and raises `INVALID_DID_UPDATE`;
- an integer `targetVersionId` of at least 2 whose history slot does not exist (reachable
  only by standalone `Resolver.updates()` callers passing a resolution state whose version
  counter outruns its history) is an *unconfirmable duplicate*, which is late-publishing
  evidence, and raises `LATE_PUBLISHING_ERROR`.

Through the resolver's own loop the slot always exists for conformant duplicates: the
apply path records one history entry per version, so any integer `targetVersionId` between
2 and the current version indexes a recorded hash. The guard converts the crash into the
typed errors the API contracts already promise.

### 3. Reject malformed targetVersionId at the provide() boundary

The `provide()` shape guard for signed updates now requires `targetVersionId` to be an
integer of at least 2, extending the fail-fast validation of
[ADR 055](055-resolver-provide-trust-boundary.md). Sidecar-supplied updates bypass
`provide()`, so the `confirmDuplicate` guard above remains the reliable last line; the
boundary check just fails the interactive path earlier with the existing "not a signed
BTCR2 update" error.

### Verification

Six regression tests cover the reproduced traces and the guards: the over-window-duplicate
versionTime query resolves to the correct version; an over-window false duplicate fails as
late publishing; crafted `targetVersionId` values of 1 and 0.5 raise `INVALID_DID_UPDATE`
rather than `TypeError`; a standalone `updates()` call with a counter that outruns its
history raises `LATE_PUBLISHING_ERROR`; and `provide()` rejects the malformed update at
the boundary. As a negative control the same six tests were run against the previous
release's resolver: all six fail there (wrong version, hidden equivocation, and raw
TypeErrors), confirming they exercise the defects rather than passing vacuously. The full
method suite passes unchanged, including the existing test that a *genuine* update mined
after versionTime still ends resolution at the version valid before it.

## Consequences

- versionTime queries return the version actually valid at the query point even when the
  on-chain history contains out-of-order duplicate re-announcements.
- A false duplicate of an in-window version mined after versionTime now fails resolution
  with `LATE_PUBLISHING_ERROR` instead of being masked by the early return. Callers that
  somehow relied on the masking will see a new error; that behavior was hiding
  equivocation evidence.
- The strengthened detection does not extend past the window: two competing over-window
  updates for a version never applied in the window, or an over-window gap update, still
  end resolution cleanly at the early return, so a versionTime query and a full resolution
  of the same DID can still disagree about history trustworthiness in that residual case
  (the same is true of versionId-limited queries, whose early return precedes any later
  duplicate confirmation). Closing that residual would make every time-scoped query a full
  resolution and is not attempted here.
- Malformed `targetVersionId` values surface as typed `ResolveError`s
  (`INVALID_DID_UPDATE` / `LATE_PUBLISHING_ERROR`) at the duplicate branch and are
  rejected outright at the `provide()` boundary, instead of crashing with a `TypeError`.
- The resolution metadata stamping is unchanged: `metadata.updated`/`confirmations` are
  still set from each processed tuple's block, so a versionTime early-return on a genuine
  over-window update still reports that update's block metadata. Refining those fields is
  the still-open follow-up recorded in ADR 067.
- This is a behavior change to resolution output for versionTime queries over histories
  containing duplicates. Under semantic versioning on a `0.x` line it is released as a
  minor bump.
- Two further erratum points join the ADR 067 conversation upstream: reorder (or scope)
  the versionTime step relative to duplicate confirmation, and add an existence guard to
  "Confirm Duplicate Update" together with an explicit integer >= 2 constraint on
  `targetVersionId`.

## Rejected alternatives

- **Skip over-window duplicates without confirming them.** Preserves a strict "events
  after versionTime are invisible" reading, but hides equivocation evidence about versions
  that were applied within the window, evidence a full resolution of the same DID would
  surface as `LATE_PUBLISHING_ERROR`. A time-scoped view should not report a version when
  the in-window history it reports on is provably equivocal. (Equivocation confined
  entirely beyond the window is masked by the retained early return under either design;
  see Consequences.)
- **Pre-filter over-window tuples before the loop.** Equivalent for genuine linear
  histories, but it silently discards over-window false duplicates (same objection as
  above) and restructures the loop further from the spec text than the one-block move.
- **A single error code for the confirmDuplicate guard.** Folding both guard failures into
  `LATE_PUBLISHING_ERROR` would mislabel a malformed field as an integrity finding.
  A `targetVersionId` below 2 violates the update data structure's construction rule and
  is `INVALID_DID_UPDATE`; only the missing-history-slot case is genuinely an
  unconfirmable duplicate.
- **Guard only at the provide() boundary.** Sidecar-supplied updates never pass through
  `provide()`, and standalone `updates()` callers bypass the resolver entirely, so a
  boundary-only guard leaves the crash reachable. The point-of-use guard is the one that
  cannot be bypassed.

## Out of scope

Carrying `metadata.updated`/`confirmations` across discovery rounds so they track only
real state changes (the follow-up recorded in [ADR 067](067-resolver-duplicate-confirmation.md))
remains open; this change does not touch the metadata stamping. The cross-round version
continuity model ([ADR 060](060-resolver-cross-round-version-continuity.md)) and the
duplicate counter/history semantics (ADR 067) are unchanged.
