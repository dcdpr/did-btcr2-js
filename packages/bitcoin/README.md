# @did-btcr2/bitcoin

Sans-I/O Bitcoin client for `did-btcr2-js`. Speaks Esplora REST (mempool.space, blockstream.info, or any compatible indexer) and Bitcoin Core JSON-RPC.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

The DID method needs to read transactions from beacon addresses, fetch block metadata, and broadcast signed updates. This package provides those operations as a pluggable, browser-compatible client.

- **Sans-I/O protocol layer.** `EsploraProtocol` and `JsonRpcProtocol` build HTTP request descriptors; they perform no I/O themselves. A pluggable `HttpExecutor` handles the actual `fetch()` (or whatever wire transport you want to inject for testing).
- **Per-network connection.** `new BitcoinConnection({ network, rest, rpc?, executor? })` holds the REST and optional RPC clients for one network (`'bitcoin' | 'testnet3' | 'testnet4' | 'signet' | 'mutinynet' | 'regtest'`). The REST host is supplied explicitly; there are no built-in service URLs.
- **REST + RPC.** REST is sufficient for resolution (read-only queries on public networks). RPC is only needed for regtest mining flows and operator-controlled nodes.
- **No endpoint coupling.** This transport layer holds no service URLs and consults no `process.env`. Supply the REST host yourself, or use the SDK facade ([@did-btcr2/api](https://github.com/dcdpr/did-btcr2-js/tree/main/packages/api)), which carries per-network convenience defaults.

## Install

```bash
npm install @did-btcr2/bitcoin
```

Or with pnpm:

```bash
pnpm add @did-btcr2/bitcoin
```

Requires Node >= 22. Ships both ESM and CJS; pick whichever your bundler needs.

## Key Exports

| Concern | Entry point |
|---|---|
| Per-network connection | `BitcoinConnection`, `BitcoinConnectionOptions` |
| REST client (Esplora) | `BitcoinRestClient`, sub-clients `BitcoinAddress`, `BitcoinBlock`, `BitcoinTransaction` |
| RPC client (Bitcoin Core) | `BitcoinCoreRpcClient`, `JsonRpcTransport`, `RpcMethodMap`, `TypedRpcMethod` |
| Sans-I/O protocol layer | `EsploraProtocol`, `ESPLORA_CHAIN_PAGE_SIZE`, `JsonRpcProtocol`, `HttpRequest`, `HttpExecutor`, `defaultHttpExecutor`, `createFetchExecutor`, `FetchExecutorOptions` |
| Fee estimation | `FeeEstimator`, `StaticFeeEstimator` |
| Network params | `getNetwork(name)`, `BTCNetwork`, `NetworkName` |
| Errors | `BitcoinRpcError`, `BitcoinRestError`, `RpcErrorType` |
| Bitcoin constants | `INITIAL_BLOCK_REWARD`, `HALVING_INTERVAL`, `COINBASE_MATURITY_DELAY`, `DEFAULT_BLOCK_CONFIRMATIONS`, `GENESIS_TX_ID` |

## Quick Start

```typescript
import { BitcoinConnection } from '@did-btcr2/bitcoin';

// Public network: REST only. Supply the Esplora host explicitly.
const btc = new BitcoinConnection({
  network : 'mutinynet',
  rest    : { host: 'https://mutinynet.com/api' },
});

const height = await btc.rest.block.count();
const utxos  = await btc.rest.address.getUtxos('tb1q...');
const txHex  = await btc.rest.transaction.getHex('abc123...');

// Regtest with explicit REST host and RPC credentials.
const regtest = new BitcoinConnection({
  network : 'regtest',
  rest    : { host: 'http://localhost:3000' },
  rpc     : { host: 'http://localhost:18443', username: 'polaruser', password: 'polarpass' },
});
await regtest.rpc!.generateToAddress(6, await regtest.rpc!.getNewAddress('bech32'));
```

### Fresh responses and browsers

`EsploraProtocol` sets `fresh: true` on each request whose response can change over time: the chain tip, a transaction with its `status`, a block hash by height, and the data of an address. A request for a transaction or a block by its hash has no `fresh` field, so a cache can keep the response.

The default executor gets a fresh response from the origin server. It sets the fetch option `cache: 'no-store'` and adds a random `_` query parameter, so that no browser cache and no CDN cache answers the request. It adds no request header. A GET request carries no `Content-Type`, and `POST /tx` carries `text/plain`. So a browser sends no CORS preflight, and the default config works in a web app.

### Injecting a custom executor

For a request timeout, use `createFetchExecutor`:

```typescript
import { BitcoinConnection, createFetchExecutor } from '@did-btcr2/bitcoin';

const btc = new BitcoinConnection({
  network  : 'mutinynet',
  rest     : { host: 'https://mutinynet.com/api' },
  executor : createFetchExecutor({ timeoutMs: 5_000 }),
});
```

For tests, sandboxes, or rate-limited fetchers, pass your own `HttpExecutor`. It must honor `req.fresh`. To keep the default rules, wrap an executor from `createFetchExecutor`:

```typescript
const fetchExecutor = createFetchExecutor({ timeoutMs: 5_000 });
const btc = new BitcoinConnection({
  network  : 'mutinynet',
  rest     : { host: 'https://mutinynet.com/api' },
  executor : async (req) => {
    await rateLimiter.acquire();
    return fetchExecutor(req);
  },
});
```

## Esplora server requirements

The `indexer` signal discovery of `@did-btcr2/method` reads the full confirmed history of each beacon address. It uses the Esplora listing `GET /address/:address/txs/chain[/:last_seen_txid]` (`BitcoinAddress.getConfirmedTxs`) and reads one page after the other.

> [!WARNING]
> The `indexer` signal discovery needs an Esplora server with the three properties below.
>
> 1. **The server serves the chain listing.** A mempool instance serves it only with `MEMPOOL_BACKEND=esplora`. In electrum mode, it sends HTTP 404, and each resolve fails with `INTERNAL_ERROR`.
> 2. **The server lists the history in a stable order.** The newest block comes first, and the order in each block is fixed. Blockstream electrs and mempool-electrs v3.2.0 and later use such an order. mempool-electrs v3.0.1 and v3.1.0 do not. With these versions, a resolve fails with `INTERNAL_ERROR` if a beacon address has 25 or more transactions.
> 3. **The server sends 25 transactions in each full page (`ESPLORA_CHAIN_PAGE_SIZE`).** The request sets `max_txs=25`, so a mempool-electrs server with a different default also sends 25. Discovery stops at the first page with fewer than 25 transactions. If a server sends fewer than 25 and ignores `max_txs`, discovery does not read the older signals. Then a resolve can return an old DID document with no error.
>
> The `fullnode` signal discovery reads the blocks over Bitcoin Core RPC. It does not use the Esplora listing.

A resolve also fails with `INTERNAL_ERROR` if the history of a beacon address changes during discovery. Examples are a block reorganization, or a load-balanced server with an instance that is some blocks behind. Discovery does not read the history again. Resolve again later.

## Architecture Principles

- **Sans-I/O core.** Protocol layers compute request descriptors; executors do the wire work. The same protocol code runs unchanged in Node, browsers, and test harnesses.
- **No third-party endpoint coupling.** This transport layer holds no service URLs and performs no environment-variable resolution. Callers supply the REST host per network, or use the SDK facade (`@did-btcr2/api`), which carries per-network convenience defaults.
- **Strict typing for RPC + REST.** Block versions (`BlockV0..BlockV3`) and raw transaction shapes (`RawTransactionV0..V2`) are modelled as discriminated unions; verbosity flags select the right type at the call site.

## Build & Test

```bash
# From packages/bitcoin/
pnpm build              # Compile ESM + CJS + type declarations
pnpm build:tests        # Compile tests to tests/compiled/
pnpm test               # Run the test suite with coverage
pnpm lint               # ESLint (zero warnings tolerated)
```

## Documentation

- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **[ADR-005](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/005-bitcoin-package-extraction-and-browser-decoupling.md)** Bitcoin package extraction and browser decoupling
- **[ADR-009](https://github.com/dcdpr/did-btcr2-js/blob/main/docs/adr/009-sans-io-bitcoin-transport-foundation.md)** Sans-I/O Bitcoin transport foundation
- **Esplora HTTP API reference** [github.com/Blockstream/esplora](https://github.com/Blockstream/esplora/blob/master/API.md)
- **Source reference** See JSDoc on `BitcoinConnection`, `BitcoinRestClient`, `BitcoinCoreRpcClient`, and the protocol classes.

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
