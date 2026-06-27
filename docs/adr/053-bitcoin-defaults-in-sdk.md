---
title: "ADR 053: Bitcoin Service Defaults Belong to the SDK, Not the Sans-I/O Transport"
---

# ADR 053: Bitcoin Service Defaults Belong to the SDK, Not the Sans-I/O Transport

**Status:** Accepted

**Date:** 2026-06-27

**Branch / PR:** `refactor/bitcoin-defaults-to-api`

**References:** [ADR 005](005-bitcoin-package-extraction-and-browser-decoupling.md), [ADR 009](009-sans-io-bitcoin-transport-foundation.md), [ADR 023](023-cas-read-path.md), [ADR 024](024-api-facade-lazy-and-layered-config.md)

## Context

The `@did-btcr2/bitcoin` package is a sans-I/O transport ([ADR 009](009-sans-io-bitcoin-transport-foundation.md)): it builds request descriptors and leaves HTTP execution to a pluggable executor. Yet it also shipped `DEFAULT_BITCOIN_NETWORK_CONFIG`, a map of concrete third-party service URLs (`mempool.space` for mainnet, the testnets, and signet; `mutinynet.com`) and local deployment assumptions (a `localhost:18443` Bitcoin Core RPC and a `localhost:3000` Esplora REST for a Polar regtest). `BitcoinConnection.forNetwork(network)` read that map to spin up a connection when the caller supplied no endpoints.

This conflated two concerns. One is the protocol: how to talk to an Esplora REST or Bitcoin Core RPC endpoint, which is library code. The other is deployment policy: which concrete service to talk to, which is an environment and application choice. A sans-I/O library that names `mempool.space` embeds a third-party dependency and a deployment opinion into the layer least entitled to hold one. The whole point of the sans-I/O boundary is that the library decides nothing about I/O, including where it goes.

The SDK had already established the right home for this kind of default. The CAS read path puts its default IPFS gateway in the API layer ([ADR 023](023-cas-read-path.md), [ADR 024](024-api-facade-lazy-and-layered-config.md)), with the transport requiring an explicit gateway. Bitcoin defaults were the inconsistent holdout: the same class of value, living one layer too low.

## Decision

### 1. The transport requires explicit endpoints

Remove `DEFAULT_BITCOIN_NETWORK_CONFIG` and `BitcoinConnection.forNetwork` from `@did-btcr2/bitcoin`. The `BitcoinConnection` constructor, which already takes explicit REST and optional RPC config, becomes the sole transport entry point. The transport now holds no service URLs and makes no deployment assumption: a caller wires the endpoints it chooses.

### 2. The SDK owns the convenience defaults

Move the per-network endpoint map into `@did-btcr2/api` as `DEFAULT_BITCOIN_NETWORK_CONFIG`. `BitcoinApi` resolves the per-network defaults under any caller overrides and constructs the transport with explicit endpoints, and the friendly unknown-network error lives here too. `BitcoinApi`'s public configuration is unchanged, so SDK callers see no difference: the same `new BitcoinApi({ network })` still works, now sourcing its endpoints from the SDK rather than the transport.

### 3. Mirror the CAS precedent

This makes the Bitcoin defaults consistent with the CAS default gateway: the transport requires explicit configuration, and the SDK provides convenience defaults. It is the split a typical SDK draws between a transport that demands explicit config and a façade that ships sensible defaults on top.

### 4. Dev and demo scripts name their endpoints

The `lib/` scripts that used `forNetwork` now construct connections explicitly. A script that performs real I/O is entitled to name a concrete service, so inlining an endpoint there is honest rather than a leak. A small dev-only endpoints helper in `method/lib` keeps the multi-network scripts DRY; it is never shipped, and it exists because `method` cannot import the SDK's defaults without inverting the package dependency graph.

## Consequences

- The sans-I/O boundary is clean. `@did-btcr2/bitcoin` embeds no third-party URLs and no deployment assumptions, matching what [ADR 005](005-bitcoin-package-extraction-and-browser-decoupling.md) and [ADR 009](009-sans-io-bitcoin-transport-foundation.md) set out to make it.
- Service defaults have a single shipped home: the SDK, alongside the CAS gateway default. "Where do the endpoints come from" has one answer.
- Breaking change to `@did-btcr2/bitcoin`: `forNetwork` and the exported default map are gone. Callers either pass explicit endpoints to the constructor or use the SDK. Pre-1.0, this is a minor bump.
- A breaking bump in a low-level package cascades: `method`, `api`, and `cli` take dependency-uptake bumps to accept `bitcoin`'s new range, even though only `api` changed behaviorally.
- The default map is duplicated once, in `method/lib` dev tooling, because `method` cannot import from `api`. This duplication is dev-only and never shipped; the shipped defaults remain single-sourced in `api`.

## Rejected alternatives

- **Keep `forNetwork` but strip its URLs (require an explicit REST host).** It would leave a network-aware factory in the transport that, with no defaults left to apply, merely duplicates the constructor. The constructor already is the explicit-config path, so a second one earns nothing.
- **Keep the defaults in `bitcoin` behind an opt-in flag.** Still ships third-party URLs in the sans-I/O layer; the boundary stays muddy and the inconsistency with the CAS gateway persists.
- **Move the defaults to a new shared config package.** Overkill for a single map. The SDK is the established home for service defaults, and a new package adds dependency-graph weight for no gain.
- **Have `method/lib` import the SDK defaults instead of duplicating them.** This inverts the dependency graph (`api` already depends on `method`). A dev-only, never-shipped duplication is the lesser evil.
