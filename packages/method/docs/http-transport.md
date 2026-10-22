# HTTP/REST Transport

The `@did-btcr2/aggregation` package ships an additive HTTP/REST transport alongside the Nostr transport. Both implement the same `Transport` interface, so runners, state machines, and message factories don't change when you swap transports. Every symbol imported below comes from `@did-btcr2/aggregation` (or its role entries `@did-btcr2/aggregation/core`, `/participant`, `/service`), not from `@did-btcr2/method`, which owns no aggregation code.

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
| `/v1/adverts` | POST | Publish advert (service to world) | Signed envelope in body |
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

The signature is BIP340 over `sha256(canonicalize({v, from, to, timestamp, nonce, message}))`. The `nonce` must be 16 to 64 bytes of lowercase hex: 32 to 128 characters, an even count.

The server checks each authenticated POST in this order:

1. The body size. A body string longer than `maxBodyBytes` (default 65536) gets `413 payload_too_large`.
2. The body shape. No body, a body that does not parse as JSON, and `null` get `400 invalid_json`. Each other JSON value that is not an envelope (for example `0`, `false`, `""`, or `[]`) gets `400 malformed_envelope`. An envelope is an object with a non-empty string `from` and an object `message`.
3. The sender key. The server looks in the peer registry first. If the DID is not there, the server calls the injected `resolveSenderPk`, for example `resolveBtcr2SenderPk`, which decodes a `did:btcr2:k…` KEY identifier. A sender with no key gets `401 unknown_sender`.
4. The envelope verification: the version, the timestamp skew (default 60 s), the nonce form, and the signature. A failure gets `401 invalid_envelope`.
5. The replay lookup. A live `(from, nonce)` entry gets `409 replay`. The lookup stores nothing and uses no rate-limit token. Thus a replay of a captured envelope cannot empty the bucket of its sender.
6. The rate limiter, keyed on the verified `from` DID (default: 10 rps, burst 30). A throttled request gets `429 rate_limited`, and the server stores no nonce for it. The sender can send the same envelope again after the refill.
7. The nonce store. The entry lives for 2 x `clockSkewSec` (120 s by default). A replay can pass the skew check only for that time.

On `POST /v1/messages`, a sender with no key at step 3 can still send a `COHORT_OPT_IN` with its genesis document (an EXTERNAL `x1` DID). The server gets the key from that document and checks that the advertised `communicationPk` is that key. Then it verifies the envelope with that key. If one of these checks fails, the server answers `401 unknown_sender`. The server registers the key as a peer only after the request passes each check.

After these steps, `POST /v1/messages` checks the message:

- An envelope with no `to` gets `400 missing_recipient`. A `to` that is not an actor of the server gets `404 unknown_recipient`.
- A message that does not revive (for example a malformed `__bytes` sentinel) gets `400 malformed_message`.
- An inner `from` that is not the envelope `from` gets `401 sender_mismatch`.
- A message whose `type` is not a non-empty string gets `400 missing_message_type`.
- Else the server calls the handler of the recipient and answers `202 {"ok":true}`. A handler throw gets a debug line, and the answer stays `202`.

An unknown route, and a request target that is not a valid URL, get `404 not_found`. An unexpected throw gets an error line and `500 internal_error`.

### SSE subscription auth

`Authorization: BTCR2-Sig v=1,did=<did>,ts=<unix>,nonce=<hex>,sig=<hex>` where the signature commits to `{v, did, ts, nonce, path}`. The `nonce` must be 16 to 64 bytes of lowercase hex, as in an envelope. `EventSource` is deliberately not used because it cannot carry custom headers; the client uses fetch-based SSE instead.

The server checks an inbox subscription in the same order as an envelope:

1. The sender key of the DID in the path.
2. The header verification: the version, the timestamp skew, the nonce form, and the signature. The `did` of the header must also be the DID in the path.
3. The replay lookup, the rate limiter, and the nonce store.

Each refusal closes the stream. A request with no `Authorization` header also closes the stream.

