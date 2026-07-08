---
title: "ADR 078: Wire the Advertised-but-Dead Bitcoin RPC and Profile-Identity Config Surface"
---

# ADR 078: Wire the Advertised-but-Dead Bitcoin RPC and Profile-Identity Config Surface

**Status:** Accepted

**Date:** 2026-07-07

**Branch / PR:** `feat/cli-io-config`

**References:** [ADR 053](053-bitcoin-defaults-in-sdk.md), [ADR 072](072-cli-writable-cas-and-publish-flag.md), [ADR 076](076-cli-io-passthrough-knobs.md)

## Context

Two pieces of config surface are advertised on their types but do nothing at runtime. A field that exists on a public type is a promise: an operator who reads the type reasonably expects setting it to change behavior. These two do not, and both gaps run deeper than "the CLI never passes them through."

1. **`RpcConfig` fields are dead at the transport.** `RpcConfig` (bitcoin `types.ts`) declares `headers` (line 112), `wallet` (line 116), and `allowDefaultWallet` (line 117), but `JsonRpcProtocol` (`client/rpc/protocol.ts:44-69`) reads only `host`, `username`, and `password`. Its constructor builds the request headers from the derived `Authorization` header and a fixed `Content-Type` only, and it takes the RPC URL verbatim from `host`. So multi-wallet Bitcoin Core selection and custom or authenticated RPC headers are dead at the transport layer, not merely un-wired in the CLI: even a direct bitcoin-package caller that set `wallet` or `headers` would see them ignored.

2. **The profile `identity` block is dead in the CLI.** `ConfigFile` declares `profiles.<name>.identity.keystore` and `identity.default` (`config.ts:83-87`), but nothing reads them. `buildKeystoreKms` (`config.ts:341-346`) resolves the keystore path as `overrides?.keystore ?? defaultKeystorePath()` and never consults the active profile, and signing-key resolution never consults `identity.default`. Both keys are also undocumented, so a profile can carry an `identity` block that silently has no effect.

Bitcoin Core exposes per-wallet RPCs under a `/wallet/<name>` URL path, and RPC endpoints fronted by a reverse proxy commonly require custom or bearer headers. Both are ordinary operator needs that the declared fields already imply support for.

## Decision

1. **Wire `RpcConfig.headers` and `RpcConfig.wallet` in `JsonRpcProtocol`.** Merge configured `headers` into the request headers alongside the derived `Authorization` header, so custom or authenticated RPC endpoints work. When `wallet` is set, append `/wallet/<name>` to the RPC URL so Bitcoin Core wallet RPCs target the named wallet. This is a bitcoin-package change and ships as a bitcoin minor bump.

2. **Remove `RpcConfig.allowDefaultWallet`.** It is unused, and its intended guard semantics (refuse the node's default wallet) add surface without a caller. Drop the field rather than implement a knob nobody asked for.

3. **Wire `profiles.<name>.identity` into the CLI.** `identity.keystore` feeds `buildKeystoreKms`, so a profile can point at its own keystore file, and `identity.default` feeds signing-key resolution as the profile's default signing key. Both fall **below** the corresponding global flags (`--keystore`, `--signing-key`) in precedence, and both are documented in the README config-file section.

## Consequences

- Authenticated RPC endpoints and multi-wallet Bitcoin Core nodes become usable. The CLI flags that feed `RpcConfig.wallet` and `RpcConfig.headers` are added by the sibling passthrough ADR ([ADR 076](076-cli-io-passthrough-knobs.md)); this ADR is what makes those fields live at the transport.
- Each profile can carry its own keystore and default signing key, completing the profile model: switching profiles now switches signing identity, not just I/O endpoints.
- The dead `allowDefaultWallet` field is gone, so the type no longer advertises a guard that does not exist.
- The transport change is the only reason the bitcoin package version moves in this refactor; the rest of the sweep is CLI-only wiring.
- Add tests: an RPC request built with `wallet` set appends the `/wallet/<name>` path; configured `headers` appear on the built request alongside `Authorization`; and a profile `identity.keystore` / `identity.default` is honored, but a global `--keystore` / `--signing-key` flag still wins over it.

## Rejected alternatives

- **Remove all three `RpcConfig` fields and the `identity` block instead of wiring them.** This closes the dead-surface gap but permanently forecloses authenticated and multi-wallet RPC and per-profile identity, all of which are ordinary operator needs. Wiring is the better completion of a user-configurable I/O surface; deletion would trade a small honesty win for a real capability loss.
- **Implement `allowDefaultWallet` as a guard.** No caller needs it, and it complicates the common single-wallet path (every default-wallet call would have to route around the guard). Removing the field is simpler and loses nothing in use today.
- **Wire `identity` above the global flags.** A flag is an explicit per-invocation choice and should always win over a persisted profile default. Placing `identity` above `--keystore` / `--signing-key` would make the flags unreliable, so `identity` stays the lower-precedence layer, consistent with the flag -> env -> profile -> default ordering the CLI already uses.
