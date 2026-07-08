---
title: "ADR 076: CLI Bitcoin and CAS I/O Passthrough Knobs"
---

# ADR 076: CLI Bitcoin and CAS I/O Passthrough Knobs

**Status:** Accepted

**Date:** 2026-07-07

**Branch / PR:** `feat/cli-io-config`

**References:** [ADR 044](044-beacon-change-output-address.md), [ADR 053](053-bitcoin-defaults-in-sdk.md), [ADR 070](070-broadcast-result-and-cas-first-ordering.md), [ADR 072](072-cli-writable-cas-and-publish-flag.md), [ADR 078](078-wire-dead-config-surface.md)

## Context

Several I/O knobs are honored end-to-end by the SDK but are unreachable from the cli, so the cli can only ever exercise their defaults. The api/method passthrough for the write path already exists: `DidMethodApi.update` accepts and forwards `broadcastOptions: { feeEstimator?; changeAddress? }` (api `method.ts:259-329`, into the beacon at `beacon.ts:388` / `beacon.ts:609`), and the Bitcoin and CAS config surfaces already carry timeout and header fields. What is missing is the cli plumbing that lets a user set any of them.

Concretely, the write path is called with none of these options set:

1. **Fee rate.** `update.ts:88-96` (and the deactivate command) call `api.btcr2.update` with only `publishToCas` and no `broadcastOptions`, so every cli broadcast falls back to the 5 sat/vB `DEFAULT_FEE_ESTIMATOR` (`fee-estimator.ts:18`). On `bitcoin`, `testnet4`, or `signet` under congestion, a fixed 5 sat/vB can underpay and the beacon transaction may never confirm, with no way to raise it. This is the one gap that can make a cli on-chain update fail today.
2. **Change address.** `BroadcastOptions.changeAddress` (`beacon.ts:178-186`), the ADR 044 unlinkability opt-out, defaults to the beacon address when unset (`resolveChangeAddress`, `beacon.ts:147-149`). Since the cli never sets it, every cli update chains change back to the beacon address and links a DID's announcements together on-chain, defeating ADR 044.
3. **Bitcoin request timeout.** `BitcoinApiConfig.timeoutMs` is honored at the bitcoin layer (the fetch executor is wrapped in `AbortSignal.timeout`), but the cli exposes no way to set it, so requests wait unbounded.
4. **CAS request timeout.** `CasConfig.timeoutMs` is honored (api `cas.ts:219`; `0` disables, SDK default `30000`), but the cli cannot override it.
5. **REST headers.** `RestConfig.headers` is live and consumed at `rest/protocol.ts:38`, but the cli cannot set headers, so authenticated Esplora/mempool endpoints (API key or `Authorization`) are out of reach.
6. **RPC wallet and headers.** `RpcConfig.wallet` and `RpcConfig.headers` exist on the config type but are not yet consumed at the RPC transport; the sibling [ADR 078](078-wire-dead-config-surface.md) wires them. The cli exposes no way to set them either.

Each knob below follows the cli's existing flag -> env -> config-profile -> per-network-default precedence merge (`config.ts:271-319`) and adds a matching `BTCR2_*` env var and a `profiles.<n>.btc` or `profiles.<n>.cas` field.

## Decision

Add the following cli knobs. Unless noted, each is pure cli wiring over passthrough that already exists in api/method.

1. **`--fee-rate <satsPerVByte>`** for `update` and `deactivate` (env `BTCR2_FEE_RATE`, profile `profiles.<n>.btc.feeRate`). When set, the cli builds a `StaticFeeEstimator(rate)` and passes it as `broadcastOptions.feeEstimator` through the existing passthrough (api `method.ts:259-329`, into `beacon.ts:388` / `beacon.ts:609`). When unset, the SDK's 5 sat/vB `DEFAULT_FEE_ESTIMATOR` still applies, so behavior is unchanged for callers that do not opt in. This is the one item that can make a cli on-chain update fail today.

2. **`--change-address <addr>`** for `update` and `deactivate` (profile `profiles.<n>.btc.changeAddress`; no env var, since a change address is DID/network-specific and not a stable machine default). When set, the cli passes it as `broadcastOptions.changeAddress`. It is validated against the DID's network before broadcast (the beacon already fails fast on a mismatch at `beacon.ts:147-149`), so a fresh controller-owned address can be supplied to stop linking a DID's announcements on-chain (ADR 044).

