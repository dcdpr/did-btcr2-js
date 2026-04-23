---
title: "ADR 028: HTTP/REST as an Additive Transport for Aggregation"
---

# ADR 028: HTTP/REST as an Additive Transport for Aggregation

**Status:** Accepted

**Date:** 2026-04-22

**Branch / PR:** `aggregation/http-transport`

## Context

The aggregation subsystem in `@did-btcr2/method` (see [ADR 020](020-aggregation-layered-architecture.md)) initially shipped with a single transport implementation: Nostr. A second transport was requested for two reasons:

1. **Operability.** Nostr introduces relay pools, NIP-44 envelopes, and relay-discovery semantics. Ops and security-review staff without prior Nostr familiarity spend disproportionate effort on the transport layer vs. the protocol it carries.
2. **Ecosystem reach.** Browser participants and third-party wallet apps need a transport they can consume with zero special libraries: `fetch` + streaming, no relay infrastructure.

The aggregation protocol itself (MuSig2 + cohort formation) is transport-agnostic: runners, state machines, and message factories only see the `Transport` interface. This meant a second transport could be added without disturbing protocol code.

## Options considered

1. **Replace Nostr with HTTP.** Smallest surface; loses Nostr entirely.
2. **Add HTTP alongside Nostr.** Both transports coexist; users pick.
3. **Wait for DIDComm.** DIDComm v2 is an obvious fit semantically but has no mature TypeScript implementation suitable for browsers.
4. **WebSockets instead of REST + SSE.** Simpler duplex model; loses standard-REST tooling (curl, OpenAPI).

## Decision

**Option 2.** Add `HttpClientTransport` and `HttpServerTransport` as new `Transport` implementations. Preserve Nostr as-is. Extend the transport factory with a discriminated-union config so callers opt into either transport per deployment.

No changes to `AggregationService`, `AggregationParticipant`, `AggregationCohort`, `BeaconSigningSession`, runner code, message factories, guards, or constants.

## Consequences

**Positive**
- Operators choose per deployment; migrations are a config flip, not a rewrite.
- Browser participants get a native transport (fetch + fetch-based SSE).
- REST ecosystem tooling (curl, OpenAPI, standard reverse proxies, request logging) works out of the box.
- Testing is dramatically simpler: no relay needed, in-process parity tests bind client `fetchImpl` to server handlers.

**Negative**
- Double the transport surface to maintain. Two adapters, two test matrices, two sets of docs.
- The `TransportFactory` now carries a role discriminator (`{ type: 'http', role: 'client' | 'server' }`), slightly more ceremony than the original single-role shape.
- HTTP transport has a more centralized trust model than Nostr (see [ADR 029](029-tls-only-confidentiality.md)); operators must understand that distinction.

**Neutral**
- Message schemas, envelope formats, and protocol semantics stay identical across transports. Cross-transport interop at the protocol layer is preserved: a Nostr-based service and an HTTP-based service can both address the same did:btcr2 aggregation flows.

## References

- [`packages/method/docs/http-transport.md`](../../packages/method/docs/http-transport.md): wire protocol, Hono mount example, client snippet.
- [`packages/method/docs/aggregation.md`](../../packages/method/docs/aggregation.md): the transport-agnostic protocol spec this decision extends.
- `packages/method/src/core/aggregation/transport/http/`: implementation.
