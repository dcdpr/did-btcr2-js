---
title: "ADR 075: CLI Configuration Validation and Introspection"
---

# ADR 075: CLI Configuration Validation and Introspection

**Status:** Accepted

**Date:** 2026-07-07

**Branch / PR:** `feat/cli-io-config`

**References:** [ADR 074](074-cli-config-resolution-correctness.md), [ADR 072](072-cli-writable-cas-and-publish-flag.md)

## Context

The cli grew a real configuration surface: a flag -> env -> config-file-profile -> per-network-default precedence merge (`resolveConnectionConfig`, `config.ts:271-319`), a `config` command group (`init`/`get`/`set`/`unset`/`list`), and a `profile` command group. That surface has no validation and no introspection, and both gaps produce the same failure mode: a user changes configuration, the tool silently ignores or overrides the change, and nothing tells them why.

Two concrete footguns:

1. **`config set` accepts anything.** `setConfigPath` (`config.ts:116-126`) splits a dotted path, creates intermediate objects, and writes the leaf with zero schema awareness; the `config set` action (`commands/config.ts:52-58`) parses the value as JSON-or-string and persists it. So `config set profiles.regtest.btc.rset http://x` (a typo for `rest`) and `config set defaults.network mainnett` (not a supported network) both write successfully and are then silently ignored at read time, because `profileToOverrides` (`config.ts:221-235`) only reads the known keys and `resolveDefaultNetwork` (`config.ts:245-258`) only accepts values in `SUPPORTED_NETWORKS`. This is the classic "my config isn't taking effect and I can't tell why."

2. **The effective config is never surfaced.** `config get` and `config list` (`commands/config.ts:44-50,68-74`) print only the raw file. The config that actually reaches the api, the merged `BitcoinApiConfig`/`CasConfig`, is computed inside the non-exported `resolveConnectionConfig` and never shown. A user cannot answer "which btc-rest will actually be used, and did it come from my flag, my env, my profile, or the network default?" without reading the source.

The merge already models exactly four provenance layers (`config.ts:286-294`): CLI flag, environment variable, config-file profile, and the per-network default supplied by `BitcoinConnection`. That layering is the natural basis for both a provenance display and an "is this value even valid" check, and it is currently locked inside a private function.

This ADR is the introspection-and-validation companion to [ADR 074](074-cli-config-resolution-correctness.md). ADR 074 makes the resolution semantics correct; this ADR surfaces and guards them. It does not change precedence or merge order.

## Decision

1. **Write-time validation in `config set`.** Validate the dotted path against the known config schema (the `btc.*`, `cas.*`, `identity.*`, and `defaults.*` shapes in `ConfigFile`, `config.ts:61-89`) and validate enum values for known keys: `defaults.network` must be in `SUPPORTED_NETWORKS` (`types.ts:9`) and `defaults.output` must be in `{'json', 'text'}` (`OutputFormat`, `types.ts:7`). An **unknown path is a warning that still writes**, so forward-compatible and third-party keys are never blocked. An **invalid enum value for a known key is a hard rejection** (a `CLIError`), so `defaults.network mainnett` fails loudly at write time instead of being silently discarded at read time.

2. **A `config validate` subcommand.** Read an existing config file and report unknown keys, out-of-enum values for known keys, and a `schemaVersion` mismatch against `CONFIG_SCHEMA_VERSION` (`config.ts:92`), ending in a clear pass/fail. It reuses the same schema knowledge as the write-time validation in decision 1, so `set` and `validate` never disagree. This is the strict check that complements the permissive warn-and-write of `config set`.

3. **A `config effective [--network <n>]` subcommand.** Print the resolved connection config (the merged `BitcoinApiConfig`/`CasConfig` that `resolveConnectionConfig` produces) with a per-value provenance tag drawn from the same four layers the merge already uses: `flag`, `env`, `file:<profile>`, or `default`. This answers "what btc-rest will actually be used, and where did it come from?" directly, without the user reconstructing the precedence in their head. Because the merge is unchanged, `effective` reports the resolver's real output rather than an approximation.

4. **A `config path` subcommand.** Print the resolved config-file path (honoring `--config` and the XDG resolution in `defaultConfigPath`, `config.ts:197-202`) and the resolved keystore path (honoring `--keystore` and `defaultKeystorePath`, `keystore/paths.ts:15-20`), so a user can locate the exact files the tool is reading rather than guessing at the XDG defaults.

5. **A `config doctor` subcommand.** Probe reachability of the resolved endpoints without mutating anything: a lightweight REST call against btc-rest, a `getblockchaininfo` against btc-rpc when an RPC endpoint is configured, and a reachability check against the configured CAS (gateway and/or rpcUrl). Report per-endpoint `ok`/`fail` and surface the profile/network coherence warning (for example, a profile whose endpoints point at a different network than the one selected). `doctor` reads configuration and touches the network; it never writes.

## Consequences

- This is the introspection-and-validation surface a user-configurable I/O tool needs: `set`/`validate` stop silent-typo configuration from persisting unnoticed, and `effective`/`path`/`doctor` let a user see what the tool actually resolved and reached.
- `config effective` and `config doctor` are also how a user confirms that other configuration fixes took effect. When ADR 074 corrects a resolution edge case, or when a user adds a profile, `effective` shows the new resolved value with its provenance and `doctor` shows whether the endpoint answers.
- **No change to merge semantics.** This ADR surfaces and guards the precedence and merge order; it does not redefine them. Precedence correctness is [ADR 074](074-cli-config-resolution-correctness.md)'s concern. `config effective` reads through the existing resolver rather than reimplementing it, so the two cannot drift.
- **Provenance tagging reuses the existing four-layer model** (`config.ts:286-294`). No new precedence concept is introduced; the tags (`flag`, `env`, `file:<profile>`, `default`) name the layers the merge already walks.
- Warn-and-write for unknown paths keeps `config set` forward-compatible: a key added by a future schema version, or by a third-party extension, is not rejected by an older cli. `config validate` remains available for a strict pass.
- Ships as a cli minor bump. It is additive (new subcommands plus a write-time guard that only hard-rejects previously-silently-ignored invalid enum values); it adds no api or method change, since the resolved config, the schema, and the four layers all already exist in the cli.

## Rejected alternatives

- **Reject unknown config paths outright.** Too rigid. It blocks forward-compatible keys (a newer schema version written by a newer cli, then read by an older one) and third-party extension of the config file, for no safety gain the enum checks do not already provide. Warn-and-write is the right default, with `config validate` for callers who want a strict check.
- **Infer effective config by re-reading the file in each command instead of a dedicated `config effective`.** Duplicative and lossy. Every command would reconstruct the merge, the reconstructions would drift from `resolveConnectionConfig`, and none of them would show provenance, which is the actual question a user has. One subcommand that reads through the real resolver is both simpler and strictly more informative.
- **A persistent daemon or health endpoint instead of a one-shot `config doctor`.** Far too heavy for a CLI. A one-shot probe that reports per-endpoint `ok`/`fail` and exits gives the user the answer they want (are my endpoints reachable right now) without a background process, a port, or a lifecycle to manage.
