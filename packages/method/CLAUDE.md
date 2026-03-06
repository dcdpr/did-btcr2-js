# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the `@did-btcr2/method` package — the core TypeScript implementation of the did:btcr2 DID Method specification. It lives within the `did-btcr2-js` pnpm monorepo at `packages/method/`.

did:btcr2 is a censorship-resistant DID Method using Bitcoin as a Verifiable Data Registry. It supports zero-cost off-chain DID creation, aggregated updates, long-term identifiers, private DID resolution, and non-repudiation.

## Build & Test Commands

```bash
# From packages/method/ (or use `pnpm method <cmd>` from monorepo root)
pnpm build              # Clean dist/ and build ESM + CJS + browser bundles
pnpm build:tests        # Compile test TS to tests/compiled/
pnpm build:test         # Build everything then run tests with coverage
pnpm test               # Run tests with c8 coverage (requires build:tests first)
pnpm lint               # ESLint with zero warnings allowed
pnpm lint:fix           # ESLint with auto-fix

# From monorepo root — run across all packages
pnpm build              # Build all packages
pnpm test               # Test all packages
pnpm lint               # Lint all packages
```

**Test workflow:** Tests run from pre-compiled JS in `tests/compiled/`. You must `pnpm build:tests` (or `pnpm build:test` for full rebuild) before `pnpm test`. Mocha runs specs matching `tests/compiled/**/*.spec.js`.

**Running a single test:** There's no built-in single-spec script. Use: `pnpm c8 mocha tests/compiled/tests/<spec-name>.spec.js`

**Ad-hoc TypeScript execution:** `pnpm do <file.ts>` runs a file via tsx. `pnpm do:lib` runs scripts from `lib/`.

## Architecture

### Four Core Operations (all static methods on `DidBtcr2`)

- **Create** (`src/did-btcr2.ts`) — Encodes genesis key/document bytes into a did:btcr2 identifier using Bech32m. Supports deterministic (k1) and external (x1) DID types.
- **Resolve** (`src/core/resolve.ts`) — Fetches beacon signals from Bitcoin, applies updates, and builds the final DID Document. Accepts optional sidecar data for privacy-preserving off-chain resolution.
- **Update** (`src/core/update.ts`) — Applies JSON patches to a DID Document, signs with a verification method key, and announces via a beacon service to Bitcoin.
- **getSigningMethod** — Returns the verification method for signing.

### Beacon System (`src/core/beacon/`)

Beacons are the mechanism for announcing DID updates on Bitcoin. Three types via factory pattern:
- **SingletonBeacon** — Direct Bitcoin UTXOs
- **CASBeacon** — Content-addressed storage announcements
- **SMTBeacon** — Sparse Merkle Tree proofs for compact aggregated updates

`aggregation/` contains multi-party computation for aggregated Schnorr signatures (cohort management, coordinator/participant roles, DIDComm and Nostr communication adapters).

### DID Document Construction (`src/utils/`)

- `did-document-builder.ts` — Builder pattern for constructing DID Documents
- `did-document.ts` — `Btcr2DidDocument` and `DidVerificationMethod` classes
- `appendix.ts` — Document helper utilities

### Identifier Encoding (`src/core/identifier.ts`)

Encodes/decodes did:btcr2 identifiers using Bech32m with human-readable prefixes distinguishing key types (k1 for deterministic, x1 for external).

## Monorepo Package Dependency Graph

```
method ─┬─ bitcoin    (RPC + REST clients for blockchain queries)
        ├─ common     (shared types, errors, canonicalization, JSON patch, logger)
        ├─ cryptosuite (BIP340 Schnorr Data Integrity proofs)
        ├─ keypair    (secp256k1 key pair management)
        ├─ kms        (key management / signing abstraction)
        └─ smt        (Sparse Merkle Tree implementation)

api ────── method + all above (high-level SDK facade)
cli ────── api (CLI wrapper: `npx btcr2`)
```

Leaf packages with no internal deps: `common`, `keypair`, `kms`, `smt`.

## Code Style

- **ESLint config:** Root `eslint.config.cjs` — strict rules including colon-aligned `key-spacing`, single quotes, semicolons required, 2-space indent. Unused vars error except `_`-prefixed.
- **TypeScript:** Strict mode, ES2022 target, NodeNext module resolution. Dual ESM/CJS output plus browser bundles via esbuild.
- **Node version:** >=22.0.0 required.
- **Package manager:** pnpm (v10.20.0) with workspace protocol (`workspace:*`) for internal deps.

## Test Environment

Tests use a `.env` file with `ACTIVE_NETWORK=regtest` and `BITCOIN_NETWORK_CONFIG` JSON pointing to local Bitcoin RPC/REST endpoints. Test data lives in `tests/data/`.

Test framework: Mocha + Chai + chai-as-promised. Coverage via c8 (reports: cobertura + text).
