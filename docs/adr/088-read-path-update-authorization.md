---
title: "ADR 088: Enforce capabilityInvocation Membership When Resolution Applies an Update"
---

# ADR 088: Enforce capabilityInvocation Membership When Resolution Applies an Update

**Status:** Accepted

**Date:** 2026-08-19

**Branch / PR:** `fix/critical-high-security-findings`

**References:** [ADR 016](016-sans-io-resolver.md), [ADR 051](051-update-verifies-signing-key.md), [ADR 055](055-resolver-provide-trust-boundary.md), [ADR 057](057-did-document-validation-standards.md), [ADR 085](085-typed-error-policy.md)

## Context

Resolution of a did:btcr2 identifier replays every announced update against the document
as it stood at the previous version ([ADR 016](016-sans-io-resolver.md)). The step that
decides whether an update counts is `Resolver.applyUpdate`
(`packages/method/src/core/resolver.ts:596`): it dereferences the proof's root capability
and checks that the capability's `invocationTarget` and `controller` are this DID, reads
`proof.verificationMethod`, locates that method with `DidBtcr2.getSigningMethod`, verifies
the Data Integrity proof against the method's published key, applies the JSON Patch, and
checks the resulting document against `update.targetHash`.

Nothing in that sequence tied the named method to an authorization. `getSigningMethod`
searches `didDocument.verificationMethod`, which is the document's key directory, not a
grant of authority. Every key a controller publishes appears there, including keys
published to be used for something other than updating the DID. The verification
relationships (`authentication`, `assertionMethod`, `capabilityInvocation`,
`capabilityDelegation`) are the only mechanism a DID document has for saying "this key may
authenticate but must not rewrite me", and the read path ignored them entirely.

The result was a full, persistent takeover of a DID by a key deliberately excluded from
update authority. A controller publishes `#device` under `authentication` so a device can
log in; whoever holds `#device` signs an update whose patch adds `#device` to
`capabilityInvocation`, announces it through the beacon, and resolution accepts it. From
that version on the attacker is an authorized controller and the original key cannot
revoke the grant, since revocation is itself an update the attacker can outpace. Driven
against the real state machine, that sequence resolved successfully to version 3 with the
attacker's key listed in `capabilityInvocation`.

The specification's resolve algorithm already required the missing half. Its "Check
`update.proof`" step says to locate the method in `current_document.verificationMethod`
**and** to raise `INVALID_DID_UPDATE` if `current_document.capabilityInvocation` does not
contain `update.proof.verificationMethod`. Only the first conjunct was implemented.

The write path never had this hole: `DidBtcr2.update` (`packages/method/src/did-btcr2.ts:175`)
has always refused a `verificationMethodId` that is absent from the source document's
`capabilityInvocation`, and [ADR 051](051-update-verifies-signing-key.md) additionally
binds the signer's key to that method. But the write path is a convenience for honest
callers. An attacker constructs the update by hand, or calls the static `Updater.sign`
directly, and neither costs anything. Only the read path decides what the network sees, so
an authorization rule that lives solely on the write path is not an authorization rule at
all. This is the same read-path/write-path asymmetry that [ADR 055](055-resolver-provide-trust-boundary.md)
addressed for caller-supplied resolution data.

## Decision

### 1. Resolution refuses an update whose proof method is not authorized

`applyUpdate` asserts that the contemporary document's `capabilityInvocation` names
`proof.verificationMethod` before doing anything with the proof
(`packages/method/src/core/resolver.ts:639-651`). A failure raises the typed
`ResolveError` with type `INVALID_DID_UPDATE` ([ADR 085](085-typed-error-policy.md)),
carrying `{ verificationMethodId, capabilityInvocation }` so a caller can see both the
method that was claimed and the list it was measured against.

Two properties of the placement matter as much as the check:

