---
title: "ADR 026: Drop bitcoinjs-lib; @scure/btc-signer for Bitcoin Primitives"
---

# ADR 026: Drop bitcoinjs-lib; @scure/btc-signer for Bitcoin Primitives

**Status:** Accepted

**Date:** 2026-04-14

**Commit:** [`86e2f2b`](https://github.com/dcdpr/did-btcr2-js/commit/86e2f2b)

## Context

`@did-btcr2/bitcoin` initially used `bitcoinjs-lib` for PSBT construction, address derivation, transaction signing, and Taproot output construction. As the aggregation work matured and the HTTP transport planning exposed the browser-compat constraint ([ADR 019](019-browser-compat-and-noble.md)), two issues with `bitcoinjs-lib` became hard to ignore:

1. **Browser compatibility is inconsistent.** `bitcoinjs-lib` nominally supports browsers but relies on `Buffer` shims and `create-hash` / `randombytes` compatibility packages that produce brittle bundles depending on the bundler and target. The project has a strict "no Node-only APIs in library source" rule; `bitcoinjs-lib` is closer to "can be made to work" than "works by construction."
2. **Dependency stack divergence.** The rest of the codebase standardized on the `@noble/*` and `@scure/*` stack ([ADR 019](019-browser-compat-and-noble.md)). `bitcoinjs-lib` brings `tiny-secp256k1`, its own hash helpers, and transitive deps that overlap with what's already present. Two parallel crypto stacks mean two audit scopes and two possible points of supply-chain failure.

A drop-in replacement existed: `@scure/btc-signer`, from the same maintainers as `@scure/base` / `@scure/bip32` / `@scure/bip39` that the project already trusts for Bitcoin-adjacent primitives.

## Options considered

1. **Keep `bitcoinjs-lib`.** Works today; incurs ongoing bundler pain for browser builds.
2. **Replace with `@scure/btc-signer`.** Unified dependency stack; known to be browser-first; audited and actively maintained.
3. **Roll our own PSBT + Taproot construction.** Full control, but unjustified effort for primitives that have well-maintained libraries.

## Decision

**Option 2.** Remove `bitcoinjs-lib` from `@did-btcr2/bitcoin` and `@did-btcr2/method` dependencies. Rewrite PSBT construction, Taproot address derivation, and transaction signing against `@scure/btc-signer`.

Affected surfaces:
- **`@did-btcr2/bitcoin`**: spend/send helpers, connection wrappers.
- **`@did-btcr2/method`**: beacon `broadcastSignal()` for Singleton, CAS, and SMT beacons; two-pass fee estimation (sign with zero fee to measure vsize to rebuild with real fee). MuSig2 key aggregation and signing uses `@scure/btc-signer/musig2`.
- **`lib/` scripts**: test-vector generation updated to the new API.

## Consequences

**Positive**
- One Bitcoin-primitives stack across the whole monorepo. Smaller bundles, no duplicated transitive deps.
- Browser builds work by construction: `@scure/btc-signer` is explicitly browser-compatible, no shims needed.
- Supply-chain surface narrows: the `@noble` / `@scure` maintainers are a single group we audit once.
- MuSig2 support is first-class in `@scure/btc-signer/musig2`, which directly simplifies the aggregation subsystem.

**Negative**
- `@scure/btc-signer` is less feature-complete than `bitcoinjs-lib` for some esoteric Bitcoin cases (legacy scripts, uncommon SIGHASH flags). None of our current use cases hit those gaps; future features must check before assuming parity.
- Code that grew up around `bitcoinjs-lib` idioms had to be rewritten: hundreds of lines across `packages/bitcoin/` and `packages/method/src/core/beacon/`. Increased the surface of this commit but the result is simpler.

**Explicitly accepted trade-offs**
- If `@scure/btc-signer` ever became unmaintained, the remediation path is a rewrite to whatever replacement emerges. That replacement would likely itself be `@noble`-stack-aligned given project trends.
- We do not ship our own PSBT code. The one primitive we did hand-write (MuSig2 beacon signing session) sits on top of `@scure/btc-signer/musig2`, not parallel to it.

## References

- [`packages/bitcoin/lib/spend.ts`](../../packages/bitcoin/lib/spend.ts): rewritten spend path.
- [`packages/method/src/core/beacon/beacon.ts`](../../packages/method/src/core/beacon/beacon.ts): base `broadcastSignal` + two-pass fee pattern.
- [`packages/method/src/core/aggregation/signing-session.ts`](../../packages/method/src/core/aggregation/signing-session.ts): MuSig2 via `@scure/btc-signer/musig2`.
- [ADR 019](019-browser-compat-and-noble.md): the browser-compat policy that motivated this drop.
