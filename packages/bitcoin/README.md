# @did-btcr2/bitcoin

Sans-I/O Bitcoin client for `did-btcr2-js`. Speaks Esplora REST (mempool.space, blockstream.info, or any compatible indexer) and Bitcoin Core JSON-RPC.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

The DID method needs to read transactions from beacon addresses, fetch block metadata, and broadcast signed updates. This package provides those operations as a pluggable, browser-compatible client.

- **Sans-I/O protocol layer.** `EsploraProtocol` and `JsonRpcProtocol` build HTTP request descriptors; they perform no I/O themselves. A pluggable `HttpExecutor` handles the actual `fetch()` (or whatever wire transport you want to inject for testing).
- **Per-network connection.** `BitcoinConnection.forNetwork('regtest' | 'testnet3' | 'testnet4' | 'signet' | 'mutinynet' | 'bitcoin')` returns a connection wired with default endpoints; override REST or RPC via the second argument.
- **REST + RPC.** REST is sufficient for resolution (read-only queries on public networks). RPC is only needed for regtest mining flows and operator-controlled nodes.
- **No env-var magic.** Endpoint defaults come from `DEFAULT_BITCOIN_NETWORK_CONFIG`; the factory does not consult `process.env`.

## Install

```bash
npm install @did-btcr2/bitcoin
```

Or with pnpm:

```bash
pnpm add @did-btcr2/bitcoin
```

## Key Exports

| Concern | Entry point |
|---|---|
| Per-network connection | `BitcoinConnection`, `BitcoinConnection.forNetwork(name, overrides?)` |
| REST client (Esplora) | `BitcoinRestClient`, sub-clients `BitcoinAddress`, `BitcoinBlock`, `BitcoinTransaction` |
| RPC client (Bitcoin Core) | `BitcoinCoreRpcClient`, `JsonRpcTransport`, `RpcMethodMap`, `TypedRpcMethod` |
| Sans-I/O protocol layer | `EsploraProtocol`, `JsonRpcProtocol`, `HttpRequest`, `HttpExecutor`, `defaultHttpExecutor` |
| Network params | `getNetwork(name)`, `BTCNetwork`, `NetworkName` |
| Errors | `BitcoinRpcError`, `BitcoinRestError`, `RpcErrorType` |
| Defaults | `DEFAULT_BITCOIN_NETWORK_CONFIG` |
| Bitcoin constants | `INITIAL_BLOCK_REWARD`, `HALVING_INTERVAL`, `COINBASE_MATURITY_DELAY`, `DEFAULT_BLOCK_CONFIRMATIONS`, `GENESIS_TX_ID` |

## Quick Start

```typescript
import { BitcoinConnection } from '@did-btcr2/bitcoin';

// Public network: REST only, defaults to mempool.space.
const btc = BitcoinConnection.forNetwork('mutinynet');

const height = await btc.rest.block.count();
const utxos  = await btc.rest.address.getUtxos('tb1q...');
const txHex  = await btc.rest.transaction.getHex('abc123...');

// Regtest with explicit RPC credentials (no defaults; never hardcoded).
const regtest = BitcoinConnection.forNetwork('regtest', {
  rpc: { username: 'polaruser', password: 'polarpass' },
});
await regtest.rpc!.generateToAddress(6, await regtest.rpc!.getNewAddress('bech32'));
```

### Injecting a custom executor

For tests, sandboxes, or rate-limited fetchers, pass your own `HttpExecutor`:

```typescript
const btc = BitcoinConnection.forNetwork('mutinynet', {
  executor: (req) => fetch(req.url, {
    method  : req.method,
    headers : req.headers,
    body    : req.body,
    signal  : AbortSignal.timeout(5_000),
  }),
});
```

## Architecture Principles

- **Sans-I/O core.** Protocol layers compute request descriptors; executors do the wire work. The same protocol code runs unchanged in Node, browsers, and test harnesses.
- **No third-party endpoint coupling.** Defaults live in one constant (`DEFAULT_BITCOIN_NETWORK_CONFIG`) and are explicit per network. There is no environment-variable resolution and no implicit fallback chain.
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
- **ADR-005** Bitcoin package extraction and browser decoupling
- **ADR-009** Sans-I/O Bitcoin transport foundation
- **Esplora HTTP API reference** [github.com/Blockstream/esplora](https://github.com/Blockstream/esplora/blob/master/API.md)
- **Source reference** See JSDoc on `BitcoinConnection`, `BitcoinRestClient`, `BitcoinCoreRpcClient`, and the protocol classes.