- **It runs before the signature is used.** The assertion sits between the
  `verificationMethod` existence check and `getSigningMethod`/`verifyProof`, and the patch
  is not applied until later in the same function (`resolver.ts:680`). The document it
  reads is the pre-patch document: `applyUpdate` has a single call site
  (`resolver.ts:490`) which passes the current `response.didDocument`. An attacker
  therefore cannot grant itself the relationship inside the very update it is signing;
  the grant has to already exist in the version being updated. Membership is evaluated per
  version, so ordinary rotation still works: a key that update N adds to
  `capabilityInvocation` may sign update N+1.
- **It runs before the method is located.** `getSigningMethod` throws a `@web5/dids`
  `DidError`, not a `ResolveError`. Checking authorization first means an unauthorized
  method always surfaces as one typed `INVALID_DID_UPDATE`, whether or not it also appears
  in `verificationMethod[]`. A `proof.verificationMethod` that is not a usable string also
  fails closed here rather than reaching `getSigningMethod`, whose `??` fallback would
  otherwise have quietly selected the method named by `assertionMethod[0]`.

### 2. Both sides of the comparison are normalized to an absolute method id

The module-private `relationshipMethodId(documentId, entry)`
(`packages/method/src/core/resolver.ts:171-176`) reduces a verification relationship entry
to the absolute DID URL of the method it names: an embedded verification method object
becomes its `id`, a string reference is the id itself, and a bare fragment such as
`#key-0` is resolved against `documentId`. Both the proof's `verificationMethod` and every
`capabilityInvocation` entry go through it before comparison.

This is required for correctness, not convenience. DID Core permits a relationship entry
to be either a string reference or an embedded verification method, and permits relative
DID URLs, so a literal string comparison would refuse spec-valid documents. The case is
not hypothetical for EXTERNAL (`x1`) identifiers: a genesis document written with relative
references keeps that form through the placeholder substitution done at resolution, while
its `verificationMethod[].id` values and the update proof both carry absolute URLs.
Exact-only matching would render such a DID permanently unresolvable, which is a worse
failure than the one being fixed.

The normalization is deliberately narrow, and its safety rests on two properties:

- Only a `#`-prefixed string has the document id prepended. Every other string is returned
  unchanged, so an entry naming the same fragment on a **different** DID stays a full URL
  and can never collapse onto this document's method. A regression test covers exactly
  that shape.
- A malformed entry yields `undefined` rather than a placeholder string, and the proof
  side must be defined for the update to be authorized
  (`authorizedMethodId !== undefined && ...`), so two unusable values never compare equal
  to each other. The check fails closed.

Unwrapping is one level deep and non-recursive by construction, so no crafted nesting can
drive it.

Nine regression cases in `packages/method/tests/resolver.spec.ts` cover both directions:
the five refusals (the authentication-only takeover, a method under no relationship, a
document whose `capabilityInvocation` a prior update removed, the foreign-DID fragment, a
non-string `verificationMethod`) and four guards proving the check is not over-broad (the
identity key, a key granted invocation by the previous update, a bare-fragment reference,
and an embedded method object).

## Consequences

- **This changes resolution outcomes for already-published DIDs, not just code.** A DID
  whose history contains an update signed by a key outside the contemporary
  `capabilityInvocation` no longer resolves. `applyUpdate` throws and nothing in the
  resolver catches it, so the whole resolution fails rather than returning the document
  truncated at the last authorized version. That is the intended reading of the spec (such
  a history was never authorized), but it means a controller who signed in good faith with
  a key outside the list now has an unresolvable DID and no in-band way to repair it.
- **An `x1` genesis document that omits `capabilityInvocation` entirely becomes
  permanently un-updatable.** Such a document is valid today: the `DidDocument` constructor
  copies the four relationship arrays verbatim for the EXTERNAL branch
  (`packages/method/src/utils/did-document.ts:238-244`), with none of the `#initialKey`
  auto-fill the KEY branch performs (`:231-237`); `sanitize` then deletes the undefined
  keys, and `isValidVerificationRelationships` only validates the relationship keys that
  are actually present (`:409-420`). Before this decision, any key in `verificationMethod[]`
  could update such a DID on the read path. Now `capabilityInvocation?.some(...)` is
  `undefined`, every update is refused, and no update can add the array because adding it
  would itself need an authorization that does not exist. `DidBtcr2.update` already
  refused these documents, so nothing changes for callers going through the SDK write
  path; what changes is that a hand-crafted update against such a DID no longer resolves.
  There is no recovery short of a new identifier. Creation tooling should refuse or warn on
  a genesis document with no `capabilityInvocation`; that guard is follow-up work, not part
  of this decision.
