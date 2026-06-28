---
title: "ADR 057: Extensible @context and Uniform Multikey Enforcement in DID Document Validation"
---

# ADR 057: Extensible @context and Uniform Multikey Enforcement in DID Document Validation

**Status:** Accepted

**Date:** 2026-06-28

**Branch / PR:** `fix/did-document-validation`

**References:** [ADR 051](051-update-verifies-signing-key.md), [ADR 054](054-cryptosuite-method-agnostic.md), [ADR 055](055-resolver-provide-trust-boundary.md)

## Context

DID document validation runs at several boundaries: when a `DidDocument` is constructed, when the `Updater` validates the post-update target document, and when the `Resolver` validates each updated document it applies. Two of those checks were out of step with the did:btcr2 and W3C specifications.

### 1. The `@context` check was a closed whitelist

`isValidContext` accepted a document only when **every** `@context` entry was one of the two btcr2 base contexts:

```js
context.every(ctx => typeof ctx === 'string' && BTCR2_DID_DOCUMENT_CONTEXT.includes(ctx))
```

W3C DID Core §4.1 treats `@context` as an extension point: a document may list additional contexts (a proof-suite context, a service or extension context) after the required ones. The whitelist rejected all of them, and it rejected inline object contexts outright even though the `@context` type permits them. This is not hypothetical: a document that adds a verification method secured by a Data Integrity proof suite needs that suite's context present, and an update that introduces such a method would have failed validation at `Updater`/`Resolver` time. Making the cryptosuite method-agnostic ([ADR 054](054-cryptosuite-method-agnostic.md)) sharpened this: proof-suite contexts are now a first-class concern, not a btcr2-internal detail.

### 2. The Multikey invariant was enforced in only one place

The did:btcr2 specification requires every verification method to be a `Multikey` whose public key is a Schnorr secp256k1 key, multibase-encoded with the `zQ3s` prefix. That invariant was enforced only in the update path (`DidBtcr2.update`), against the single method being signed with. The `DidVerificationMethod` constructor validated nothing, and the document-level `isValidVerificationMethods` checked only the generic W3C id/type/controller shape. A document carrying a non-Multikey or non-`zQ3s` verification method could be constructed and could pass document validation, and the mismatch would only surface later (or not at all), far from where the bad method entered.

## Decision

### 1. Make `@context` validation extensible

`isValidContext` now requires the document to be a non-empty array that **contains** the btcr2 base contexts, and permits any additional entries (further string contexts or inline object contexts):

```js
Array.isArray(context) && context.length > 0
  && BTCR2_DID_DOCUMENT_CONTEXT.every(required => context.includes(required))
```

This is purely permissive relative to the old behavior in the dimension that matters: documents that were valid stay valid (they contain the base contexts), and documents that add proof-suite or extension contexts are now accepted instead of rejected. The change deliberately does **not** add a new position constraint (for example, requiring the DID Core context first); that would tighten validation in one dimension while loosening it in another and could reject documents accepted today.

### 2. Enforce the Multikey invariant uniformly through one validator

A single predicate, `isMultikeyVerificationMethod`, is now the source of truth for "is this a valid btcr2 verification method": structurally a verification method, of type `Multikey`, with a `publicKeyMultibase` that starts with `zQ3s`. The type string and the multibase prefix are named constants (`MULTIKEY_VERIFICATION_METHOD_TYPE`, `MULTIKEY_PUBLIC_KEY_MULTIBASE_PREFIX`).

That predicate (and the shared constants) are applied at every boundary:

- the `DidVerificationMethod` constructor throws on a non-Multikey type or a non-`zQ3s` key, so a malformed method cannot be constructed;
- `isValidVerificationMethods` runs the predicate over the whole `verificationMethod` array during `DidDocument` construction and validation;
- the update path keeps its own check (now expressed against the shared constants) because it raises a more specific `UpdateError` naming the method being signed with: redundant by design, defense in depth.

## Consequences

- A DID document may carry proof-suite and extension contexts and still validate, so a verification method secured by a Data Integrity proof suite, and updates that introduce one, are no longer blocked at construction, update, or resolution time.
- The Multikey + `zQ3s` invariant holds wherever a verification method enters the system, not just for the one method signed with at update time. A non-Multikey or non-`zQ3s` method now fails fast, at construction or at the document boundary, with a typed `DidDocumentError`.
- There is one definition of "valid btcr2 verification method" and one definition of the type and prefix constants, so the constructor, the document validator, and the update-path guard cannot drift apart.
- Behavior for well-formed documents is unchanged: every existing test vector (all verification methods Multikey + `zQ3s`, all documents carrying exactly the base contexts) continues to validate and resolve.

## Rejected alternatives

- **Keep the closed `@context` whitelist.** It violates the §4.1 extension model and, concretely, blocks proof-suite contexts that the method now needs to interoperate with.
- **Also require the DID Core context first.** Spec-justified in isolation, but it adds a new constraint that could reject documents accepted today; the goal here is to relax, not to re-tighten on a different axis. Presence of the base contexts is the property the method actually depends on.
- **Enforce Multikey only at the `DidVerificationMethod` constructor.** That class is constructed in just one place today; most verification methods reach the system as plain objects validated at the document boundary. Enforcing only at the constructor would leave the larger path unchecked. Enforcing only at the document boundary would let direct construction produce an invalid method. Doing both, through one shared predicate, closes both paths.
- **Drop the update-path check now that the boundary enforces the invariant.** Kept on purpose: it throws a more specific `UpdateError` identifying the signing method, which is more actionable than the generic document error, and costs nothing to retain.
