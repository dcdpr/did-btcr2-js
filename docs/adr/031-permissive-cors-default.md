---
title: "ADR 031: Permissive CORS Default for HTTP Transport"
---

# ADR 031: Permissive CORS by Default

**Status:** Accepted

**Date:** 2026-04-22

**Branch / PR:** `aggregation/http-transport`
**Depends on:** [ADR 028](028-http-transport-additive.md), [ADR 029](029-tls-only-confidentiality.md)

## Context

`HttpServerTransport` needs to decide a default CORS policy. Two deployment shapes are common:

- **Same-origin.** Operator serves webapp assets and the transport from one origin. No cross-origin request ever happens.
- **Cross-origin.** A third-party wallet webapp hosted at `wallet.example.com` wants to participate in an aggregation service hosted at `aggregator.example.com`. This is the goal case for "wallets are portable across operators."

The standard CORS concern is a site at `evil.example.com` making authenticated requests against a service the user has session cookies for, using ambient cookie authority. This attack (CSRF) does NOT apply to our transport because:

- Every request carries a `SignedEnvelope` in the body (ADR 029). The signature requires the DID's private key.
- Private keys live in origin-scoped browser storage (IndexedDB/localStorage/extension) that the browser's Same Origin Policy protects regardless of CORS.
- There is no cookie or bearer token for a cross-origin site to exploit.

`evil.example.com` can at most fetch public endpoints (`GET /v1/adverts`, `GET /v1/.well-known/aggregation`), neither of which exposes secrets.

## Options considered

1. **Same-origin only.** Safest by reflex; blocks the cross-origin wallet use case entirely.
2. **Allowlist by default.** Operators configure specific origins. Ecosystem integration requires per-wallet negotiation.
3. **Permissive (`Access-Control-Allow-Origin: *`).** Any webapp from any origin can interact with the transport.

## Decision

**Option 3.** Default `CorsPolicy` is `{ mode: 'permissive' }`. The server emits `Access-Control-Allow-Origin: *` on all responses (including OPTIONS preflights). Config can tighten to `{ mode: 'allowlist', origins: [...] }` or `{ mode: 'same-origin' }`.

## Consequences

**Positive**
- Third-party wallet webapps work out of the box against any aggregator. This is the "wallets portable across operators" goal from the transport rationale discussion.
- No CSRF risk: signed envelopes provide ambient-authority resistance for free.
- Operators who want to restrict interop for business or compliance reasons can opt into `allowlist` with one line of config.

**Negative**
- Permissive CORS on a public endpoint means any site can trigger rate-limited requests against the aggregator. Mitigated by the rate limiter (ADR 029's envelope verification still requires a valid signature before consuming tokens).
- Operators hosting reference webapps at the same origin as the transport may want `same-origin` mode for defense in depth; they need to make that choice explicitly.
- Third-party webapps at untrusted origins that themselves hold user keys become a security concern (supply-chain / XSS against the webapp origin can leak keys). **This is a browser key-storage concern, not a CORS concern**: but worth stating because operators will get questions about it.

**Explicitly accepted trade-offs**
- We do not attempt to restrict which origins can embed aggregation flows. Operators who need that tighten via `allowlist`.
- We do not ship per-origin rate limits (only per-verified-DID). Public endpoints are rate-limited by IP separately; this is the caller's HTTP framework's responsibility.

## References

- [`packages/method/src/core/aggregation/transport/http/server.ts`](../../packages/method/src/core/aggregation/transport/http/server.ts): `CorsPolicy` implementation.
- [ADR 029](029-tls-only-confidentiality.md): signed-envelope auth (why CORS is safe here).
