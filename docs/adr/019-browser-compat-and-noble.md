---
title: "ADR 019: Browser Compatibility Constraint and @noble / @scure Dependency Policy"
---

# ADR 019: Browser Compatibility Constraint; @noble/* and @scure/* for Crypto

**Status:** Accepted

**Date:** 2026-03-30

**Commits:** [`77a551b`](https://github.com/dcdpr/did-btcr2-js/commit/77a551b), [`19818d0`](https://github.com/dcdpr/did-btcr2-js/commit/19818d0)

## Context

did:btcr2 targets two distinct runtimes:

- **Node.js**: CLI tooling, test-vector generation, headless wallet daemons, service-operator infrastructure.
- **Browsers**: wallet webapps, interactive DID resolvers, participant UIs in aggregate-beacon flows.

An early implementation used `node:crypto` directly (HMAC, digests), along with `node:buffer` and `node:fs` touches scattered through the code. Every such dependency produced a broken browser build: either silent failures when APIs were missing, or bundler explosions from Node-only `require` calls.

Rather than continue playing whack-a-mole, the project adopted a hard constraint: **no Node.js-only APIs anywhere in library source code**. `lib/` scripts (test-vector generators, interactive examples) are allowed Node-only APIs because they're never meant to run in a browser; everything under `packages/*/src/` must work in both runtimes.

## Options considered

1. **Keep `node:crypto` + ship a separate browser polyfill.** Two codebases in effect, divergence risk.
2. **Use Web Crypto (`globalThis.crypto.subtle`) directly.** Async-only API, limited primitives, clumsy for the didcore hashing patterns we rely on.
3. **Adopt the `@noble/*` + `@scure/*` stack**: `@noble/hashes`, `@noble/curves`, `@noble/secp256k1`, `@scure/base`, `@scure/btc-signer`, `@scure/bip32`, `@scure/bip39`.

## Decision

**Option 3.** Library code depends only on cross-runtime packages. Specifically:

- `@noble/hashes` for SHA-256, HMAC, and associated digests.
- `@noble/curves` / `@noble/secp256k1` for curve operations and Schnorr signatures.
- `@scure/base` for base58 / base64url / hex encoding.
- `@scure/btc-signer`, `@scure/bip32`, `@scure/bip39` for Bitcoin primitives (see [ADR 026](026-drop-bitcoinjs-lib.md)).
- Platform globals (`globalThis.fetch`, `globalThis.crypto.getRandomValues`, `ReadableStream`, `TextEncoder`) where needed: all present in Node ≥ 22 and modern browsers.

Node-only modules (`node:http`, `node:fs`, `node:crypto`, `node:path`) are disallowed in `src/`. They are allowed in `lib/` scripts and test helpers under `tests/helpers/` with clear intent.

Enforcement: code review. CI could add a grep-based check; not currently wired.

## Consequences

**Positive**
- One codebase, two runtimes. No polyfill layer, no conditional imports, no browser-specific build step for crypto.
- The `@noble/*` and `@scure/*` projects are actively maintained, audited, and explicitly browser-first. Supply-chain risk is concentrated on a small set of well-known maintainers.
- Aligns with the "own our primitives through small, auditable deps" stance (see also [ADR 017](017-optimized-smt-core-primitive.md)).

**Negative**
- Minor CPU overhead vs. `node:crypto` for some primitives (negligible at protocol rates; we care about correctness and portability more than microseconds).
- New contributors unfamiliar with `@noble/*` need to learn its API, which differs subtly from `node:crypto` (e.g., sync vs. async signatures).
- The `@noble/hashes` version is currently pinned per-package; accidental drift across packages is possible. Monorepo-wide version policy would help; not yet enforced mechanically.

**Explicitly accepted trade-offs**
- `lib/` scripts can use Node-only APIs freely. This is deliberate: the e2e demo scripts (`lib/operations/aggregation/e2e-http-transport.ts` uses `node:http`) are not library code and run only in Node.

## References

- `packages/keypair/src/`: built entirely on `@noble/secp256k1` + `@noble/hashes`.
- [`packages/common/src/canonicalization.ts`](../../packages/common/src/canonicalization.ts): SHA-256 via `@noble/hashes`.
- `packages/bitcoin/src/`: Bitcoin primitives via `@scure/btc-signer`.
- [ADR 026](026-drop-bitcoinjs-lib.md): related dependency swap that follows this policy.
