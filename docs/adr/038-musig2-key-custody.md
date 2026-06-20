---
title: "ADR 038: MuSig2 Key Custody - Bounded, Zeroized Secrets at the Participant Boundary"
---

# ADR 038: MuSig2 Key Custody - Bounded, Zeroized Secrets at the Participant Boundary

**Status:** Accepted

**Date:** 2026-06-20

**Branch / PR:** `feat/aggregation-kms`
**References:** [ADR 008](008-aggregation-subsystem-inception.md), [ADR 020](020-aggregation-layered-architecture.md), [ADR 034](034-key-manager-capability-pattern.md), [ADR 037](037-single-party-beacon-and-two-axis-model.md)

## Context

[ADR 008](008-aggregation-subsystem-inception.md) chose **MuSig2 (BIP-327) over a Taproot key-path** as the aggregate-signing primitive and set the trust model: the coordinator is trusted for **liveness only, never signing authority**, and every participant **self-custodies** its key. [ADR 020](020-aggregation-layered-architecture.md) placed keys in the layer-2 wrapper classes (`AggregationParticipant`, `AggregationService`), outside the pluggable transport. [ADR 037](037-single-party-beacon-and-two-axis-model.md) shipped the two-axis beacon model and explicitly deferred "the MuSig2 key-custody story (KMS)" to a later ADR. This is that ADR: it pins down exactly how a participant's raw secret is held and handled across a signing round.

**MuSig2 requires the raw 32-byte secret, twice, and a generic signer cannot stand in.** A participant's secret enters the protocol at two call sites in [`signing-session.ts`](../../packages/method/src/core/aggregation/signing-session.ts):

- `nonceGen(publicKey, secretKey, aggPublicKey)` derives the per-session secret/public nonce pair. BIP-327 mixes the signer's own secret into the nonce derivation as a hardening measure against weak RNGs; this is nonce *pre-generation*, not "signing a message," and it must also take the cohort aggregate pubkey.
- `Session.sign(secretNonce, secretKey)` computes the partial signature `s_i = k1 + b*k2 + e*a_i*d_i (mod n)`, where `d_i` is the raw scalar secret, `a_i` is this signer's key-aggregation coefficient (derived from the full cohort key set), `e` is the challenge over the **aggregate** nonce and pubkey, and `(k1, k2)` are this session's secret nonce.

A generic `KeyManager.sign(message)` / `Signer.sign(data, scheme)` is a one-shot `(digest) -> signature` primitive. It cannot express MuSig2: there is no stateful nonce-commitment round, no hook to feed back the aggregated nonce, and a partial signature is not a standalone `bip340`/`bip341` signature that any `SigningScheme` can return. The secret must remain a raw scalar so the library can multiply it by `a_i` and add the nonce scalars. The only `KeyManager` route to the raw secret is `exportKey()` (the [ADR 034](034-key-manager-capability-pattern.md) `canExport` capability), which defeats a non-extractable / HSM-backed manager: a `canExport: false` manager cannot participate in aggregation at all. **Full KMS opacity is therefore mathematically unavailable for MuSig2.**

**What the current code actually does** (verified against the source):

