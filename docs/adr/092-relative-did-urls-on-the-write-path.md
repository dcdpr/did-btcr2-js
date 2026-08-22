---
title: "ADR 092: Apply the Relative DID URL Rule to the Write Path and to Proof References"
---

# ADR 092: Apply the Relative DID URL Rule to the Write Path and to Proof References

**Status:** Accepted

**Date:** 2026-08-22

**References:** [ADR 088](088-read-path-update-authorization.md), [ADR 091](091-inject-did-into-beacons-and-relative-did-urls.md)

## Context

DID Core permits the `id` of a verification method or service, and the entries of a
verification relationship, to be written as a relative DID URL: `#initialKey` denotes that
fragment of the document subject. [ADR 091](091-inject-did-into-beacons-and-relative-did-urls.md)
decided that this implementation resolves both spellings to an absolute DID URL before
comparing them, and applied that rule to the read path: the `capabilityInvocation` membership
check in the resolver, and the verification method lookup in `DidBtcr2.getSigningMethod`.

It did not apply the rule everywhere DID URLs are compared. A document written in the relative
spelling resolves, but cannot be updated, and four sites are responsible.

**`DidBtcr2.update` compares raw strings twice.** The `capabilityInvocation` membership check
asks `capabilityInvocation.some(vr => vr === verificationMethodId)`, and the beacon lookup asks
`service.id === beaconId`. Neither resolves either side. The next line calls `getSigningMethod`,
which does resolve both sides, so the update factory is stricter than the method lookup it
immediately delegates to, and stricter than the read path whose authorization rule it exists to
mirror. A caller holding a relative-spelling document cannot name its own key or its own beacon
in a spelling the factory accepts, in either direction: an absolute argument fails against a
relative entry, and a relative argument fails against an absolute one.

**The proof named the signing method in the document's spelling.** `Updater.sign` set the Data
Integrity proof's `verificationMethod` to `verificationMethod.id` verbatim. For a relative
document that is `#initialKey`, and the cryptosuite refuses to serialize a proof whose
`verificationMethod` differs from the key's absolute id, so signing throws before a proof is
produced at all. That check is correct and should stay: a proof travels apart from the document
that defines the method, so a bare fragment in one resolves against nothing. What was wrong is
which value the update path put there.

**The aggregation communication key lookup compares raw strings.**
`getAggregationCommunicationKey` dereferences `capabilityInvocation[0]` with
`verificationMethod.find(method => method.id === invocation)`. A document whose entry and whose
method id are spelled differently derives no key, and an EXTERNAL sender carrying such a genesis
document cannot be authenticated on either transport.

**Resolving to `undefined` made two comparisons fail open.** `Appendix.absoluteDidUrl` returns
`undefined` for a non-string or empty input, which is what keeps two unusable values from
comparing equal to each other. But `getSigningMethod` compared its resolved target against each
resolved method id without first rejecting an `undefined` target, so a document containing a
malformed method id returned that method for an unusable lookup. The read path's membership
check already guarded this; the method lookup did not.

## Decision

**One helper, used by every comparison.** `Appendix.relationshipMethodId(entry, did)` resolves a
verification relationship entry, which is either a reference or an embedded method that names
itself with its own `id`, to an absolute DID URL through `Appendix.absoluteDidUrl`. The
module-private `relationshipMethodId` in the resolver, introduced by ADR 088 and narrowed by
ADR 091, becomes a call to it. The read path's membership check, the write path's membership
check, and the `assertionMethod` fallback in the method lookup now share one implementation of
the rule rather than three copies that drifted.

**`DidBtcr2.update` resolves both sides of both comparisons.** The `capabilityInvocation` check
goes through `relationshipMethodId`, exactly as the resolver's does. The beacon lookup resolves
the caller's `beaconId` and each `service.id` against the document id. A caller may name a key
or a beacon in either spelling, whichever the document uses, and an update the factory
authorizes is one the resolver will also accept.

**An unusable target matches nothing.** Both new comparisons, and the method lookup that lacked
it, reject an `undefined` target before comparing. Resolution failing closed is the point of
returning `undefined` rather than a placeholder; a comparison that omits the guard converts that
into a match on the document's first malformed entry.

**Proofs name the signing method by absolute DID URL.** `Updater.sign` resolves the method id
against the DID being updated before putting it in the proof configuration. Per DID Core a
relative id inside a document denotes a fragment of that document's `id`, which is the DID under
update, so this is the document's own rule applied at the boundary where the reference leaves
the document. A document that already spells its ids absolutely produces a byte-identical proof,
so no existing test vector changes.

**The aggregation key lookup resolves both sides.** `getAggregationCommunicationKey` compares
resolved absolute DID URLs, with the same `undefined` guard.

Comparing resolved absolute URLs rather than bare fragments is carried over unchanged from
ADR 091: matching on the fragment alone would let `did:btcr2:OTHER#initialKey` collapse onto this
document's `#initialKey`, which is what ADR 088 exists to prevent.

## Consequences

A document written entirely in relative DID URLs can now be updated, not merely resolved. The
write path and the read path admit exactly the same spellings, which is what ADR 091's decision
said and what the resolver's own comment already claimed when it deferred the write-path
enforcement to `DidBtcr2.update`.

`Appendix.relationshipMethodId` is new public surface on `method`, so this rides a minor bump.
`aggregation`, `api`, and `cli` change only by dependency: neither `api` nor `cli` compares DID
URLs itself, because both pass `verificationMethodId` and `beaconId` straight through to
`DidBtcr2.update`, which is the single chokepoint for both checks.

One case deliberately still fails, and fails at signing rather than later: a verification method
whose `controller` is some DID other than the document subject. The proof resolves the method id
against the document, the cryptosuite resolves the key's id against its controller, and the two
disagree, so the cryptosuite's existing id check throws. Producing a proof that names a method
the resolver would then fail to find is worse than refusing to sign.

The remaining known gap is the mirror image, and it is left open pending the specification: an
update produced elsewhere whose proof spells `verificationMethod` relatively. Such an update
passes the authorization check and the method lookup, both of which resolve it, and is then
refused by the cryptosuite's id comparison. Accepting it means deciding that a bare fragment in
a proof resolves against the key's controller, which is a statement about Data Integrity proofs
rather than about DID documents, and the cryptosuite is method-agnostic by
[ADR 054](054-cryptosuite-method-agnostic.md). No vector exercises it: the danubetech driver
spells proof references absolutely even in documents whose method ids are relative.
