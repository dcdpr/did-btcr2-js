# ADR 124: The Default Config Works in a Browser: No Preflight, Fresh Chain Data, and a CORS Gateway

- **Status:** Accepted
- **Date:** 2026-09-25
- **Packages:** `@did-btcr2/bitcoin` (PATCH); `@did-btcr2/api` (PATCH); `@did-btcr2/cli` (PATCH, docs); `@did-btcr2/method`, `@did-btcr2/aggregation` (PATCH, dependency uptake)

## Context

A web app calls `createApi({ btc: { network } })` with no `executor`. On 2026-09-25, a Chromium test from `http://localhost` showed three failures:

1. **CORS preflight.** `EsploraProtocol` put `Content-Type: application/json` on each GET. A GET has no body, so the header had no function. `application/json` is not a CORS-safelisted content type, so the browser sent an `OPTIONS` preflight first. mempool.space answers the preflight with 404, and the browser then blocked the GET. Resolution failed on `bitcoin`, `testnet4`, and `signet`. The `testnet3` preflight also gets 404 (checked with curl). mutinynet.com answers the preflight with 204, so mutinynet worked, with one extra request for each GET.
2. **Old chain data.** mutinynet.com sends `Cache-Control: public, max-age=14400` on `/blocks/tip/height`. Its Cloudflare edge serves cached copies (`cf-cache-status: HIT`). In the test, the second and third tip reads came from the browser disk cache. Signal discovery computes `confirmations = currentBlockCount - block_height + 1`. With an old tip, a new signal gets 0 confirmations or fewer, and the resolver ignores it (ADR 105). mutinynet.com also sends a `max-age` of 5 years on `/block-height/:height`.
3. **CAS gateway.** `DEFAULT_CAS_GATEWAY` was `https://ipfs.io`. For the raw-block request of `HttpGatewayCasExecutor`, ipfs.io answers `301` to `https://trustless-gateway.link/...`, with no `Access-Control-Allow-Origin` header. A browser blocks that redirect. A plain request to ipfs.io gets 429, and a request with browser headers gets 403. Node follows the redirect, so Node did not show the problem.

A fourth defect was in the same code. `post()` used `headers ?? defaultHeaders`, and `postTx()` gave only `Content-Type: text/plain`. So the `RestConfig.headers` (for example an API key) did not reach `POST /tx`.

The btcr2.dev website worked around the three failures with a custom executor. A web app must not need that executor.

## Decision

**The body sets `Content-Type`.** A GET descriptor carries no `Content-Type`. `POST /tx` carries `text/plain`, which is CORS-safelisted. Each request carries the `RestConfig.headers`. The protocol ignores a `Content-Type` entry in `RestConfig.headers`, in any letter case.

**The descriptor states the freshness, and the executor applies it.** `HttpRequest` gets the optional field `fresh`. `EsploraProtocol` sets `fresh: true` on each request for a response that can change over time. For a fixed response, the field is absent. So the descriptor stays deterministic, and the tests can compare it.

| Request | `fresh` | Reason |
|---|---|---|
| `getTx` | yes | The `status` changes when the transaction confirms. |
| `getBlockTipHeight` | yes | The tip moves with each block. |
| `getBlockHeight` | yes | A future height has no hash. A reorg changes the hash. |
| `getAddressTxs`, `getAddressTxsMempool`, `getAddressTxsChain`, `getAddressInfo`, `getAddressUtxos` | yes | A new transaction or a reorg changes the response. This includes a `getAddressTxsChain` page after a last-seen txid. |
| `getTxHex`, `getTxRaw`, `getBlock` | no | The txid or the block hash fixes the response. |
| `postTx` | no | A cache does not keep the response to a POST. |

**One fetch executor applies the rules.** `@did-btcr2/bitcoin` exports `createFetchExecutor({ timeoutMs? })`. `defaultHttpExecutor` is `createFetchExecutor()`. For a fresh request, the executor does two steps:

