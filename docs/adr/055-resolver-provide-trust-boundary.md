---
title: "ADR 055: Harden the Resolver provide() Trust Boundary"
---

# ADR 055: Harden the Resolver provide() Trust Boundary

**Status:** Accepted

**Date:** 2026-06-27

**Branch / PR:** `fix/resolver-provide-hardening`

**References:** [ADR 016](016-sans-io-resolver.md), [ADR 051](051-update-verifies-signing-key.md)

## Context

The Resolver is a sans-I/O state machine ([ADR 016](016-sans-io-resolver.md)): it emits typed `DataNeed` requests and the caller fulfills them through `provide()`. That makes `provide()` a trust boundary. The data crossing it, Bitcoin beacon signals, CAS announcements, signed updates, SMT proofs, genesis documents, comes from the network and from sidecar bundles, so it is influenceable by whoever produced the on-chain signals or assembled the sidecar.

Three gaps sat on that boundary:

1. **Unvalidated payloads.** `provide()` validated the SMT proof's root hash against the need's `smtRootHash`, but it did **not** validate the CAS announcement or the signed update against the need's `announcementHash` / `updateHash`. The on-chain signal commits to a specific hash; the caller could nonetheless supply a different announcement or update, and it was accepted and stored. Resolution then either failed opaquely much later (the lookup by the committed hash missed) or proceeded on data the signal never committed to.

2. **Unchecked casts.** `provide()` cast each payload with `as` and no runtime shape check, so a malformed payload flowed downstream as a bad cast and surfaced as a confusing error far from the boundary where it entered.

3. **Unbounded discovery.** After applying the updates found so far, the resolver looks for beacon services those updates added and loops back to discover their signals. That loop had no bound. A crafted document whose updates keep adding beacon services drives discovery without terminating: an unbounded-work vector.

## Decision

### 1. Validate provided data against the requested hash

`provide()` now checks the CAS announcement's canonical hash against `need.announcementHash` and the signed update's canonical hash against `need.updateHash`, mirroring the SMT root-hash check that was already there. A mismatch throws `ResolveError` (`INVALID_DID_UPDATE`) at the boundary. Correct callers are unaffected: the hash already matches the on-chain commitment, which is exactly why the downstream lookups worked.

### 2. Guard payload shapes at the boundary

`provide()` runtime-checks each payload's shape, a `Map` for beacon signals, the required fields for a CAS announcement, a signed update, and an SMT proof, and an object for a genesis document, and throws a typed error naming the need when the shape is wrong, instead of forcing it through with an `as` cast.

### 3. Bound discovery rounds

A `maxDiscoveryRounds` option (default 10, exposed on `ResolutionOptions`) caps the apply-then-rediscover loop. Exceeding it throws `ResolveError` (`INVALID_DID_DOCUMENT`). A well-formed document reaches a fixed point in a handful of rounds; the cap stops a pathological or malicious chain of beacon services from looping without end.

## Consequences

- A signal that commits to one hash but is fulfilled with different data is rejected at `provide()`, not silently used. Resolution fails with a clear, local error instead of an opaque downstream one or a proof over unverified data.
- A malformed payload fails fast with a typed error naming the need, rather than a surprise far from the boundary.
- Resolution terminates: the discovery loop is bounded, so a malicious beacon-chaining document fails closed rather than spinning.
- `ResolutionOptions` gains an additive `maxDiscoveryRounds` (default 10). Existing callers are unchanged and protected by default; a caller with an unusual but legitimate topology can raise it, and a cautious caller can lower it.
- The hash checks reject only previously-broken inputs (data that did not match the on-chain commitment); they do not change behavior for matching data.

## Rejected alternatives

- **Trust the caller, or validate only downstream.** The `provide()` boundary is precisely where network-influenced data enters the sans-I/O core; validating there fails fast and locally. Downstream-only validation surfaces errors far from their cause, and for the discovery loop it never fires at all.
- **A fixed, non-configurable round cap.** Ten rounds suits real documents, but a configurable bound lets a legitimate caller with unusual topology raise it and a cautious caller lower it, without a code change.
- **Schema-validate entire documents at the boundary.** Heavier than needed. The shape guards check the fields the resolver actually consumes, and the hash checks bind each payload to its on-chain commitment, which is the real integrity property the boundary needs to enforce.
