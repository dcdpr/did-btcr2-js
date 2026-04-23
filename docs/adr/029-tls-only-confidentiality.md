---
title: "ADR 029: TLS-Only Confidentiality for HTTP Transport"
---

# ADR 029: TLS-Only Confidentiality; Signed Envelopes for Authenticity

**Status:** Accepted

**Date:** 2026-04-22

**Branch / PR:** `aggregation/http-transport`
**Depends on:** [ADR 028](028-http-transport-additive.md)

## Context

The Nostr transport uses NIP-44 v2 for end-to-end confidentiality of directed messages, giving the service operator no visibility into participant-service payloads. The HTTP transport had to answer: does it preserve this property, and at what cost?

Two layers need consideration:

- **Confidentiality on the wire**: whoever observes network traffic.
- **Confidentiality from the operator**: whoever runs the aggregation service.

HTTPS (TLS 1.3) solves the first. The second requires message-layer encryption, which on Nostr is NIP-44 over ECDH.

Separately, **authenticity / non-repudiation** needs to be preserved so a third party can prove "did X sent message M at time T" without relying on the operator's word.

## Options considered

1. **Port NIP-44 v2 to HTTP bodies.** Ciphertext in POST bodies; unchanged threat model. ~10 lines of code, reuses existing `nostr-tools` dependency.
2. **Use HPKE (RFC 9180).** A purpose-built modern hybrid PKE scheme. More auditable than NIP-44; adds a dependency.
3. **TLS-only, message-layer BIP340 signatures for authenticity.** Operator sees plaintext of directed messages; signatures prevent impersonation and provide non-repudiation at the protocol layer.
4. **TLS-only, no authenticity layer.** Rely entirely on TLS + session tokens.

## Decision

**Option 3.** Every HTTP request body and SSE event carries a `SignedEnvelope`:

```ts
{ v, from, to?, timestamp, nonce, message, sig }
```

where `sig = BIP340(x-only-sk(from), sha256(canonicalize({v, from, to, timestamp, nonce, message})))`.

Server verification checks the signature against the sender's pubkey, rejects stale timestamps (±60s skew), and rejects replayed `(from, nonce)` pairs. TLS provides confidentiality in transit; operator plaintext access is an accepted consequence.

## Consequences

**Positive**
- Authenticity is cryptographically verifiable by any third party (no need to trust the operator).
- Non-repudiation of aggregation outputs is fully preserved: `SignedBTCR2Update` is signed at the payload layer; MuSig2 partial signatures are cryptographically verifiable against per-cohort pubkeys.
- No new crypto review scope: BIP340 + JCS canonicalization are already audited in `@did-btcr2/keypair` and `@did-btcr2/common`.
- Test fixtures are plain JSON: debugging and issue reproduction are trivial compared to encrypted bodies.

**Negative**
- The service operator can read plaintext of all directed messages they relay, including `SUBMIT_UPDATE` payloads. Mitigating factor: those payloads are already intended to be on-chain public data.
- Per-request signatures cost CPU (~100 µs BIP340 verify on commodity hardware). Negligible at aggregation protocol rates.
- Transport-level non-repudiation of cohort-formation messages (opt-in, nonce contributions, validation acks) is preserved by signatures but WOULD be readable by the operator. A compromised operator cannot forge these (they don't have participant keys) but CAN selectively drop them (already true for any aggregator in any transport).

**Explicitly accepted trade-offs**
- We are NOT defending against a malicious operator observing or leaking message contents. Participants in aggregation rounds have already decided to trust the operator for liveness; reading the payloads is a smaller incremental trust.
- Participants who require end-to-end privacy against the service operator should use the Nostr transport, which offers NIP-44 envelope encryption at the wire layer.

## References

- [`packages/method/src/core/aggregation/transport/http/envelope.ts`](../../packages/method/src/core/aggregation/transport/http/envelope.ts): sign/verify implementation.
- [ADR 028](028-http-transport-additive.md): why HTTP exists as a second transport.
