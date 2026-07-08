---
title: "ADR 074: CLI Configuration Resolution Correctness and Safety"
---

# ADR 074: CLI Configuration Resolution Correctness and Safety

**Status:** Accepted

**Date:** 2026-07-07

**Branch / PR:** `feat/cli-io-config`

**References:** [ADR 053](053-bitcoin-defaults-in-sdk.md), [ADR 072](072-cli-writable-cas-and-publish-flag.md), [ADR 073](073-cas-publication-is-opt-in.md), [ADR 075](075-cli-config-validation-and-introspection.md), [ADR 076](076-cli-io-passthrough-knobs.md), [ADR 077](077-cli-rpc-secret-handling.md)

## Context

The cli already resolves connection config through a four-layer precedence chain: CLI flag -> environment variable -> config-file profile -> per-network SDK default (`resolveConnectionConfig`, `config.ts:271-319`). The config file is XDG-located (`config.ts:197-202`), read-modify-written atomically at 0600 (`config.ts:99-105`), and exposed through the `config` and `profile` command groups. The per-network Bitcoin defaults live in the SDK ([ADR 053](053-bitcoin-defaults-in-sdk.md)): mempool.space for public networks, localhost Polar for regtest.

That machinery has the right shape, but a review of the shipped code surfaced nine latent defects. Several of them cause the cli to silently ignore a user's configured private endpoint and fall through to a public default (mempool.space) or to a wrong host. For a censorship-resistant DID method where the whole point of a private node is to avoid leaking which identifiers you resolve, a silent fall-through to a public endpoint is a correctness and privacy defect, not a cosmetic one. Two of the defects (config write, stale credentials) can also destroy user data or send credentials to the wrong host.

Concretely:

1. **A malformed file is indistinguishable from a missing one.** `readConfigFile` (`config.ts:208-215`) wraps `readFileSync` + `JSON.parse` in a single `try`/`catch` that returns `undefined` for *any* error. A JSON typo (trailing comma, unquoted key) is reported identically to `ENOENT`, so both `resolveConnectionConfig` and `resolveDefaultNetwork` treat a broken file as "no file" and fall back to network defaults. The user's private node is silently replaced by mempool.space with no diagnostic.

2. **A write can clobber an unparseable file.** `writeConfigFile` (`config.ts:100`) begins with `readConfigFile(path) ?? {}`. Because a parse error is swallowed to `undefined` (defect 1), the next `config set` or `profile use` starts from `{}`, mutates it, and atomically overwrites the file, destroying every other profile and default that the malformed-but-recoverable file still held. A single stray character followed by one write is unrecoverable data loss.

3. **A blank value is treated as unset only at the env layer.** `readEnvOverrides` collapses `''` to `undefined` with `|| undefined` (`config.ts:178`), but the flag and file layers merge with `??` (`config.ts:288-294`), which only skips `null`/`undefined`. An empty flag value or an empty string in a profile therefore masks a populated lower layer and then, being falsy at the `if (merged.btcRest)` guards (`config.ts:298-316`), contributes nothing, so resolution silently reverts to the SDK network default.

4. **An empty XDG variable resolves to a CWD-relative path.** `defaultConfigPath` (`config.ts:198-201`) and `defaultKeystorePath` (`keystore/paths.ts:16-19`) use `process.env.XDG_CONFIG_HOME ?? process.env.APPDATA ?? homedir(...)`. `??` only falls through on `null`/`undefined`, so `XDG_CONFIG_HOME=""` (common in CI images and containers) yields a relative `btcr2/config.json` resolved against the current working directory rather than the home directory. The XDG Base Directory specification says an empty value must be treated as unset.

5. **RPC url, user, and pass merge independently.** `resolveConnectionConfig` (`config.ts:289-291`) resolves `btcRpcUrl`, `btcRpcUser`, and `btcRpcPass` as three separate `??` chains. So `--btc-rpc-url http://node-B` layered over a profile that holds node-A's url plus node-A's credentials produces `{ host: 'node-B', username: node-A-user, password: node-A-pass }`: node-A's credentials are sent to node-B.

6. **`config set` coerces known scalars to non-strings.** The `set` command runs `JSON.parse` on the raw value and stores whatever it yields (`commands/config.ts:78-84`). `config set profiles.regtest.btc.rpcUrl 8080` therefore stores the *number* `8080`, which flows into `btc.rpc.host` (`config.ts:302-307`) as a non-string host and breaks downstream URL handling.

7. **The two network resolvers disagree.** `resolveConnectionConfig` picks the profile key as `flag ?? defaults.profile ?? network` (`config.ts:280`), so *any* active profile supplies endpoints. But `resolveDefaultNetwork` only treats a profile as a network when the profile *name* is itself a supported network (`config.ts:249-255`). So an active profile named `production` that holds mainnet endpoints, combined with `create` and no `--network`, mints a **regtest** DID (the fallback) while the same run wires **production** endpoints. The identifier's network and the endpoints it talks to disagree.

8. **`defaults.output` is written but never read.** It is part of the `ConfigFile` type (`config.ts:65-69`) and stamped by `config init` (`commands/config.ts:36`), but the commander option carries a hard default of `'text'` (`cli.ts:44`). `formatResult` reads only `options.output` (`output.ts:11-12`), which is therefore always `'text'` (or the flag), so the configured default is dead.

9. **`schemaVersion` is written but never read.** Every write stamps `CONFIG_SCHEMA_VERSION` (`config.ts:102`), yet no read path compares it. A file written by a newer cli, or a legacy pre-versioned file, is parsed blindly under today's assumptions with no guard and no migration.

## Decision