- `AggregationParticipant` holds its secret as a long-lived `public readonly keys: SchnorrKeyPair` field, set once in the constructor and **never cleared**. The raw secret is reachable as `participant.keys.secretKey.bytes` for the participant's entire lifetime (potentially many cohorts).
- Each MuSig2 call dereferences `this.keys.secretKey.bytes` ([`participant.ts`](../../packages/method/src/core/aggregation/participant.ts) nonce + partial-sign paths). The `.bytes` getter returns a **fresh copy** each access; those transient copies are passed into `nonceGen` / `Session.sign` and are **never wiped**.
- The only secret that is zeroized today is the MuSig2 **secret nonce** (`secretNonce.fill(0)` in `generatePartialSignature`), and only on the **success path**. `secretNonce` is a **public** mutable field, and on an aborted or failed session it is never cleared. There is no `dispose()` / `clear()` and no cleanup on any failure or phase-transition path.
- `AggregationService` (the coordinator) **already never receives a participant secret**: it ingests only public keys, public nonce contributions, and partial signatures, and aggregates them. Its own `keys` field, however, is typed as a full `SchnorrKeyPair` even though only `this.keys.publicKey.compressed` is ever read - the type permits a secret the code never uses.
- **No reusable secret-wipe utility exists.** The only zeroization anywhere in `common` / `key-manager` / `keypair` is `Secp256k1SecretKey.destroy()` (opt-in, never called from the aggregation path) and the one ad-hoc nonce `fill(0)`.
- `AggregationRunner.solo()` aliases the **same** secret-bearing keypair into the transport actor registry, the runner, and the session, widening the read surface for the secret.

The design question this ADR answers: **how does a participant supply its raw secret to the two MuSig2 calls without holding it for its whole lifetime, without leaking unwiped copies, and without the coordinator or transport ever touching it?**

|  | Secret lifetime | Zeroization | Coordinator holds secret? | MuSig2 works? |
| --- | --- | --- | --- | --- |
| **A** — route through `KeyManager.sign()` (KMS-opaque) | n/a | n/a | no | **no** (partial sig not expressible; only `exportKey()` yields the secret) |
| **B** — bound + zeroized at the participant boundary *(chosen)* | one signing session | all transient copies + nonce, all paths | no (type-enforced) | yes |
| **B2** — KMS-native MuSig2 capability (secret never copied out) | inside the keypair/KMS | inherent (no copy-out) | no | yes |
| **C** — status quo | participant lifetime | nonce only, success path only | no | yes |

## Decision

Adopt **Option B: confine the raw secret to a per-signing-session boundary that zeroizes after use, and make the coordinator's pubkey-only status a type-level invariant.** The secret crosses no boundary outward; only public material (compressed pubkey, public nonce, partial signature) leaves the participant.

1. **Bound the secret's lifetime to a signing session, not the participant.** Replace the long-lived `keys: SchnorrKeyPair` on `AggregationParticipant` with a narrower secret-provider boundary: the raw secret is yielded to the two MuSig2 calls only for the duration of nonce-generation and partial-signing (a scoped `withSecret(fn)` / per-session signer), after which the transient copy is wiped. The participant no longer retains a secret-bearing keypair across cohorts.
2. **Add a reusable zeroization utility** (`wipe(bytes: Uint8Array)`), shared from the keypair/common layer, and apply it to **every transient raw-secret copy** at the `nonceGen` and `Session.sign` call sites. This complements the existing `Secp256k1SecretKey.destroy()` rather than re-inventing it.
3. **Give `BeaconSigningSession` deterministic secret-nonce teardown on all paths.** Make `secretNonce` private, add an explicit `clear()` / `dispose()` that zeroizes it, and invoke it on **abort, failure, and completion** - not only on the success path of `generatePartialSignature`. A second partial-sign attempt continues to throw rather than reuse a nonce (MuSig2 nonce reuse is catastrophic key leakage).
4. **Narrow the coordinator to a public-key type.** Type `AggregationService` (and `AggregationServiceRunner`) key material as public-key-only, since the service never signs. This turns "the coordinator never holds signing authority" ([ADR 008](008-aggregation-subsystem-inception.md)) from a runtime fact into a **compile-time invariant**.
5. **Keep secrets out of the transport registry.** `AggregationRunner.solo()` registers only public keys with the transport actor registry; the secret stays at the participant boundary and is not aliased across the runner/transport/session.

### Rejected alternatives