1. It sets the fetch option `cache: 'no-store'`. The browser then does not read or write its HTTP cache.
2. It adds the query parameter `_` with 16 random hex characters (64 bits from `crypto.getRandomValues`). A CDN cache key contains the query string, so no CDN has a response for the URL.

Neither step adds a request header. For `no-store`, the user agent adds `Cache-Control: no-cache` and `Pragma: no-cache` itself (Node 22 also does this). The Fetch standard adds them after the CORS decision, so they cause no preflight. The btcr2.dev executor used `cache: 'no-store'` on mempool.space with no preflight.

The api had a second fetch call for `timeoutMs`. It now calls `createFetchExecutor({ timeoutMs })`, so one function holds the rules. A custom executor gets `fresh` in the descriptor and must honor it. To keep the default rules, a custom executor can wrap an executor from `createFetchExecutor`.

**The default CAS gateway is `https://trustless-gateway.link`.** ipfs.io redirects our raw-block request to it. It serves raw blocks with `Access-Control-Allow-Origin: *`. It needs `?format=raw` or `Accept: application/vnd.ipld.raw`, and it answers 406 with neither. `HttpGatewayCasExecutor` sends both. `CasApi.retrieve` verifies the hash of each block, so the gateway cannot change the content. This ADR replaces the default gateway URL of ADR 023. The rest of ADR 023 stays.

## Alternatives

- **The protocol adds the unique query parameter.** The descriptor then changes on each call, and the protocol needs a random source. Rejected: the protocol stays sans-I/O and deterministic.
- **The request headers `Cache-Control: no-cache` or `Pragma: no-cache`.** These headers are not CORS-safelisted, so the preflight comes back.
- **`cache: 'no-store'` only.** It bypasses the browser cache, but not a CDN cache. The btcr2.dev website got a tip one block old from the mutinynet CDN until it added a unique query string.
- **`Date.now()` as the unique value.** Two clients in the same millisecond, or a client with a slow clock, can get an old CDN entry. A random value has no such case.
- **`new URL()` to add the parameter.** It throws on a relative URL, for example a same-origin proxy path `/esplora`. A string join keeps that URL valid.
- **A descriptor field `cache: 'no-store'` in the fetch vocabulary.** It names only the browser half of the rule. `fresh` names the requirement, and the executor selects the mechanism.
- **`https://dweb.link` or a private node as the CAS default.** The IPFS documentation names dweb.link for websites, and trustless-gateway.link for clients that verify the bytes. The CAS client verifies the bytes. A private node is not a library default.

## Consequences

**Positive.** `createApi({ btc: { network } })` works in a browser with no executor and no proxy. The Chromium test resolved a new `k1` DID on `testnet4`, `signet`, `bitcoin`, and `mutinynet`, with no `OPTIONS` request, no cache hit on a fresh request, and no error. The default CAS read in the same test returned the block. Node also gets fresh chain data past a CDN. `POST /tx` carries the configured headers.

**Negative.** A fresh request misses each cache, so the Esplora origin gets each such request. The resolution of a new `k1` DID sends four fresh requests: the tip and the three beacon address lists. The unique query parameter needs a server that ignores an unknown parameter. mempool.space and mutinynet.com accept it on each fresh endpoint (tested on 2026-09-25). A server that refuses it needs a custom executor. A custom executor that ignores `fresh` can still get old data from a cache.

trustless-gateway.link, ipfs.io, and dweb.link share one pool of servers and one rate limit (IPFS documentation, "Public utilities"). A high-volume app must configure its own gateway.

**Unchanged.** The RPC requests: each is a POST with a JSON body. The CAS gateway chain of the vector pipeline (`PUBLIC_CAS_GATEWAYS` in `packages/api/lib/_e2e-helpers.ts`), which runs in Node. The CAS publication policy (ADR 073).
