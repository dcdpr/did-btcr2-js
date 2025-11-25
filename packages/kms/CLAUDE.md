# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Package Overview

`@did-btcr2/kms` is the Key Management System package for the did:btcr2 DID method. Part of the `did-btcr2-js` pnpm monorepo.

## Commands

```bash
# Build (ESM + CJS dual output)
pnpm build

# Build tests (compiles TS specs to tests/compiled/)
pnpm build:tests

# Build everything and run tests
pnpm build:test

# Run tests only (requires prior build:tests)
pnpm test

# Lint
pnpm lint
pnpm lint:fix
```

Tests use Mocha + Chai + c8 (coverage). Mocha runs compiled JS from `tests/compiled/**/*.spec.js`, so you must `pnpm build:tests` before `pnpm test`. The `pnpm build:test` shortcut does both.

## Architecture

- **`interface.ts`** — `KeyManager` interface and `KeyIdentifier` type defining the KMS contract: key import/export/generate, sign/verify, digest, active key management
- **`kms.ts`** — `Kms` class implementing `KeyManager`. Uses a singleton pattern via `Kms.initialize()` / `Kms.getKey()` for global access. Stores raw secret key bytes in a `KeyValueStore`, reconstructing `SchnorrKeyPair` on demand
- **`store.ts`** — `KeyValueStore<K,V>` interface and `MemoryStore` implementation (in-memory Map). `Kms` constructor accepts a custom store, defaulting to `MemoryStore`
- **`signer.ts`** — `Signer` class, a legacy convenience wrapper (plans to migrate to `Kms`). Bundles a `SchnorrKeyPair` with a network and exposes ECDSA and Schnorr signing

## Key Dependencies (workspace)

- `@did-btcr2/keypair` — `SchnorrKeyPair`, `Secp256k1SecretKey`, public key types
- `@did-btcr2/common` — Shared byte types (`Bytes`, `KeyBytes`, `SignatureBytes`, `HashBytes`), error classes (`KeyManagerError`)
- `@did-btcr2/bitcoin` — `AvailableNetworks` (used by `Signer`)
- `@noble/hashes` — SHA-256 for `digest()`

## Conventions

- All cryptographic keys are Schnorr/secp256k1 (Bitcoin Taproot)
- `Kms` stores raw secret key bytes, not full key pair objects
- Public keys are returned as compressed format (`publicKey.compressed`)
- Key identifiers default to the hex-encoded public key when no custom ID is provided
- Synchronous API throughout (no async/promises)
- TypeScript strict mode; dual ESM/CJS build output