- **Option A - route MuSig2 through `KeyManager.sign()` (full KMS opacity).** Mathematically impossible: a MuSig2 partial signature is not a one-shot signature over a digest, and the only `KeyManager` path to the raw scalar is `exportKey()` ([ADR 034](034-key-manager-capability-pattern.md)), which defeats a non-extractable manager. A `canExport: false` / HSM manager cannot aggregate at all.
- **Option B2 - push MuSig2 into the keypair/KMS as first-class capabilities** (`musig2NonceGen` / `musig2PartialSign`) so the raw bytes never leave `Secp256k1SecretKey`. This is the **strongest** custody (no copy-out at all) and aligns with the [ADR 034](034-key-manager-capability-pattern.md) capability pattern, but it widens the keypair/key-manager API with protocol-specific, two-round stateful MuSig2 state. **Deferred, not discarded:** it is the natural follow-on once the bounded/zeroized boundary from Option B exists, and it is the only path that removes the raw-secret-in-process requirement. It warrants its own ADR.
- **Option C - status quo.** Unbounded secret lifetime (participant-lifetime field), unwiped transient copies, and nonce cleanup only on the success path. This is the baseline Option B moves off of.

## Consequences

**Positive**
- The secret's in-memory exposure window shrinks from "participant lifetime" (many cohorts) to "one MuSig2 round."
- Defense in depth: every transient secret copy and the secret nonce are wiped on **all** terminal paths via one shared, testable utility, instead of a single ad-hoc success-path `fill(0)`.
- "The coordinator never holds signing authority" becomes a compile-time invariant, not just an observed runtime property.
- The transport actor registry holds only public keys.

**Negative**
- MuSig2 still requires the raw secret **in process** at the participant. Aggregation cannot be driven by a non-extractable / HSM `KeyManager` (`canExport: false`); that remains a documented limitation until Option B2 is adopted.
- Zeroization in a managed-memory runtime (V8) is **best-effort, not a guarantee**: the garbage collector may relocate or copy buffers, and we cannot wipe copies the runtime makes internally. We wipe the `Uint8Array` buffers we control and document the residual rather than overstating the guarantee.
- Replacing the long-lived `keys` field changes the `AggregationParticipant` constructor and the runner option shapes (a `method` version bump; the change is confined to the aggregation API surface).

**Accepted**
- Best-effort wipe and raw-secret-in-process for MuSig2 are the accepted residual risk for this stage. **Option B2 (KMS-native MuSig2)** is the path to remove the in-process requirement and is deferred to its own ADR once this boundary lands.

## References

- [`packages/method/src/core/aggregation/signing-session.ts`](../../packages/method/src/core/aggregation/signing-session.ts): the two raw-secret entry points (`generateNonceContribution`, `generatePartialSignature`) and the secret-nonce field to make private and clear on all paths.
- [`packages/method/src/core/aggregation/participant.ts`](../../packages/method/src/core/aggregation/participant.ts): the long-lived `keys` field and the two `keys.secretKey.bytes` dereferences to bound and wipe.
- [`packages/method/src/core/aggregation/service.ts`](../../packages/method/src/core/aggregation/service.ts): already pubkey-only in behavior; narrow the `keys` type to a public-key handle.
- [`packages/method/src/core/aggregation/runner/aggregation-runner.ts`](../../packages/method/src/core/aggregation/runner/aggregation-runner.ts): stop aliasing the secret-bearing keypair into the transport registry in `solo()`.
- [`packages/keypair/src/secret.ts`](../../packages/keypair/src/secret.ts): `Secp256k1SecretKey.destroy()` and the copy-returning `bytes` getter the shared `wipe()` utility complements.
- [ADR 008](008-aggregation-subsystem-inception.md): the MuSig2 trust model (coordinator liveness-only, participants self-custody). [ADR 020](020-aggregation-layered-architecture.md): keys live in the layer-2 wrappers. [ADR 034](034-key-manager-capability-pattern.md): the `canExport` capability that Option B2 would extend. [ADR 037](037-single-party-beacon-and-two-axis-model.md): flagged this key-custody stage as next.