### Adverts

`GET /v1/adverts` sends the current advert to each new subscriber, if the advert is within its TTL (`advertTtlMs`). Then it sends each new advert. The current advert comes from one of two sources:

- A local advert: `publishRepeating` of a server actor. The server signs it one time for all live subscribers. At delivery, the server signs it again if its envelope is older than `clockSkewSec / 2`. If the sender is no longer an actor, or the sign fails, the server does not send it. The stop function of `publishRepeating` removes it.
- A posted advert: `POST /v1/adverts`. The server relays the envelope verbatim and does not sign it again. The poster publishes it again on its own interval. A client drops a posted advert if the envelope is older than the `clockSkewSec` of the client. Thus a late subscriber gets the advert only after the next post.

`POST /v1/adverts` uses the checks of the [signed envelope](#signed-envelope), with these changes:

- The envelope must have no `to`. An envelope with a `to` gets `401 invalid_envelope`. Else a recipient can post an inbox envelope of an actor as an advert.
- While a local advert is within its TTL, each post gets `409 local_advert`. This check runs after the verification and before the replay lookup, so it stores no nonce and uses no token. Thus a post of the delivered local envelope cannot replace the local advert.
- A sender that is not an actor of the server gets `403 not_an_actor`.
- A message that does not revive gets `400 malformed_message`. An inner `from` that is not the envelope `from` gets `401 sender_mismatch`.
- Else the server keeps the advert as the current advert, sends it to each broadcast subscriber, and answers `202 {"ok":true}`.

### Inbox delivery and resume

The server keeps the last `inboxBufferSize` events of each recipient DID in a buffer. Each event has the id `<epoch>-<seq>`:

- The epoch is 16 lowercase hex characters. It is random for each buffer, so a new buffer (for example after a server restart) has a new epoch.
- The seq is a decimal integer. It starts at 1 and increases by 1 for each event.

A subscriber sends the id of its last event in `Last-Event-ID`. If the id is an id of the buffer, the server sends only the later events. For each other value (no id, a malformed id, or an id of another buffer), the server sends every retained event.

`HttpClientTransport` keeps the id of the last inbox event of each actor (the resume id). It sends the resume id in `Last-Event-ID` at each reconnect. `stop()` and `start()` keep the resume id. A new `registerActor` starts with no resume id. The client ignores an id that is longer than 256 characters or that holds a character outside 0x21 to 0x7E. An empty id clears the resume id.

The server signs each inbox event at `sendMessage`, one time for all live subscribers. At delivery, the server signs the message of a buffered event again if its envelope is older than `clockSkewSec / 2`. The server uses the current keys of the sender actor. The new envelope replaces the buffered envelope, and the event id does not change. Thus a late subscriber gets an envelope that passes the skew check of the client. If the sender is no longer an actor, or the sign fails, the server skips the event and sends the next events.

### Binary fields on the wire (`__bytes` convention)

Aggregation messages carry `Uint8Array` fields (public keys, MuSig2 nonces, partial signatures). `JSON.stringify(Uint8Array)` produces `{"0":1,"1":2,...}` (an object with numeric string keys) which does not round-trip back to a `Uint8Array` on the receiving side. Both the signature would still verify (both sides mangle identically) *and* the handler would receive a broken object.

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
import { TransportFactory, AggregationServiceRunner } from '@did-btcr2/aggregation';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { SseStream } from '@did-btcr2/aggregation';

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
import { TransportFactory, AggregationParticipantRunner } from '@did-btcr2/aggregation';
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
| `clockSkewSec` | 60 | Envelope + auth-header timestamp tolerance. A replay cache entry lives for 2 x this value. At delivery, the server signs a buffered inbox event or a local advert again if its envelope is older than half of this value. |
| `inboxBufferSize` | 100 | Per-recipient inbox ring buffer: the events that a reconnect with `Last-Event-ID` can get. A full buffer drops its oldest event. See [Inbox delivery and resume](#inbox-delivery-and-resume). |
| `advertTtlMs` | 5 min | How long a cached advert is replayed to new broadcast-SSE subscribers. |
| `rateLimiter` | `new RateLimiter()` | Pluggable. Default: per-DID token bucket, 10 rps, burst 30. Swap in a Redis-backed store for multi-instance deployments. |
| `nonceCache` | `new NonceCache()` | Pluggable anti-replay cache. Default: 10,000 entries per process (`maxEntries`, an integer >= 1). An entry lives for 2 x `clockSkewSec`. If the cache is full of live entries, it deletes the live entry that expires first. The server then writes a warn line, at most one for each `clockSkewSec` window. A replay of an evicted envelope passes until its timestamp leaves the skew window. |
| `heartbeatIntervalMs` | 20 000 | SSE keepalive comment interval. `0` disables. |
| `maxBodyBytes` | 65 536 | The largest body of an authenticated POST request, as the length of the body string. A larger request gets `413 payload_too_large` before the server parses its body. |
| `resolveSenderPk` | none | Gives the key of a sender DID that is not a registered peer. On a bootstrap opt-in, the server also gives the `genesisDocument` of the sender. For did:btcr2, use `resolveBtcr2SenderPk`. With no function, the server accepts only registered peers. See [Sender authentication](./aggregation.md#sender-authentication). |
| `now` | `Date.now` | The clock of the server, in unix milliseconds. It drives the envelope and auth-header skew checks, the replay cache expiry, the rate limiter, the advert TTL, and the timestamp of each envelope that the server signs. |
| `logger` | `CONSOLE_LOGGER` | Injectable `Logger` (`debug` / `info` / `warn` / `error`). |

### `HttpClientTransportConfig` (client side)

| Option | Default | Purpose |
|---|---|---|
| `baseUrl` | (required) | Absolute URL of the service, with an optional path prefix. The client adds a final `/` if the path has none. The URL must use `https`, and it must not hold a username or a password. The client accepts plain `http` only for a loopback host, or if `allowInsecureHttp` is `true`. Else a plain `http` URL gives `INSECURE_BASE_URL`. A loopback host is an IPv4 address in 127.0.0.0/8, `[::1]`, `localhost`, or a name that ends with `.localhost`. A localhost name is a trust assumption: the host must resolve it to a loopback address. A URL that is not an absolute `http` or `https` URL, or that holds a username or a password, gives `INVALID_BASE_URL`. |
| `allowInsecureHttp` | `false` | Accept plain `http` on any host. Signed envelopes, MuSig2 nonces, and partial signatures then go over the network in clear. Use it only behind a trusted TLS proxy or on a closed test network. |
| `fetchImpl` | `globalThis.fetch` | Custom fetch for tests, Cloudflare Workers, React Native. The client calls it with no `this` value, so the global `fetch` of a browser works without a bind. Each request sets `redirect: 'manual'`: the client follows no redirect. A redirect response is a failed request: `sendMessage` throws `SEND_MESSAGE_HTTP`, and an SSE subscription connects again after the backoff delay. In a browser, a cross-origin redirect that fails the CORS check makes `fetch` reject. |
| `clockSkewSec` | 60 | Clock-skew tolerance in seconds for each broadcast and inbox envelope. |
| `reconnectBackoff` | `1s to 30s` expo + 20% jitter | Delay (ms) for an attempt count (0-based). The client waits this delay after each attempt of an SSE subscription. An attempt ends with a failed response, a stream end, an event above `maxSseEventBytes`, or a fetch or read error. The count goes back to 0 after an attempt that got at least one byte (an event or a heartbeat comment). An attempt that ends with an event above `maxSseEventBytes` does not set the count to 0. If the function throws, that subscription loop ends with one `logger.error` line. The subscription then stays closed until `stop()` and `start()`. |
| `maxSseEventBytes` | no limit | The maximum byte count of one SSE event, broadcast or inbox. See [SSE event size limit](#sse-event-size-limit). |
| `resolveSenderPk` | none | Gives the key of a sender DID that is not a registered peer. If the function throws, the client drops the event. With no function, the client accepts only registered peers. |
| `logger` | `CONSOLE_LOGGER` | Same as server side. |

### SSE event size limit

`maxSseEventBytes` is off by default, because some protocol messages grow with the cohort size. `RECOMMENDED_MAX_SSE_EVENT_BYTES` (1 MiB, from `@did-btcr2/aggregation/participant`) is the recommended value. For did:btcr2 KEY DIDs, 1 MiB holds these events:

- A CAS `DISTRIBUTE_AGGREGATED_DATA` of about 8,500 members (about 122 bytes for each member).
- A `COHORT_READY` of about 12,900 members (81 bytes for each cohort key).

A service with a larger cohort needs a larger value.

If an event is larger than the limit, the client writes a `logger.warn` line and closes the stream. It connects again after the backoff delay. The attempt counts as a failed attempt.

For an inbox event, the client resumes after the refused event by its id. The actor loses only that event, and the later events arrive. `HttpServerTransport` gives the event id to the `writeEvent` method of the `SseStream` adapter. `formatSseEvent` (from `@did-btcr2/aggregation/service`) writes the `id` field first. If the adapter uses it, the client gets the id when the `id` line fits in the limit. In these cases, the client cannot skip the event:

- The event has no `id` field before the byte count becomes greater than the limit.
- The id is equal to the resume id.
- The client ignores the id (see [Inbox delivery and resume](#inbox-delivery-and-resume)).
- The id is empty. The empty id clears the resume id, so the server sends each retained event again.

In each of these cases, the server sends the refused event again at each reconnect. The inbox of the actor then gets no later event while the server holds that event in its buffer.

Under Bun 1.3.11, a cancel or an abort of a streaming fetch body does not close the TCP connection. Thus each refused attempt against a hostile server leaves one connection open. `stop()` has the same limit. Node closes the connection.

## Runnable reference implementation

`packages/aggregation/lib/operations/aggregation/e2e-http-transport.ts` is a standalone demo: it boots an in-process `node:http` server hosting `HttpServerTransport`, creates two real HTTP clients, and runs a full 3-party MuSig2 aggregation round over loopback HTTP. No external dependencies: the single file is a complete server-side framework adapter plus a full end-to-end exercise.

```bash
PORT=8080 bun packages/aggregation/lib/operations/aggregation/e2e-http-transport.ts
```

Emits one 64-byte aggregated Schnorr signature per run, then exits cleanly.

## Discovery (v1.1)

For v1 a known `baseUrl` is passed directly. A future release will publish service endpoints in DID documents under a `Btcr2AggregationService` service entry so participants can resolve a service operator's DID to find the URL.

## Limitations

- **Operator-trusted authenticity.** Unlike NIP-44-encrypted Nostr messages, TLS-only HTTP leaks directed-message plaintext to the service operator. The protocol's own payload signatures (signed updates, partial sigs) preserve non-repudiation of aggregation outputs.
- **Single operator per cohort.** No built-in multi-operator redundancy. Operators who fail to broadcast can censor individual updates; participants detect by failing resolution and switching operators.
- **Rate limiter defaults are intentionally generous** (10 rps / DID) to avoid tripping normal cohort flows. Operators hosting public aggregators should tighten based on observed traffic.
- **Message handlers must be idempotent.** A client with no `Last-Event-ID` (a new process, or a new `registerActor`) gets every retained inbox event again. At delivery, the server signs each event older than `clockSkewSec / 2` again, so each event passes the client checks again.
- **Two server maps have no size bound.** The rate-limit bucket map gets one entry for each verified sender DID. The inbox map gets one entry for each recipient and each admitted inbox subscriber. A party can make new `did:btcr2:k1` DIDs at no cost, so both maps can grow without a limit. The default `InMemoryRateLimitStore` never removes a bucket, and only `stop()` clears the inbox map.
