# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@did-btcr2/bitcoin` provides Bitcoin Core RPC and Esplora REST client implementations in TypeScript. It lives at `packages/bitcoin/` in the `did-btcr2-js` pnpm monorepo and is consumed by `@did-btcr2/method` for blockchain queries during DID resolution and updates.

## Build & Test Commands

```bash
# From packages/bitcoin/ (or use `pnpm bitcoin <cmd>` from monorepo root)
pnpm build              # Clean dist/ and build ESM + CJS
pnpm build:tests        # Compile test TS to tests/compiled/
pnpm build:test         # Build everything then run tests with coverage
pnpm test               # Run tests with c8 coverage (requires build:tests first)
pnpm lint               # ESLint with zero warnings allowed
pnpm lint:fix           # ESLint with auto-fix
```

**Test workflow:** Tests run from pre-compiled JS in `tests/compiled/`. You must `pnpm build:tests` (or `pnpm build:test` for full rebuild) before `pnpm test`. Mocha runs specs matching `tests/compiled/**/*.spec.js`.

**Running a single test:** `pnpm c8 mocha tests/compiled/tests/<spec-name>.spec.js`

## Architecture

### BitcoinConnection (`src/bitcoin.ts`)

Single-network connection class. Each instance targets exactly one Bitcoin network with a REST client and an optional RPC client.

- **Static factory:** `BitcoinConnection.forNetwork(network, overrides?)` — merges overrides on top of `DEFAULT_BITCOIN_NETWORK_CONFIG`. No env vars.
- **Constructor:** `new BitcoinConnection({ network, rest, rpc })` — explicit config.
- Properties: `name`, `rest`, `rpc?`, `data` (bitcoinjs-lib network).
- Currency helpers: `BitcoinConnection.btcToSats()`, `BitcoinConnection.satsToBtc()`.

```ts
const btc = BitcoinConnection.forNetwork('regtest');
const tx = await btc.rest.transaction.get(txid);
const block = await btc.rpc?.getBlock({ height: 100 });
```

### Client Layer (`src/client/`)

**BitcoinRestClient** (`rest/index.ts`) — Esplora REST API wrapper using fetch. Sub-objects:
- `transaction` — tx fetch, broadcast, UTXO queries
- `block` — block fetch by hash/height
- `address` — address info, UTXO listing

**BitcoinCoreRpcClient** (`rpc/index.ts`) — Bitcoin Core JSON-RPC client. `JsonRpcTransport` handles Basic Auth and fetch. Errors are thrown as `BitcoinRpcError` directly from the transport layer.

### Configuration (`src/constants.ts`)

`DEFAULT_BITCOIN_NETWORK_CONFIG` defines default endpoints per network. Mainnet/testnets use mempool.space, mutinynet uses mutinynet.com, regtest defaults to localhost (polaruser/polarpass on port 18443 for RPC, port 3000 for REST).

### Types (`src/types.ts`)

`NetworkName` union type: `'bitcoin' | 'testnet3' | 'testnet4' | 'signet' | 'mutinynet' | 'regtest'`.
Config interfaces: `RestConfig`, `RpcConfig`.

### Error Types (`src/errors.ts`)

`BitcoinRpcError` (with type, code, message, data) and `BitcoinRestError`.

## Monorepo Context

```
method ─┬─ bitcoin  ← you are here
        ├─ common   (shared types, errors, utilities)
        ├─ keypair  (secp256k1 key pair management)
        └─ ...

api ────── method + all above (high-level SDK facade)
cli ────── api (CLI wrapper: `npx btcr2`)
```

`bitcoin` depends on `common` and `keypair` (workspace deps).

## Code Style

- **ESLint:** Root `eslint.config.cjs` — colon-aligned `key-spacing`, single quotes, semicolons required, 2-space indent. Unused vars error except `_`-prefixed.
- **TypeScript:** Strict mode, ES2022 target, NodeNext module resolution. Dual ESM/CJS output.
- **Node:** >=22.0.0. **Package manager:** pnpm v10.20.0 with `workspace:*` for internal deps.

## Test Environment

Tests use Mocha + Chai + chai-as-promised. Coverage via c8 (cobertura + text). A `docker-compose.polar.yml` is available for spinning up a local regtest node. Test specs: `bitcoin.spec.ts`, `json-rpc.spec.ts`, `rpc-client.spec.ts`, `rest-client.spec.ts`, `utilities.spec.ts`.
