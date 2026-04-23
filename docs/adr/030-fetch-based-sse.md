---
title: "ADR 030: Fetch-Based SSE over Native EventSource"
---

# ADR 030: Fetch-Based SSE over Native EventSource

**Status:** Accepted

**Date:** 2026-04-22

**Branch / PR:** `aggregation/http-transport`
**Depends on:** [ADR 028](028-http-transport-additive.md)

## Context

Both the broadcast advert stream and the per-DID inbox are Server-Sent Events (SSE) endpoints. The standard browser API for SSE is `EventSource`, which:

- Has native browser + Deno support.
- Automatically reconnects with `Last-Event-ID` resume.
- Is GET-only and **cannot set custom HTTP headers**.

The inbox stream at `GET /v1/actors/{did}/inbox` requires authentication: otherwise any actor can subscribe to any DID's inbox and observe metadata about who's participating in which cohorts. That authentication needs to commit to at least `(did, timestamp, nonce, path)` and be signed by the DID's key.

The missing-headers restriction on `EventSource` forces auth credentials into the URL, which is problematic:

- URLs appear in HTTP access logs, proxy logs, and browser history.
- Credentials-bearing URLs can accidentally be shared in screenshots, stack traces, or error reports.
- Token rotation becomes awkward (reconnect changes the URL).

## Options considered

1. **Native `EventSource` + signed query parameter.** Works everywhere but leaks credentials to logs.
2. **Native `EventSource` + cookie-based auth.** Requires server-side sessions (rejected by [ADR 029](029-tls-only-confidentiality.md)'s stateless model).
3. **Fetch + `ReadableStream` + manual SSE frame parsing.** Headers work; we own ~40 lines of parser.
4. **WebSocket with an auth subprotocol.** Full duplex; loses standard SSE tooling (proxies, curl compatibility).

## Decision

**Option 3.** The `HttpClientTransport` implements SSE using `fetch()` + `ReadableStream` + a small `parseSseStream` async generator. Inbox subscribe requests carry auth in an `Authorization: BTCR2-Sig …` header. Automatic reconnection uses exponential backoff (default 1s to 30s with 20% jitter).

The parser is ~80 LOC in `sse-stream.ts` and handles:
- LF and CRLF line terminators
- Multi-line `data` fields
- `event`, `id`, `retry` fields (with spec-compliant validation)
- `:`-prefixed comments (heartbeats)
- Chunk splits mid-line and mid-event

## Consequences

**Positive**
- Auth semantics are clean: one `Authorization` header, identical across POSTs and SSE GETs.
- No credentials in URLs, logs, or history.
- `AbortController` to aborted fetch to clean stream unwind. Cancellation is trivially composable with the rest of the client.
- Runs identically in browsers, Node 22+, Deno, Bun, Cloudflare Workers, and React Native.
- Test doubles can drive a `ReadableStream` controller to deliver synthetic SSE events deterministically.

**Negative**
- We own the SSE parser. It's small and test-coverage is high, but it's ~80 LOC of correctness-sensitive code.
- We don't inherit the built-in automatic reconnect from `EventSource`: we implement reconnect with backoff ourselves. Small amount of code, full control.
- Legacy browsers without streaming `fetch` support (pre-2020 Edge, ancient Safari) are unsupported. Acceptable given the broader Node 22+ runtime requirement.

**Explicitly accepted trade-offs**
- We do not ship `EventSource` compatibility for the inbox stream. Any future need for standard `EventSource` (e.g., if a third-party wants to consume adverts with vanilla browser APIs) can still use it against the unauthenticated `GET /v1/adverts` endpoint.

## References

- [`packages/method/src/core/aggregation/transport/http/sse-stream.ts`](../../packages/method/src/core/aggregation/transport/http/sse-stream.ts): parser.
- [`packages/method/src/core/aggregation/transport/http/sse-writer.ts`](../../packages/method/src/core/aggregation/transport/http/sse-writer.ts): server-side frame formatter (pairs with the parser).
- [`packages/method/src/core/aggregation/transport/http/request-auth.ts`](../../packages/method/src/core/aggregation/transport/http/request-auth.ts): `BTCR2-Sig` scheme.