1. **Distinguish a missing file from a malformed one.** `readConfigFile` returns `undefined` only for `ENOENT` (a genuinely absent file). Any other read failure, and every JSON parse failure, throws a `CLIError` that names the file path and, for parse errors, the byte offset reported by the JSON parser. A broken config now fails loudly instead of silently degrading to public defaults.

2. **Never clobber an unparseable file on write.** `writeConfigFile` no longer starts from `{}` when the file exists but fails to parse. It surfaces the parse error (via decision 1) and refuses the write, so a recoverable typo can be fixed by hand rather than destroyed by the next `set`. A true `ENOENT` still starts from `{}` as before.

3. **Treat a blank value as unset at every layer.** A shared `blankToUndef` helper normalizes `''` and whitespace-only strings to `undefined`, and it is applied to flag values and config-file values before the `??` merge, matching what `|| undefined` already does for the env layer (`config.ts:178`). An empty flag or an empty profile field no longer masks a populated lower layer; the next layer down is consulted as if the blank were absent.

4. **Treat an empty XDG or APPDATA value as unset.** `defaultConfigPath` and `defaultKeystorePath` use the same blank-to-undefined normalization for `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `APPDATA`, and `LOCALAPPDATA`, so an empty value falls through to the home-directory fallback per the XDG Base Directory specification. This mirrors the `|| undefined` pattern already used at `config.ts:178` and removes the CWD-relative-path hazard.

5. **Treat the RPC url plus user plus pass as one atomic credential unit.** When the effective `btcRpcUrl` is resolved from a higher-precedence layer than the credentials would be, the username and password are taken from the *same* layer as the url, or dropped if that layer supplies none. Credentials are never inherited across a url that came from a different (higher) layer, so a flag-supplied host can never be handed a profile-supplied user and password.

6. **Store raw strings for known scalar endpoint and credential paths.** `config set` skips `JSON.parse` for the known scalar paths (the `btc.rest`/`btc.rpcUrl`/`btc.rpcUser`/`btc.rpcPass` and `cas.gateway`/`cas.rpcUrl` leaves under any profile, plus `defaults.profile`/`defaults.network`/`defaults.output`) and stores the raw string. JSON coercion is retained only for genuinely structured values (objects, arrays, booleans, numbers at paths that expect them), so `config set profiles.regtest.btc.rpcUrl 8080` stores the string `'8080'`.

7. **Add `profiles.<name>.network` and unify the two network resolvers.** A profile may carry an explicit `network` field. Both `resolveDefaultNetwork` and `resolveConnectionConfig` derive the `(profileName, network)` pair from one shared helper: the profile's own `network` field takes precedence over inferring a network from the profile *name*. When the network the `create` command is about to encode and the active profile's declared network disagree, the cli emits a warning naming both, so a `production` profile holding mainnet endpoints can no longer silently mint a regtest DID.

8. **Honor `defaults.output`.** The commander `-o/--output` hard default of `'text'` (`cli.ts:44`) is dropped so an unset flag reads as `undefined`. Effective output is resolved as flag -> env -> config `defaults.output` -> `'text'`, so a configured default is used when no flag is given and the flag still wins when present.

9. **Validate and migrate `schemaVersion` on read.** On read, the file's `schemaVersion` is compared to `CONFIG_SCHEMA_VERSION`. A newer version is refused with a clear message telling the user to upgrade the cli. An older version runs registered migrations to bring the in-memory shape up to the current version before use. An absent `schemaVersion` is treated as the earliest known version and migrated forward.

## Consequences

- These are correctness and data-safety repairs to already-shipped config code. The only new user-facing surface is the `profiles.<name>.network` field (decision 7) and the now-honored `defaults.output` (decision 8); everything else changes internal resolution behavior, not the config schema.
- A malformed config now fails loudly, naming the file and the parse offset, instead of silently falling through to public endpoints or clobbering the file on the next write. Users who previously had a broken-but-unnoticed config will start seeing an explicit error; that is the intended correction.
- Precedence becomes reliable across all four layers: a blank at any layer defers to the next, credentials travel with their url, and an empty XDG value no longer drops a config or keystore file into the working directory.
- The network a `create` run encodes and the endpoints it talks to can no longer silently disagree; a mismatch warns.
- This ships as a cli minor bump at 0.x. No `api` or `method` change is required; the resolution logic is entirely cli-side.
- **Precedence tests are strengthened to be non-vacuous.** The existing tests (`config.spec.ts:239-266`) assert only `api.btc.connection.name === 'regtest'`, an invariant that holds regardless of which layer won, so they would pass even if precedence were reversed. New tests assert the resolved host (`api.btc.connection.rest.config.host`) equals the expected layer's value, that `rpcUser`/`rpcPass` actually reach `btc.rpc`, and that a config-file `defaults.profile` selects a non-network-named profile's endpoints.

## Rejected alternatives

- **Keep swallowing parse errors and just log a warning.** A silent (or warned-then-ignored) fall-through to public endpoints is a correctness and privacy hazard for a method whose value proposition is private resolution, and warnings on stderr are routinely lost in scripted use. Refusing to proceed on a broken config is the only safe default; the loud failure is the point.
- **Keep independent field merge and document the stale-credential footgun.** Documentation does not stop the credentials from leaking. As long as the three fields merge separately, a url from one layer can be paired with credentials from another and node-A's secrets can be sent to node-B. The fix belongs in the resolution logic, not the manual.
- **Infer the network from the profile name only (the status quo) instead of adding an explicit `network` field.** Requiring the profile name to equal a network name is brittle and surprising: it forces users to name profiles after networks and silently misbehaves for any profile that is not (a `staging` or `production` profile cannot express its network at all). An explicit `network` field is the direct, unambiguous representation.
