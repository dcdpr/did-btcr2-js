---
title: "ADR 077: CLI Secret Handling for Bitcoin RPC Credentials"
---

# ADR 077: CLI Secret Handling for Bitcoin RPC Credentials

**Status:** Accepted

**Date:** 2026-07-07

**Branch / PR:** `feat/cli-io-config`

**References:** [ADR 052](052-cli-keystore-file-locking.md), [ADR 072](072-cli-writable-cas-and-publish-flag.md), [ADR 074](074-cli-config-resolution-correctness.md)

## Context

The Bitcoin Core RPC password is the one CLI-held secret with no protection and no indirection. It is declared as a plain string field on the profile schema (`config.ts:75`, `rpcPass?: string`), copied verbatim through `profileToOverrides` (`config.ts:231`, `btcRpcPass: profile.btc?.rpcPass`), and merged straight into the RPC client's `password` field in `resolveConnectionConfig` (`config.ts:306`). At every hop it is plaintext.

The introspection commands make that plaintext visible. `config get profiles.<name>.btc.rpcPass` and `config list` render whatever value the key holds through `formatResult` (`output.ts:11-16`), which serializes the payload as-is. So the routine act of inspecting configuration prints the RPC password into terminal scrollback, screen shares, and CI job logs, none of which are places a credential should land.

This is out of step with the only other secret the CLI handles. The keystore passphrase is never accepted from a command-line flag (which would leak into process listings and shell history), and it already supports a file and an environment variable as sources, with a single trailing newline trimmed so the input is source-independent (`keystore/passphrase.ts:24-49`). The RPC password has none of that: no env var, no file reference, no redaction. The README compounds the gap by showing a bare cleartext password in a `config set` example (`README.md:257`).

The connection-config merge itself is otherwise sound after ADR 074, and the RPC password already flows correctly through the flag -> env -> profile -> per-network-default precedence. The problem here is narrow: the secret is stored and displayed in the clear, and there is no way to keep it out of `config.json`.

## Decision

1. **Redact secret-looking keys in printed output by default.** `config get` and `config list` mask the value of `rpcPass` and of any key whose leaf name matches a secret-name pattern (`pass`, `password`, `secret`, `token`), printing a fixed placeholder in place of the value. The redaction is display-only: the stored `config.json` is untouched, and the value still flows normally into the RPC client at connection time. Passing `--show-secrets` prints the real values for deliberate debugging.

2. **Add a file/env secret-ref for the RPC password, mirroring the keystore-passphrase pattern.** The `rpcPass` value accepts two indirection forms in addition to a literal: `env:<VARNAME>` reads the secret from the named environment variable, and `file:<path>` reads it from a file. A `BTCR2_BTC_RPC_PASS_FILE` environment variable names a file to read when no other source applies, matching how `BTCR2_KEYSTORE_PASSPHRASE` and `--passphrase-file` supply the keystore secret. Resolution trims at most one trailing newline (`\r?\n$`), identical to `keystore/passphrase.ts:28,31`, so a file written by `echo` behaves the same as an inline value. With a secret-ref in place, the secret need not live in `config.json` at all.

3. **Document the plaintext-at-rest tradeoff.** The README states plainly that an `rpcPass` written directly into `config.json` is stored in cleartext (the file is mode 0600 but not encrypted), and recommends either the `env:`/`file:` secret-ref or an RPC-URL-embedded credential for anything sensitive. The `config set` example is changed away from a bare cleartext password so the docs stop modeling the weakest option.

## Consequences

- Routine introspection no longer echoes RPC passwords. `config get`/`config list` show a placeholder for secret keys unless `--show-secrets` is given, so screen shares and CI logs stop leaking the credential by default.
- Unattended and automated use gains a file-based secret path (`env:`/`file:` and `BTCR2_BTC_RPC_PASS_FILE`) that is consistent with the keystore passphrase, letting operators keep the RPC password out of `config.json` and out of shell history.
- **Printed-output change for secret keys.** `config get` and `config list` no longer print `rpcPass` (and other secret-name-matched keys) verbatim. Per the CLI's output-shape-is-a-surface convention, this rides a cli minor bump at 0.x.
- The redaction is purely a display concern. It does not change what `config effective` / `doctor` (sibling [ADR 075](075-cli-config-validation-and-introspection.md)) resolve in order to connect, and it does not alter the resolved RPC `password` handed to the client.
- This does not encrypt `config.json`. The keystore remains the mechanism for encrypted secret material; RPC credentials are deliberately kept out of the keystore, since they are low-value connection secrets rather than signing keys, and folding them in would couple network config to keystore unlock.

## Rejected alternatives

- **Encrypt `rpcPass` inside `config.json`.** Large scope creep for a low-value secret: it duplicates the keystore's job, forces a passphrase (or its own key material) on every config read, and complicates `config get`/`config set`/`list` and the connection merge for marginal benefit. The env/file secret-ref plus display redaction is the proportionate fix and keeps `config.json` a plain, hand-editable file.
- **Forbid storing `rpcPass` in the file at all and require a secret-ref.** Too rigid for local and regtest workflows, where a 0600 cleartext password in `config.json` is an acceptable convenience and the credential guards a throwaway node. The decision keeps the inline value working and makes the secret-ref the recommended path for sensitive setups rather than the only path.
- **Redact but offer no way to reveal.** Blocks legitimate debugging, since an operator sometimes needs to confirm exactly what value is stored. `--show-secrets` is the explicit escape hatch, so the safe default does not become an obstacle.
