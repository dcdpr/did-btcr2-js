---
title: "ADR 032: Sans-I/O handleRequest / handleSse Primitives"
---

# ADR 032: Sans-I/O handleRequest / handleSse Primitives

**Status:** Accepted

**Date:** 2026-04-22

**Branch / PR:** `aggregation/http-transport`
**Depends on:** [ADR 028](028-http-transport-additive.md)

## Context

`HttpServerTransport` has to integrate with many HTTP framework choices that a service operator might prefer: Hono, Express, Fastify, Bun's native server, Cloudflare Workers, Deno Deploy, AWS Lambda, etc. Each has different primitives for:

- Parsing incoming requests
- Writing JSON responses
- Writing SSE streams (backpressure, flushing, close detection)

The codebase also has a standing constraint: **all code must be browser-compatible; no Node.js-only APIs**. This precludes bundling `node:http` as an internal dependency even for the server side: server deployments might run in Workers or Deno.

Existing precedent in the repo for I/O-agnostic patterns:
- `bitcoin/src/connection.ts` uses an injected `HttpExecutor` so the Bitcoin RPC layer stays pure.
- `Resolver` and `Updater` state machines are sans-I/O and emit typed `DataNeed` requests (see [ADR 016](016-sans-io-resolver.md)).

## Options considered

1. **Bundle `node:http` internally.** Node-only; violates browser-compat constraint and locks out Workers/Deno deployments.
2. **Framework-specific adapters.** Ship `@did-btcr2/method/transport/http/express`, `@did-btcr2/method/transport/http/hono`, etc. Multiple adapters to maintain, and new frameworks need us to add support.
3. **Expose a single `fetch`-style handler.** The server is a `(Request) => Promise<Response>` function. Idiomatic in Workers / Deno; awkward for Express.
4. **Expose sans-I/O `handleRequest` / `handleSse` primitives over framework-agnostic `HttpRequestLike` / `HttpResponseLike` / `SseStream` types.**

## Decision

**Option 4.** `HttpServerTransport` exposes two methods:

```ts
handleRequest(req: HttpRequestLike): Promise<HttpResponseLike>;
handleSse(req: HttpRequestLike, stream: SseStream): void;
```

The caller writes ~15–30 lines of framework-specific glue to convert their framework's request/response/stream primitives into and out of these shapes. The transport has zero direct I/O dependencies.

`HttpRequestLike` is a plain structural type: `{ method, url, headers, body?, remoteAddr? }`. `HttpResponseLike` is `{ status, headers, body }`. `SseStream` has `writeEvent`, `writeComment`, `close`, `onClose`.

## Consequences

**Positive**
- One transport implementation works across every HTTP framework. New frameworks (e.g., a future Bun-native or Deno Deploy) work with no transport changes.
- The transport runs identically in Node, Cloudflare Workers, Deno Deploy, AWS Lambda, and any edge runtime that exposes request/response objects.
- Unit tests invoke `handleRequest` directly: no HTTP server needed, making tests both faster and more deterministic.
- The parity test binds the client's `fetchImpl` to the server's handlers in-process, proving end-to-end wire correctness without a real network.

**Negative**
- Each operator writes adapter code for their chosen framework (~15–30 lines). Boilerplate, but entirely conventional.
- Error contexts from the HTTP framework layer (timing, backpressure warnings, connection-level diagnostics) are not visible to the transport. Operators needing those concerns pair the transport with their framework's existing observability.
- SSE backpressure handling is the adapter's responsibility. The transport's `SseStream.writeEvent` is synchronous from its perspective; adapters implementing it over Hono streams need to handle their framework's write-signalling.

**Explicitly accepted trade-offs**
- No built-in Node HTTP server ships with the package. Operators wanting a turnkey Node server use the Hono snippet in [`http-transport.md`](../../packages/method/docs/http-transport.md) as a starting point, or the `node:http` adapter demonstrated in [`lib/operations/aggregation/e2e-http-transport.ts`](../../packages/method/lib/operations/aggregation/e2e-http-transport.ts).
- The framework-agnostic interface is slightly more work for simple Node deployments than a single-framework built-in would be. This cost is paid once per operator and is recovered many times over by running the same transport in Workers / Deno / etc.

## References

- [`packages/method/src/core/aggregation/transport/http/server.ts`](../../packages/method/src/core/aggregation/transport/http/server.ts): `HttpServerTransport`, `HttpRequestLike`, `HttpResponseLike`, `SseStream`.
- [`packages/method/docs/http-transport.md`](../../packages/method/docs/http-transport.md): Hono mount example.
- [`packages/method/lib/operations/aggregation/e2e-http-transport.ts`](../../packages/method/lib/operations/aggregation/e2e-http-transport.ts): `node:http` adapter + full protocol run.
- `packages/bitcoin/src/connection.ts`: precedent for injected `HttpExecutor` pattern.
