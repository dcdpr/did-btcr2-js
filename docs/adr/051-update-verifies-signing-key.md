---
title: "ADR 051: Verify the Signing Key Against the Named Verification Method in Updater.sign"
---

# ADR 051: Verify the Signing Key Against the Named Verification Method in Updater.sign

**Status:** Accepted

**Date:** 2026-06-26

**Branch / PR:** `fix/update-verifies-signing-key`

**References:** [ADR 002](002-jcs-canonicalization-and-cryptosuite.md), [ADR 012](012-kms-dual-signing-urn-identifiers.md), [ADR 016](016-sans-io-resolver.md), [ADR 025](025-sans-io-updater.md)

## Context

The sign step of a did:btcr2 update builds a multikey from the caller's signer and produces a Data Integrity proof over the unsigned update ([ADR 002](002-jcs-canonicalization-and-cryptosuite.md)). The signer is supplied by the caller: a local secret key, a key-manager-backed signature, or any custom backend ([ADR 012](012-kms-dual-signing-urn-identifiers.md)). The proof records the verification method it claims to satisfy, taken from the document's `capabilityInvocation`.

Nothing checked that the signer's public key is the key that verification method publishes. A caller who supplies the wrong signing key (a different keystore entry, a key mis-derived after rotation, the wrong active key) produces a structurally valid update whose proof is signed by a key the named method does not list. The proof is internally well-formed but cryptographically unverifiable against the document.

That failure was silent at signing time. It surfaced only much later, when a resolver replaying the update verifies the proof against the document's published key and rejects it ([ADR 016](016-sans-io-resolver.md)) - after the update had been funded and broadcast. The cost of the mistake was an irreversible on-chain announcement that anchors an update no one can verify, with no signal at the point where the mistake was made.

The sign step is a single chokepoint. Both the state-machine path (the updater emits a signing-key need; the caller provides a signer) and the direct static path (scripts and the SDK calling `Updater.sign` outside the state machine) route through the same function ([ADR 025](025-sans-io-updater.md)). The SDK and the CLI both drive updates through it. A check placed there covers every write path; a check placed anywhere else has to be duplicated per consumer or is missed.

## Decision

### 1. Verify the signer's public key against the method's published key at the core sign step

`Updater.sign` compares the multibase-encoded public key carried by the signer's multikey against the named verification method's `publicKeyMultibase`. On mismatch it raises a typed update error and produces no proof. Both encodings are the same canonical form the document uses to record the key, so the comparison is a direct string equality of values already computed, not new cryptography.

Because the state-machine path and the direct static path both call `Updater.sign`, the guard protects the builder, the SDK, and the CLI from one place. None of those layers re-derives or re-compares keys; the error propagates through their existing error handling.

### 2. Fail fast, before funding and broadcast

The check runs at signing, the earliest point the mismatch is detectable and the phase before the update is funded or broadcast. A wrong signing key now costs nothing on-chain: the caller gets a clear, typed error that names the verification method, instead of an unverifiable update that is only discovered after an announcement is spent.

### 3. Skip the check only when the method publishes no key

The guard runs whenever the verification method carries a `publicKeyMultibase`, which a well-formed btcr2 Multikey method always does. When the field is absent, the guard does not invent a key to compare against and does not block signing; it is a consistency check between two stated keys, not a second validator of method shape.

### 4. Keep the resolver's verification as defense in depth

The sign-time guard does not replace the resolver's proof verification. A resolver still rejects any update whose proof signature does not match the document's published key, so an update that bypasses this guard (constructed by other means, or signed against a method an attacker controls while claiming the document's method id) is still caught at resolution ([ADR 016](016-sans-io-resolver.md)). The sign-time guard is the fast local fence that saves a wasted broadcast; the resolver is the trustless backstop that does not depend on the writer having run the fence.

## Consequences

- A wrong signing key fails immediately, at signing, with a typed error naming the verification method, rather than producing an update that fails silently and is only detected after an irreversible on-chain announcement.
- The guard is a string comparison of already-computed public-key encodings: no extra cryptography, no I/O. The sans-I/O contract of the sign step is preserved.
- Behavior changes for one case: a caller that previously signed with a mismatched key, which always produced a broken update, now receives an error instead of a broken update. This rejects only previously-broken input; it adds no API surface and removes none.
- The SDK and the CLI inherit the guard with no code change. A caller that points the update at the wrong stored key now gets the clear error in place of a wasted broadcast.

## Rejected alternatives

- **Check in the SDK or the CLI instead of the core sign step.** Each consumer would duplicate the derive-and-compare, and a future consumer could forget it. The core sign step is the one point every write path crosses, so the invariant belongs there.
- **Rely solely on the resolver's verification.** Correct but late. The mismatch would surface only at resolution, after the update is funded and broadcast, turning a local input error into a wasted irreversible on-chain spend. The resolver stays as the backstop; it is not a substitute for failing fast at the point of the mistake.
- **Compare raw public-key bytes rather than the multibase encoding.** Equivalent in result, but the verification method records the key as `publicKeyMultibase` and the signer's multikey exposes the same canonical multibase, so comparing the two encodings directly matches how the document states the key and needs no decode step.
