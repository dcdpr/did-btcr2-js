---
title: "ADR 091: Inject the DID into Beacons, and Resolve Relative DID URLs to Absolute Before Comparing"
---

# ADR 091: Inject the DID into Beacons, and Resolve Relative DID URLs to Absolute Before Comparing

**Status:** Accepted

**Date:** 2026-08-21

**References:** [ADR 016](016-sans-io-resolver.md), [ADR 088](088-read-path-update-authorization.md)

## Context

DID Core permits the `id` of a verification method or service inside a DID document, and the
entries of a verification relationship, to be written as a **relative DID URL**: `#initialKey`
denotes that fragment of the document subject. Both spellings are legal and denote the same
resource.

This implementation only ever produced the absolute spelling, and in three places it also
required it.

**Beacons recovered the DID by string-slicing their own service id.** `SMTBeacon` and
`CASBeacon` both did `const did = this.service.id.split('#')[0]`. For `#cohort-mutinynet-smt-2`
that yields the empty string. The SMT beacon then indexed the tree at `didToIndex('')` and the
proof failed to verify; the CAS beacon looked up `announcement['']`, found nothing, and
**silently skipped the update** rather than erroring. `SMTBeacon.broadcastSignal` had the same
slice on the write path, so a broadcast for such a document would have built its tree at the
wrong leaf.

**The verification-method lookup compared raw strings.** `DidBtcr2.getSigningMethod` compared
`update.proof.verificationMethod` against each `verificationMethod[].id` through
`Appendix.extractDidFragment`, a local helper that, despite its name, returned its input
unchanged. An absolute reference therefore never matched a relative method id, and resolution
failed with an internal `DidError`.

[ADR 088](088-read-path-update-authorization.md) had already met this exact problem on the
`capabilityInvocation` membership check and solved it correctly, with a module-private
`relationshipMethodId(documentId, entry)` that resolves a leading-`#` reference against the
document id. That helper was not reachable from the method lookup, so the read path resolved
relative references for the authorization check and then failed to resolve them one line later.

### Why this went unnoticed

The scenario orchestrator writes genesis documents in the **placeholder-absolute** form,
`did:btcr2:_#initialKey` and `did:btcr2:_#cohortBeacon`. `Resolver.external` substitutes
`did:btcr2:_` with the real DID, so every id in a generated document is fully absolute by the
time a beacon sees it, and `split('#')[0]` returns the right answer. Every vector in the test
suite, including the SMT-beacon ones, is that shape. The relative spelling appears in our
vectors only as *added* services inside update patch values (`#dwn`, `#didcomm`), which are
neither beacon services nor verification methods and so never reach either code path.

The danubetech `uni-resolver-driver-did-btcr2` writes the bare relative form throughout. That
asymmetry is why both implementations resolve our vectors while only theirs resolves theirs:
the other implementation accepts both spellings, and this one accepted only the absolute one.
Isolating the variable confirms it exactly, with one identical SMT proof and one identical DID,
varying nothing but the beacon service id:

```
RELATIVE  '#cohort-mutinynet-smt-2'      -> SMT proof verification failed  [did derived = ""]
ABSOLUTE  'did:btcr2:x1q...#cohort-...'  -> proof VERIFIED
```

The upstream spec work in `spec-change/bundle-4-context-pin-and-proof-checks` moves toward
allowing both spellings while requiring implementations to resolve the relative one, which is
the behaviour this ADR adopts.

## Decision

**Inject the DID into the beacon; never infer it.** `SinglePartyBeacon` gains a
`readonly did: string`, set from a required second constructor argument, and
`BeaconFactory.establish(service, did)` threads it. The `Resolver` supplies
`currentDocument.id`; `Updater.announce` takes the DID as a parameter and `NeedBroadcast`
carries it so the api layer passes `need.did` rather than re-deriving one. Both the read path
and the write path now use `this.did`, and no `split('#')` remains in either beacon.

The DID a beacon serves is caller knowledge. A beacon service id is a reference *within* a
document, not a self-describing global name, so recovering the subject from it was only ever
correct by accident of how this implementation happened to write its own documents. Making the
argument required rather than optional-with-fallback means there is no path left that can
quietly reconstruct the empty string.

**Resolve relative DID URLs to absolute, then compare.** `Appendix.absoluteDidUrl(input, did)`
prefixes a leading-`#` reference with `did` and returns every other string unchanged.
`DidBtcr2.getSigningMethod` resolves both the reference and each candidate method id through it
before comparing, and `relationshipMethodId` delegates its reference-resolution half to the same
helper, so the authorization check and the method lookup admit exactly the same spellings.

Comparing resolved absolute URLs rather than bare fragments is deliberate. Matching on the
fragment alone would also have fixed these documents, and would additionally have made
`did:btcr2:OTHER#initialKey` match this document's `#initialKey`. ADR 088 exists to stop that
collapse, so the method lookup uses the same rule rather than a weaker one.

**Delete `Appendix.extractDidFragment`.** It is unused after the above, it does not do what its
name says, and leaving a helper that looks like it normalizes references but does not is how
this class of bug recurs.

## Consequences

All four danubetech examples, 11a-b and 12a-b, resolve to version 2. Every vector in the test
suite continues to resolve unchanged, since the absolute spelling passes through
`absoluteDidUrl` untouched. Nothing here is opt-in: accepting relative DID URLs closes a gap
where this implementation was stricter than DID Core, and it fails closed in the direction that
matters, because a reference naming a different DID still cannot match.

11a-b exercise a path 12a-b do not: their sidecar carries only `smtProofs`, so the genesis
document for each is fetched live from IPFS through the default CAS gateway. That retrieval
works unchanged.

The beacon constructors, `BeaconFactory.establish`, and `Updater.announce` all take one more
required argument, and `NeedBroadcast` carries one more field. These are breaking changes to
`method`'s public surface, carried by the minor bump that 0.x allows.

The CAS variant of the beacon bug deserves recording separately from the SMT one: it did not
throw. A relative-id CAS beacon returned "no update for this DID" and resolution completed
successfully against a stale document. A read-path failure that returns a plausible answer is
worse than one that errors, and this one was reachable by any conformant document.

The interop result worth keeping is how narrow the divergence was. Two independent
implementations agreed on canonicalization, leaf indexing, the tree model, the zero-hash seed,
proof serialization, BIP-340 proof verification, and CAS genesis retrieval. The only thing they
disagreed on was which of two legal spellings of a DID URL a resolver has to accept, and on
that point this implementation was simply wrong.

An earlier draft of this change also added an opt-in `ResolutionOptions.allowNoncelessSmtProofs`,
because the first generation of these examples carried SMT proofs with no `nonce` and the
normative leaf arms both hash `proof.nonce`. It is not part of this decision. The driver
regenerated all four examples with nonces, so they verify through the normative
`hash(hash(nonce) || updateId)` arm, and the specification in practice requires a nonce on every
proof. Adding resolver surface for a case the spec does not sanction and no vector exercises is
not worth its cost; if the nonce-less leaf values are ever pinned upstream, they become
unconditional behaviour rather than an option.
