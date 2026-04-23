# HTTP/REST Transport

The `@did-btcr2/method` package ships an additive HTTP/REST transport alongside the Nostr transport for aggregation. Both implement the same `Transport` interface, so runners, state machines, and message factories don't change when you swap transports.

This document walks through the wire protocol, shows a minimal Hono server, and demonstrates a browser-compatible client.

## When to use HTTP vs. Nostr

| | Nostr | HTTP/REST |
|---|:---:|:---:|
| Operational familiarity | relay pools, NIP-44 envelopes | curl, OpenAPI, standard ops tooling |
| Censorship resistance | multi-relay redundancy | single-operator trust |
| Browser compatibility | depends on lib | native (`fetch` + streaming) |
| E2E confidentiality | NIP-44 (operator can't read) | TLS-only (operator sees plaintext) |
| Test harness | requires relay | pure HTTP mock |

HTTP is additive: deployments can publish a `Btcr2AggregationService` endpoint alongside a Nostr relay presence and let participants pick.

## Wire protocol

All endpoints live under `/v1/`. Bodies are JSON; SSE streams use standard `text/event-stream` framing.

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/v1/adverts` | GET (SSE) | Broadcast cohort adverts | None (public) |
| `/v1/adverts` | POST | Publish advert (service → world) | Signed envelope in body |
| `/v1/messages` | POST | Directed protocol messages | Signed envelope in body |
| `/v1/actors/{did}/inbox` | GET (SSE) | Per-DID inbox stream | `Authorization: BTCR2-Sig …` |
| `/v1/.well-known/aggregation` | GET | Service metadata | None |

### Signed envelope

Every authenticated POST carries a `SignedEnvelope`:

```json
{
  "v":         1,
  "from":      "did:btcr2:k1q…",
  "to":        "did:btcr2:k1q…",
  "timestamp": 1713744000,
  "nonce":     "4a31…",
  "message":   { /* BaseMessage */ },
  "sig":       "f9ab…"
}
```

The signature is BIP340 over `sha256(canonicalize({v, from, to, timestamp, nonce, message}))`. The server:

1. Resolves the sender's pubkey (peer registry first; falls back to decoding `did:btcr2:k…` KEY identifiers).
2. Verifies the signature.
3. Rejects stale timestamps (default skew: 60s).
4. Rejects replayed `(from, nonce)` pairs (default window: 10k entries).
5. Applies rate limiting keyed on the verified `from` DID (default: 10 rps, burst 30).

### SSE subscription auth

`Authorization: BTCR2-Sig v=1,did=<did>,ts=<unix>,nonce=<hex>,sig=<hex>` where the signature commits to `{v, did, ts, nonce, path}`. `EventSource` is deliberately not used because it cannot carry custom headers; the client uses fetch-based SSE instead.

### Binary fields on the wire (`__bytes` convention)

Aggregation messages carry `Uint8Array` fields (public keys, MuSig2 nonces, partial signatures). `JSON.stringify(Uint8Array)` produces `{"0":1,"1":2,...}` — an object with numeric string keys — which does not round-trip back to a `Uint8Array` on the receiving side. Both the signature would still verify (both sides mangle identically) *and* the handler would receive a broken object.

To avoid that, the HTTP transport pre-processes every outbound message via `normalizeForWire`, replacing each `Uint8Array` with a `{ "__bytes": "<hex>" }` sentinel object, before signing and serialization. On the receive side, after signature verification, `reviveFromWire` walks the parsed JSON and restores each sentinel to a real `Uint8Array`. The sentinel is visible on the wire and must be implemented identically by any non-TypeScript client.

Round-trip contract:

```json
{ "participantPk": { "__bytes": "03a1b2c3…" } }     // on the wire
Uint8Array([0x03, 0xa1, 0xb2, 0xc3, …])             // in the handler
```

Keys other than `__bytes` in the same object disable the sentinel treatment (the object is taken literally). This is a single-key sentinel, not a schema marker.

## Service-side (Node + Hono)

The server is sans-I/O. Mount `handleRequest` and `handleSse` into any framework:

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { TransportFactory, AggregationServiceRunner } from '@did-btcr2/method';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { SseStream } from '@did-btcr2/method';

const serviceKeys = SchnorrKeyPair.generate();
const serviceDid  = /* did:btcr2:k… derived from serviceKeys */;

const transport = TransportFactory.establish({
  type: 'http',
  role: 'server',
  // permissive CORS by default; pass { cors: { mode: 'allowlist', origins: [...] } }
  // or { cors: { mode: 'same-origin' } } to tighten
});
transport.registerActor(serviceDid, serviceKeys);

const runner = new AggregationServiceRunner({
  transport,
  did:  serviceDid,
  keys: serviceKeys,
  /* onProvideTxData, onOptInReceived, onReadyToFinalize */
});

const app = new Hono();

// SSE routes
app.get('/v1/adverts', (c) => streamSSE(c, async (stream) => {
  await new Promise<void>((resolve) => {
    transport.handleSse(toReq(c), toSseStream(stream, resolve));
  });
}));
app.get('/v1/actors/:did/inbox', (c) => streamSSE(c, async (stream) => {
  await new Promise<void>((resolve) => {
    transport.handleSse(toReq(c), toSseStream(stream, resolve));
  });
}));

// Regular routes
app.on(['POST', 'GET', 'OPTIONS'], '/v1/*', async (c) => {
  const res = await transport.handleRequest(toReq(c));
  return c.body(res.body, res.status as 200, res.headers);
});

// Optional: serve the webapp from the same origin (trivial CORS)
// app.get('/*', serveStatic({ root: './webapp-dist' }));

serve({ fetch: app.fetch, port: 8080 });
```

The `toReq` / `toSseStream` adapters are thin (~20 lines) glue that turn Hono's `Context` into the framework-agnostic shapes. The same pattern works unchanged on Express, Fastify, Bun, and Cloudflare Workers.

## Participant-side (browser or Node)

```ts
import { TransportFactory, AggregationParticipantRunner } from '@did-btcr2/method';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

const participantKeys = /* loaded from browser key storage */;
const participantDid  = /* did:btcr2:k… derived from participantKeys */;

const transport = TransportFactory.establish({
  type:    'http',
  role:    'client',
  baseUrl: 'https://aggregator.example.com/',
});
transport.registerActor(participantDid, participantKeys);
transport.start();

const runner = new AggregationParticipantRunner({
  transport,
  did:  participantDid,
  keys: participantKeys,
  shouldJoin:       async (advert) => userConfirmsJoin(advert),
  onProvideUpdate:  async ()       => myUnsignedUpdate(),
  onValidateData:   async (data)   => userReviewsAggregated(data),
  onApproveSigning: async (req)    => userApprovesAuthorization(req),
});

runner.run();
```

The runner emits typed events (`cohort-advert`, `round-progress`, `cohort-complete`) that a UI layer binds to DOM state. The runner, the participant state machine, and MuSig2 signing session are unchanged from the Nostr-transport path.

## Configuration

### `HttpServerTransportConfig` (server side)

| Option | Default | Purpose |
|---|---|---|
| `cors` | `{ mode: 'permissive' }` | `permissive` emits `Access-Control-Allow-Origin: *`. Also `{ mode: 'allowlist', origins: [...] }` or `{ mode: 'same-origin' }`. |
| `clockSkewSec` | 60 | Envelope + auth-header timestamp tolerance. |
| `inboxBufferSize` | 100 | Per-recipient inbox ring buffer — replay window for SSE reconnects via `Last-Event-ID`. |
| `advertTtlMs` | 5 min | How long a cached advert is replayed to new broadcast-SSE subscribers. |
| `rateLimiter` | `new RateLimiter()` | Pluggable. Default: per-DID token bucket, 10 rps, burst 30. Swap in a Redis-backed store for multi-instance deployments. |
| `nonceCache` | `new NonceCache()` | Pluggable anti-replay. Default: FIFO 10k entries per process. |
| `heartbeatIntervalMs` | 20 000 | SSE keepalive comment interval. `0` disables. |
| `logger` | `CONSOLE_LOGGER` | Injectable `Logger` (`debug` / `info` / `warn` / `error`). |

### `HttpClientTransportConfig` (client side)

| Option | Default | Purpose |
|---|---|---|
| `baseUrl` | (required) | Full URL including scheme and optional path prefix. Must end in `/`; added automatically if missing. |
| `fetchImpl` | `globalThis.fetch` | Custom fetch for tests, Workers, React Native. |
| `clockSkewSec` | 60 | Envelope clock-skew tolerance. |
| `reconnectBackoff` | `1s → 30s` expo + 20% jitter | SSE reconnect policy. |
| `logger` | `CONSOLE_LOGGER` | Same as server side. |

## Runnable reference implementation

`packages/method/lib/operations/aggregation/e2e-http-transport.ts` is a ~180-line standalone demo: it boots an in-process `node:http` server hosting `HttpServerTransport`, creates two real HTTP clients, and runs a full 3-party MuSig2 aggregation round over loopback HTTP. No external dependencies — the single file is a complete server-side framework adapter plus a full end-to-end exercise.

```bash
PORT=8080 npx tsx packages/method/lib/operations/aggregation/e2e-http-transport.ts
```

Emits one 64-byte aggregated Schnorr signature per run, then exits cleanly.

## Discovery (v1.1)

For v1 a known `baseUrl` is passed directly. A future release will publish service endpoints in DID documents under a `Btcr2AggregationService` service entry so participants can resolve a service operator's DID to find the URL.

## Limitations

- **Operator-trusted authenticity.** Unlike NIP-44-encrypted Nostr messages, TLS-only HTTP leaks directed-message plaintext to the service operator. The protocol's own payload signatures (signed updates, partial sigs) preserve non-repudiation of aggregation outputs.
- **Single operator per cohort.** No built-in multi-operator redundancy. Operators who fail to broadcast can censor individual updates; participants detect by failing resolution and switching operators.
- **Rate limiter defaults are intentionally generous** (10 rps / DID) to avoid tripping normal cohort flows. Operators hosting public aggregators should tighten based on observed traffic.
