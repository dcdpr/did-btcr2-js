---
'@did-btcr2/cryptosuite': major
---

Harden proof creation, verification, and multikey serialization against tampering and temporal misuse.

BREAKING:

- `addProof` no longer mutates its input: it returns a fresh secured document built from a deep copy, and the proof configuration is deep-cloned at proof boundaries, so post-hoc mutation of the caller's document or config cannot alter the secured document (and vice versa).
- `verifyProof` now enforces temporal validity at the shared verification chokepoint: a malformed or elapsed `proof.expires`, or a `proof.created` too far ahead of the reference time, throws a `PROOF_VERIFICATION_ERROR`. Verification of historically anchored proofs should pass the anchoring block time via the new `referenceTime` option, since evaluation defaults to the wall clock.
- An empty `expectedDomain` array now throws instead of passing the domain check vacuously.

Added:

- `ProofVerificationOptions` with an optional `referenceTime` against which `proof.expires` and `proof.created` are evaluated (with a five-minute clock-skew tolerance on `created`).
- `expectedDomain` accepts a single string or an array of strings; multiple domains use AND semantics (every expected domain must be present in the proof's domain list).
- `PublicMultikeyObject`: the public-only serialization shape returned by `SchnorrMultikey.toJSON()` (and `JSON.stringify`). The secret-bearing shape remains available as `MultikeyObject` via the explicit `exportJSON()`.

Fixed:

- Domain matching in `verifyProof` was inverted: a proof whose domain list contained every expected domain was rejected. Every expected domain must now be present in the proof's domain list.
- `SchnorrMultikey.toJSON()` serializes public material only, so logging or returning a stringified multikey can no longer leak the secret key.
- Transient secret bytes pulled from the keypair for signing are wiped after use.