3. **`--btc-timeout <ms>`** (env `BTCR2_BTC_TIMEOUT`, profile `profiles.<n>.btc.timeoutMs`) mapped to `BitcoinApiConfig.timeoutMs`. There is **no default**: a timeout is applied only when the user sets one, preserving today's unbounded behavior for callers that want it. Documentation (and the config-doctor in the sibling introspection ADR) should steer unattended or scripted use toward setting a timeout so requests fail fast instead of hanging.

4. **`--cas-timeout <ms>`** (env `BTCR2_CAS_TIMEOUT`, profile `profiles.<n>.cas.timeoutMs`) mapped to `CasConfig.timeoutMs` (api `cas.ts:219`, where `0` disables). This is an explicit override; when unset, the SDK's own default of `30000` ms applies.

5. **`--btc-rest-header 'Key: Value'`** (repeatable; profile `profiles.<n>.btc.headers`) mapped to `RestConfig.headers`, consumed live at `rest/protocol.ts:38`. This enables authenticated Esplora/mempool endpoints that require an API key or an `Authorization` header. No env var: an env-encoded header map is awkward and secret material in the environment is handled by the sibling secret-handling ADR, not by ad hoc encoding here.

6. **`--btc-rpc-wallet <name>`** and **`--btc-rpc-header 'Key: Value'`** (repeatable) for the Bitcoin Core RPC connection, mapped to `RpcConfig.wallet` and `RpcConfig.headers`. These two `RpcConfig` fields are only made functional at the transport by the sibling [ADR 078](078-wire-dead-config-surface.md), which wires the currently-dead RPC config surface; this ADR adds only the cli flags/profile that feed them. `--btc-rpc-wallet` selects a named wallet on a multi-wallet node; `--btc-rpc-header` reaches an authenticated or proxied Bitcoin Core endpoint.

## Consequences

- The cli can now set fees for congested networks (the one gap that can make a cli on-chain update fail today), make unlinkable updates per ADR 044, bound request time for scripted use, lengthen or shorten CAS timeouts, reach authenticated REST endpoints, and target multi-wallet or authenticated Bitcoin Core nodes.
- Almost all of this is pure cli wiring: the api/method `broadcastOptions` passthrough (ADR 070), the Bitcoin/CAS timeout fields, and `RestConfig.headers` already exist and are honored. Only the RPC wallet/header knobs depend on the sibling transport change in [ADR 078](078-wire-dead-config-surface.md).
- Each knob obeys the established flag -> env -> config-profile precedence (`config.ts:271-319`), so a value can be set once in a profile and overridden per invocation, consistent with the knobs added in [ADR 072](072-cli-writable-cas-and-publish-flag.md).
- `--btc-timeout` intentionally ships with no default, so existing scripts that rely on unbounded waits are unaffected; the burden is on the operator (guided by docs and the config-doctor) to opt into a bound.
- This ships as a cli minor. The RPC transport change that gives `--btc-rpc-wallet` / `--btc-rpc-header` their effect ships as a bitcoin minor via [ADR 078](078-wire-dead-config-surface.md); until that lands, the two RPC flags are accepted and stored but inert.

## Rejected alternatives

- **Default `--btc-timeout` to a fixed value (for example 30s).** Rejected here to avoid changing today's behavior for callers that rely on unbounded waits: a request that currently completes after a long but legitimate stall would start failing. An explicit opt-in is safer, and docs plus the config-doctor can steer scripted users toward setting one.
- **A single generic `--timeout` covering both Bitcoin and CAS.** Rejected: it conflates two independent I/O paths with different default semantics (Bitcoin has no SDK default and stays unbounded when unset; CAS defaults to `30000` ms and treats `0` as "disable"). One flag cannot express both without surprising one side.
- **Auto-deriving fee rate from a live estimator in the cli.** Useful later but out of scope. A static `--fee-rate` override is the minimal fix for the confirm-failure risk and composes cleanly with a future dynamic estimator: the estimator would populate the same `broadcastOptions.feeEstimator` slot, and an explicit `--fee-rate` would remain the manual override.
