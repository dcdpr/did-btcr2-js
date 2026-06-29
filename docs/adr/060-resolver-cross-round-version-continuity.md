---
title: "ADR 060: Carry the Version Counter and Update-Hash History Across Resolver Discovery Rounds"
---

# ADR 060: Carry the Version Counter and Update-Hash History Across Resolver Discovery Rounds

**Status:** Accepted

**Date:** 2026-06-29

**Branch / PR:** `fix/resolver-cross-round-versioning`

**References:** [ADR 016](016-sans-io-resolver.md), [ADR 059](059-unbounded-beacon-discovery-default.md), [did:btcr2 Resolve](https://dcdpr.github.io/did-btcr2/operations/resolve.html), [W3C DID Resolution](https://w3c.github.io/did-resolution/)

## Context

The did:btcr2 read algorithm resolves a DID by processing beacon signals in a single
loop. It keeps two pieces of state for the whole loop: a monotonic `current_version_id`
(starting at 1) and an `update_hash_history` (appended to as each update is applied, and
indexed when confirming a duplicate). On every pass it re-derives the beacon set from the
contemporary DID document, so a beacon added by one update is searched on the next pass.
The version counter and the history are therefore loop-invariant: they span the entire
resolution, including signals found on beacons that earlier updates introduced.

This implementation's `Resolver` ([ADR 016](016-sans-io-resolver.md)) is a sans-I/O state
machine. It cannot block to fetch signals, so it splits that one loop into discovery
**rounds**: apply the updates found so far, look for beacon services those updates added,
then loop back to request their signals. The per-round update application lived entirely
inside the static `Resolver.updates()`, which initialized `currentVersionId = 1` and a
fresh `updateHashHistory = []` on **every** call. The two pieces of state the spec keeps
for the whole loop were being reset once per round.

The consequence is a real resolution failure. Consider a legitimate linear history:

- genesis is version 1, on the genesis beacon;
- an update takes v1 to v2 and adds beacon B, announced on the genesis beacon;
- an update takes v2 to v3, announced on beacon B.

Round one finds the v2 update, applies it (`currentVersionId` 1 to 2), and discovers
beacon B. Round two finds the v3 update, but `Resolver.updates()` has reset
`currentVersionId` to 1, so it sees `targetVersionId` 3 against a counter of 1, takes the
`targetVersionId > currentVersionId + 1` branch, and raises `LATE_PUBLISHING`. A
conformant DID fails to resolve the moment its history is spread across the beacons it
builds up. [ADR 059](059-unbounded-beacon-discovery-default.md) noted this under its
Context and left it for its own change; this is that change.

The reset also meant `metadata.versionId` reported only the last round's local count
rather than the document's true version, and `updateHashHistory` was empty in every round
after the first, so a duplicate update republished on a later-round beacon could not be
confirmed against its history.

## Decision

### 1. Lift the version counter and update-hash history to resolution-wide state

`currentVersionId` and `updateHashHistory` are now instance fields on the `Resolver`
(`#currentVersionId`, initialized to 1; `#updateHashHistory`, initialized to `[]`). They
model exactly what the spec models: state that persists for the whole resolution, not for
a single batch of signals.

### 2. Thread that state through `Resolver.updates()`

`Resolver.updates()` takes an optional fifth parameter,
`resolutionState: { currentVersionId, updateHashHistory }`, defaulting to
`{ currentVersionId: 1, updateHashHistory: [] }`. It continues the counter from the
carried value and appends to the carried history array (shared by reference, so appends
are visible to the next round). The `ApplyUpdates` phase passes the instance fields in and
carries the reached version forward by reading it back from the response's
`metadata.versionId`, which the algorithm already sets at every return point. Standalone
callers (for example test-vector generation) omit the parameter and get the spec's fresh
start, so their behavior is unchanged.

The net effect: a resolution split across N discovery rounds now behaves identically to
processing the same signals in one continuous loop. The rounds are an I/O-scheduling
detail, no longer a semantic boundary.

## Consequences

- A DID whose later versions are announced on beacons that earlier updates added now
  resolves, instead of failing at round two with `LATE_PUBLISHING`. This removes a
  divergence from the did:btcr2 read algorithm.
- `metadata.versionId` on the resolved result now reflects the document's true version
  across the whole history rather than the last round's local count.
- Duplicate confirmation works across rounds: `updateHashHistory` accumulates for the
  whole resolution, so a republished earlier update is checked against the history that
  actually contains it.
- `Resolver.updates()` stays backward compatible. The new parameter is optional and
  defaults to a fresh start; the only in-tree caller is the resolver's own `ApplyUpdates`
  phase, and the documented static utility usage is unaffected.
- The resolver test fixtures changed shape. `buildDiscoveryChain()` previously built an
  artificial chain where every update re-declared `targetVersionId: 2`, the only shape the
  reset counter would accept across rounds. It now builds a genuine linear history
  (v1 to v2 to v3 ...), which is what the fix makes resolvable and what the
  `maxDiscoveryRounds` tests from [ADR 059](059-unbounded-beacon-discovery-default.md) now
  exercise. A dedicated regression test asserts a three-hop history resolves to version 4.

## Rejected alternatives

- **Accumulate all updates across rounds, then apply once at the end.** This cannot work:
  discovery depends on application. A later update is only discoverable after the earlier
  update that adds its beacon has been applied. Application and discovery are necessarily
  interleaved, so the loop-invariant state has to be carried, not deferred.
- **Carry only the version counter, keep resetting the history.** The happy path (no
  duplicates) would pass, because the history is only read when confirming a duplicate.
  But it would diverge from the spec, which keeps one history for the whole loop, and a
  duplicate republished on a later-round beacon would fail to confirm against an empty
  history. Carrying both keeps multi-round resolution identical to single-round.
- **Mutate the carrier object to write the version back.** `Resolver.updates()` has
  several early-return points (version-time, version-id, and deactivation limits), so
  writing the counter back on every exit would be error-prone. The response already
  carries the reached version in `metadata.versionId` at every return, so reading it back
  is both simpler and provably consistent with whatever the method returns.

## Out of scope

The per-tuple `currentVersionId` increment in `Resolver.updates()` is unconditional, which
matches the spec's "Process updates Array" step that increments the counter after the
duplicate-or-apply check rather than only on apply. This change does not alter that
behavior; it only stops the counter and history from resetting between rounds. Any question
about how the read algorithm increments on a confirmed duplicate is a separate,
pre-existing matter that this fix neither introduces nor worsens, and is left for its own
review.
