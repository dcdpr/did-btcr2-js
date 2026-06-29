---
title: "ADR 059: Beacon Discovery Is Unbounded by Default, With an Opt-In Round Cap"
---

# ADR 059: Beacon Discovery Is Unbounded by Default, With an Opt-In Round Cap

**Status:** Accepted

**Date:** 2026-06-29

**Branch / PR:** `fix/resolver-discovery-rounds-default`

**References:** [ADR 016](016-sans-io-resolver.md), [ADR 055](055-resolver-provide-trust-boundary.md), [W3C DID Resolution](https://w3c.github.io/did-resolution/), [W3C DID Core](https://www.w3.org/TR/did-core/)

## Context

The Resolver applies the updates it has found, then looks for beacon services those
updates added and loops back to discover their signals (multi-round discovery). [ADR
055](055-resolver-provide-trust-boundary.md) added a `maxDiscoveryRounds` bound on
that loop with a **default of 10**, and made exceeding it throw `ResolveError`
(`INVALID_DID_DOCUMENT`). The stated worry was a document whose updates keep adding
beacon services driving discovery without end.

Three facts, verified against the current code and the specifications, undermine that
default:

1. **Termination does not depend on the cap.** Each beacon address is recorded in a
   per-resolution cache (`#requestCache`, keyed by address string) the first time it
   is queried, and discovery only loops back when an update introduces an address not
   already in that cache. The set of reachable addresses is bounded by the finite
   genesis document plus the finite set of applied updates, so the loop reaches a
   fixed point and terminates on its own for any finite input. The cap is redundant
   for correctness; it is purely a resource guard.

2. **No specification calls for a round limit.** "Beacon discovery rounds" is a
   did:btcr2 concept; generic resolution has no notion of it, and the did:btcr2 Read
   algorithm defines no iteration or round limit. The W3C DID Resolution and DID Core
   specifications do not mandate one either. DID Core only notes that developers
   "might wish to limit recursion depth or breadth to reduce the potential attack
   surface", an opt-in best practice, not a required default. A resolver that throws
   on a DID the method says should resolve is diverging from the method's contract.

3. **The error code was wrong.** A resolver that stops at its own configured limit has
   not encountered a malformed document. DID Resolution reserves `INVALID_DID_DOCUMENT`
   for a document that "was malformed" and `INTERNAL_ERROR` for "an unexpected error
   during DID Resolution". A caller-imposed limit is an operational stop, not a data
   defect, so `INTERNAL_ERROR` is the faithful code.

A further observation reinforces that the default cap guarded a path no ordinary DID
reaches: `Resolver.updates()` restarts its version counter at 1 on every round and the
per-round update set is not carried across rounds, so a genuine linear history whose
later versions are announced on beacons added by earlier versions (v2, then v3 on a
new beacon, ...) is rejected as late publishing before a second discovery round can
even run. The only inputs that actually drive many rounds are ones where each update
re-declares `targetVersionId: 2` with a `sourceHash` chained to the running document,
each adding a new beacon. That pathological, controller-signed shape is exactly what a
resource guard is for, and it is what the regression test exercises. The cross-round
version-counter limitation is a separate resolver issue, noted here as evidence and
left for its own change.

## Decision

### 1. Default discovery to unbounded

`maxDiscoveryRounds` now defaults to no limit (`Infinity`). A well-formed DID resolves
in however many rounds its history requires; termination is guaranteed by address
de-duplication, not by the cap.

### 2. Keep the cap as an opt-in resource guard

`ResolutionOptions.maxDiscoveryRounds` remains. A **positive** value imposes a finite
bound for a caller that wants one (for example a public resolver bounding work per
request). A non-positive value, or omitting the field, means no limit. This matches
the DID Core "might wish to limit" guidance: available, not imposed.

### 3. Surface an exceeded cap as INTERNAL_ERROR

When a configured positive cap is exceeded, the resolver throws `ResolveError` with
`INTERNAL_ERROR` and a message pointing the caller to raise or remove the limit. The
document is well-formed; the resolver simply stopped at the caller's limit.

### 4. Remove the exported default constant

`DEFAULT_MAX_DISCOVERY_ROUNDS` is removed. There is no longer a numeric default to
name, and keeping a `DEFAULT_*` constant that is not the default would mislead.

## Consequences

- A DID whose update history legitimately spans many discovery rounds resolves instead
  of failing at an arbitrary round 11. This removes a divergence from the did:btcr2
  read algorithm where a valid DID was reported as having an invalid document.
- Callers that want a bound still have one, now correctly typed: an exceeded bound is an
  `INTERNAL_ERROR` operational stop, not an `INVALID_DID_DOCUMENT` data defect.
- `maxDiscoveryRounds: 0` previously tripped immediately (a zero budget). It now means
  "no limit", consistent with the non-positive-means-unbounded rule. Any caller that
  relied on `0` to force a failure must pass a positive value instead.
- Removing the exported `DEFAULT_MAX_DISCOVERY_ROUNDS` is a breaking change for any
  consumer importing it. The constant was introduced only in the immediately preceding
  release and named an internal default; no in-tree consumer referenced it.
- This reverses the default and the error code chosen in [ADR
  055](055-resolver-provide-trust-boundary.md) section 3 while preserving that ADR's
  other two hardening decisions (payload hash validation and shape guards at the
  `provide()` boundary), which are unaffected.

## Rejected alternatives

- **Keep the fixed default of 10.** It rejects valid DIDs whose history exceeds it,
  diverges from the method's read algorithm, and protects against a path that address
  de-duplication already makes terminate. A default that can fail a conformant DID is
  worse than no default.
- **Remove the cap entirely.** A library embedded in a public resolver can reasonably
  want to bound work per request as defense in depth. DID Core explicitly sanctions
  that as an option. Keeping an opt-in knob costs almost nothing and leaves the policy
  with the embedder, who knows their threat model, rather than removing the choice.
- **Keep failing closed but relabel the document as invalid.** Calling a well-formed
  document "invalid" because the resolver stopped early misreports the cause to the
  caller. `INTERNAL_ERROR` names what actually happened.

## Follow-ups

- The cross-round version-counter reset in `Resolver.updates()` noted under Context is a
  separate resolver defect: a legitimate linear history whose later versions are
  announced on beacons added by earlier versions is rejected as late publishing before a
  second discovery round runs. It is not addressed here and is tracked for its own
  change, alongside the `provide()` idempotency work on the same discovery loop.
