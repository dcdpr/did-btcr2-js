# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@did-btcr2/api` is the high-level SDK facade for the did:btcr2 ecosystem. It aggregates all lower-level packages into a unified API surface. It lives at `packages/api/` in the `did-btcr2-js` pnpm monorepo.

## Build & Test Commands

```bash
# From packages/api/ (or use `pnpm api <cmd>` from monorepo root)
pnpm build              # Clean dist/ and build ESM + CJS + browser bundles
pnpm build:tests        # Compile test TS to tests/compiled/
pnpm build:test         # Build everything then run tests with coverage
pnpm test               # Run tests with c8 coverage (requires build:tests first)
pnpm lint               # ESLint with zero warnings allowed
pnpm lint:fix           # ESLint with auto-fix
```

**Test workflow:** Tests run from pre-compiled JS in `tests/compiled/`. You must `pnpm build:tests` (or `pnpm build:test` for full rebuild) before `pnpm test`. Mocha runs specs matching `tests/compiled/**/*.spec.js`.

**Running a single test:** `pnpm c8 mocha tests/compiled/tests/<spec-name>.spec.js`

## Architecture

The package has a minimal source tree — `src/api.ts` and `src/index.ts` — implementing a **nested facade pattern**. The main entry point is `DidBtcr2Api`, which composes sub-facades:

### Sub-facade Hierarchy

- **`DidBtcr2Api`** — Main stateful facade, created via `createApi(config?)`
  - **`crypto: CryptoApi`** — All cryptographic operations
    - `keypair: KeyPairApi` — Keypair generate/fromSecret/fromJSON/toJSON/equals, plus `secretKeyFrom()` and `publicKeyFrom()`
    - `multikey: MultikeyApi` — create/fromSecretKey/fromPublicKey/fromVerificationMethod/sign/verify
    - `cryptosuite: CryptosuiteApi` — BIP340 cryptosuite, proof creation/verification
    - `proof: DataIntegrityProofApi` — Data Integrity Proof add/verify
  - **`btc: BitcoinApi`** — Bitcoin blockchain interaction (REST + RPC clients, lazily initialized)
  - **`kms: KeyManagerApi`** — Key management (generateKey/import/export/listKeys/removeKey/sign/verify/digest)
  - **`did: DidApi`** — DID identifier encode/decode/generate/parse
  - **`btcr2: DidMethodApi`** — DID method operations (createDeterministic/createExternal/resolve/update), wired to BitcoinApi
  - **Top-level convenience:** `generateDid()`, `resolveDid()`, `updateDid()` — orchestrate sub-facades together

### Bitcoin Configuration

`BitcoinApiConfig` requires a `network` name and optionally overrides REST/RPC endpoints on top of network defaults. Uses `BitcoinNetworkConnection.forNetwork()` — no environment variables consulted.

```ts
createApi({ btc: { network: 'regtest' } })
createApi({ btc: { network: 'testnet4', rest: { host: 'https://my-mempool/api' } } })
createApi({ btc: { network: 'regtest', rpc: { host: 'http://mynode:18443', username: 'u', password: 'p' } } })
```

If `btc` config is omitted from `createApi()`, Bitcoin features remain uninitialized — accessing `api.btc` throws a clear error. The method layer (`DidBtcr2.resolve/update`) requires an explicit Bitcoin connection and will not silently create one from env vars.

### Key Design Decisions

- **Lazy initialization:** `BitcoinApi` and `DidMethodApi` are lazily created on first access to avoid connection overhead when not needed.
- **Sub-facade wiring:** `DidMethodApi` receives `BitcoinApi` and auto-injects the `BitcoinNetworkConnection` into resolve/update calls. `generateDid()` on the main facade wires keypair generation with KMS import.
- **Single config path:** `BitcoinApi` always holds a `BitcoinNetworkConnection`, so `rest` and `rpc` are aliases into the connection's active network — no dual-path constructor.
- **Contract enforcement:** `createDeterministic()` and `createExternal()` set `idType` internally via `Omit<DidCreateOptions, 'idType'>` so callers cannot mis-specify the identifier type.
- The package re-exports key types and classes from downstream packages (e.g., `DidDocument`, `Identifier`, `IdentifierTypes`) so consumers only need `@did-btcr2/api`.

## Monorepo Context

```
api ──┬── method      (core DID method: create, resolve, update)
      ├── bitcoin     (RPC + REST clients)
      ├── common      (shared types, errors, utilities)
      ├── cryptosuite (BIP340 Schnorr Data Integrity proofs)
      ├── keypair     (secp256k1 key pair management)
      └── kms         (key management abstraction)
```

The `cli` package depends on `api`, making this the primary consumer-facing SDK layer.

## Code Style

- **ESLint:** Root `eslint.config.cjs` — strict rules including colon-aligned `key-spacing`, single quotes, semicolons required, 2-space indent. Unused vars error except `_`-prefixed.
- **TypeScript:** Strict mode, ES2022 target, NodeNext module resolution. Dual ESM/CJS output plus browser bundles via esbuild.
- **Node:** >=22.0.0. **Package manager:** pnpm v10.20.0 with `workspace:*` for internal deps.

## Browser Bundles

esbuild produces `dist/browser.mjs` (ESM) and `dist/browser.js` (IIFE, global `BTCR2`). Config in `build/esbuild-browser-config.cjs` polyfills Node builtins (crypto, stream, buffer) and aliases `tiny-secp256k1` to `@bitcoinerlab/secp256k1` for browser compatibility.