- **A read/write coherence gap this decision widened.** The read path now accepts
  bare-fragment references and embedded verification method objects; the write path
  (`packages/method/src/did-btcr2.ts:175`) is still an exact string match,
  `vr === verificationMethodId`. A document using either form therefore resolves but cannot
  be updated through `DidBtcr2.update`:
  - an embedded method object never equals a string, so the membership check refuses the
    update whatever the caller passes;
  - a bare-fragment entry refuses an absolute `verificationMethodId` at the same line, and
    if the caller instead passes the bare fragment, the membership check passes but
    `getSigningMethod` then fails to find the method, because
    `Appendix.extractDidFragment` (`packages/method/src/utils/appendix.ts:25-29`) does not
    extract a fragment at all: it is the identity function on non-empty strings, so the
    lookup compares the document's absolute `vm.id` to the caller's string exactly.

  The failure is fail-closed in every branch: a refused update, never an accepted one, and
  never an unverifiable announcement paid for on-chain. Closing the gap is not a one-line
  change, because `getSigningMethod` is public API re-exported through `@did-btcr2/api`
  (`packages/api/src/method.ts:435`) and would have to change alongside `update()` and the
  resolver. The direction is a single relationship-aware method-resolution helper shared by
  the read path, `DidBtcr2.update`, and `getSigningMethod`, with `extractDidFragment`
  either made to do what its name says or removed. It is deferred here because it alters a
  published API contract and this decision does not need it to be safe.
- Callers can distinguish the refusal programmatically: `ResolveError` with
  `type === 'INVALID_DID_UPDATE'` and a `data` payload naming the method and the list.
  Existing handlers that only match on the type string see no new error class.
- The runtime cost is one linear scan of `capabilityInvocation` per applied update, with no
  additional cryptography and no additional I/O, so the sans-I/O property of the resolver
  is unaffected.
- Residual: the read path still does not check the proof's `capabilityAction`, which the
  write path always sets to `'Write'`. That is a separate authorization dimension and is
  left for its own decision.

## Rejected Alternatives

- **Put the check inside `getSigningMethod`.** It looks like the natural home, but that
  function is public API re-exported through `@did-btcr2/api`, it defaults to
  `#initialKey`, and it has an `assertionMethod[0]` fallback; callers legitimately use it
  to fetch a key for purposes other than invocation, so hard-wiring `capabilityInvocation`
  into it would break them. It also throws a `@web5/dids` `DidError` rather than a typed
  resolution error. Placing the assertion at the resolver's decision point keeps the change
  scoped to the read path and keeps the error typed.
- **Compare strings exactly, with no normalization.** Stricter and simpler, but it refuses
  documents DID Core explicitly allows (embedded methods, relative references) and would
  make some `x1` DIDs permanently unresolvable rather than merely un-updatable. Refusing a
  valid document at read time is a worse outcome than the small, non-recursive
  normalization surface accepted here.
- **Recursively dereference relationship entries and compare method material.** Entries
  name a method id and the spec's check is a containment test over ids, so following
  references to compare keys adds attack surface (nesting depth, cycles) for no additional
  authority signal. One unwrap level is sufficient and is bounded by construction.
- **Record the anomaly in resolution metadata and still return a document.** Resolution has
  to yield exactly one document; a "possibly unauthorized" one is not something a verifier
  can act on, and every caller that does not read the metadata would remain fully
  vulnerable. The spec mandates an error, and an error is the only outcome that actually
  removes the takeover.
- **Grandfather histories published before this change.** Any cutoff needs a trusted date
  that a permissionless system cannot supply, and the window it opens is precisely the
  window an attacker would aim for. Accepting that some existing DIDs stop resolving is the
  honest cost of enforcing the rule at all.
