# @did-btcr2/cli

## 0.18.0

### Minor Changes

- Add a `quickstart` command, fold the network into `init`, and print faucet/explorer links (ADRs 082, 083).

  - **`btcr2 quickstart`** collapses onboarding into one step: it composes `init` (home + config + keystore), records the network (default **mutinynet**), and optionally caches the session and probes endpoints. Flags: `-n/--network`, `--dev`, `--unlock` (opt-in session caching), `--ttl`, `--no-doctor`, `--allow-mainnet`, `--force`. Session caching stays opt-in so ADR 081's establish-vs-cache separation holds; on a fresh encrypted keystore `--unlock` reuses the establish-time passphrase with no second prompt. The endpoint probe runs by default but is advisory (a failed probe warns and still exits 0). Mainnet is guarded before any writes: `-n bitcoin` requires `--allow-mainnet`, and `-n bitcoin --dev` is refused.
  - **`btcr2 init` gains `-n/--network`**, recording `defaults.network` so later commands can drop `-n`; its output envelope gains a `network` field. The network write is idempotent and never clobbers a network the operator set earlier.
  - **Funding and watch links.** `create` on a testnet now prints the initial beacon address next to its faucet and explorer links; `update`/`deactivate` print a `Watch:` explorer link for the broadcast txid. These are text-mode stderr hints only, suppressed under `--quiet` and `--output json`, so machine output is unchanged.

  Breaking output surface: adds a `quickstart` result shape, a `network` field on `init` output, and new stderr hint lines. Machine (JSON) output shape is otherwise unchanged.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.17.0

## 0.17.0

### Minor Changes

- Add a session unlock agent so an encrypted keystore is authenticated once per session instead of on every command (ADR 081).

  - **`keystore unlock`** caches the verified passphrase in `<home>/session.json` (`0600`, TTL, bound to the keystore) so later commands do not re-prompt. `--ttl <duration>` sets the lifetime (bare seconds or an `s`/`m`/`h` suffix; default 1h, hard cap 24h; also `$BTCR2_KEYSTORE_TTL`).
  - **`keystore lock`** revokes the session; **`keystore status`** now reports whether a session is live and its remaining lifetime (a new `session` field on its output).
  - A cached session sits below `$BTCR2_KEYSTORE_PASSPHRASE` / `--passphrase-file` and above the interactive prompt, so unattended and CI paths still win and are never weakened by it. Establishment (the confirmed first passphrase, ADR 080) never consults the session, and the keystore verifier still checks every use, so a stale or forged cache can never seal a key under a divergent passphrase.
  - Mainnet keeps per-use authentication: `keystore unlock` refuses a `bitcoin` _default_ network unless `--allow-mainnet` is passed, and the session records that allowance so that at consumption a `bitcoin` operation (whose network is derived from the DID, not the config default) is withheld from a session lacking it and falls through to a per-use prompt, while other networks are still served. `change-passphrase`, `keystore init --force`, and `btcr2 init` (when it establishes a keystore) invalidate any cached session.
  - The cached passphrase is base64url-encoded, not encrypted: its only protection at rest is the `0600` file mode. This is a deliberate on-disk v1 for portability and a minimal diff; a future in-memory agent removes the on-disk persistence.

## 0.16.0

### Minor Changes

- Consolidate CLI state under one home directory and add a keystore lifecycle with a confirmed, verified passphrase and opt-in dev keystores (ADRs 079, 080).

  - **Single home directory (ADR 079, breaking default).** `config.json` and `keystore.json` now live side by side under one home: `~/.btcr2` on Linux/macOS, `%LOCALAPPDATA%\btcr2` on Windows, overridable with `--home` / `$BTCR2_HOME`. The old XDG config/data split is dropped outright (no migration path: re-run `btcr2 init` against the new home); `--config` / `--keystore` still override each file, so the split is reproducible explicitly. `btcr2 config path` now reports the home root.
  - **Confirmed, verified keystore passphrase (ADR 080).** The first passphrase is now established with a confirm prompt, and a keystore verifier makes every later use fail loudly (`Incorrect passphrase`) instead of sealing a key under an unknown or divergent passphrase, closing a key-loss bug where a first-key typo permanently sealed the keystore.
  - **`keystore` command group.** `keystore init` (encrypted by default, `--dev` for unencrypted), `keystore status`, and `keystore change-passphrase`.
  - **Opt-in dev keystores.** `--dev` establishes an unencrypted keystore (plaintext keys, no passphrase) for disposable testnet material; the CLI hard-refuses to sign or generate a mainnet (`bitcoin`) key with one.
  - **`btcr2 init`.** One-command setup that creates the home, a default config, and establishes the keystore (encrypted by default, `--dev` for testnet).

## 0.15.0

### Minor Changes

- User-configurable Bitcoin/CAS I/O with config correctness, validation, introspection, and secret handling (ADRs 074-078).

  - Config resolution correctness and safety: a malformed config now fails loudly instead of silently falling back to public endpoints or clobbering the file; a blank value at any precedence layer defers to the next layer; an empty `$XDG_CONFIG_HOME`/`$XDG_DATA_HOME` is treated as unset; the RPC url, user, and pass resolve as one atomic credential unit (a URL from a higher layer never inherits a lower layer's credentials); `config set` stores known scalar paths as strings; profiles gain an explicit `network` field and the two network resolvers are unified with a coherence warning; `defaults.output` is honored; `schemaVersion` is validated on read.
  - New Bitcoin/CAS I/O knobs, each with a `BTCR2_*` env var and a profile field: `--fee-rate`, `--change-address`, `--btc-timeout`, `--cas-timeout`, `--btc-rest-header`, `--btc-rpc-wallet`, `--btc-rpc-header`.
  - New introspection and validation: `config validate`, `config effective` (resolved values with per-value provenance), `config path`, and `config doctor` (endpoint reachability). `config set` rejects an invalid enum for a known key and warns on an unknown path.
  - Secret handling: `config get`/`list`/`effective` redact secret-looking values by default (`--show-secrets` reveals them); `rpcPass` accepts `env:<VAR>` and `file:<path>` secret references plus a `BTCR2_BTC_RPC_PASS_FILE` fallback.
  - Per-profile `identity.keystore` and `identity.default` are wired, below the `--keystore` / `--signing-key` flags.

  Printed output for `config get` and `config list` changes (secret values are now redacted by default), so this rides a minor bump.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.16.1
  - @did-btcr2/method@0.54.1

## 0.14.0

### Minor Changes

- Add writable-CAS configuration and an opt-in `--publish-to-cas` flag to `update`/`deactivate`.

  - New global `--cas-rpc-url <url>` flag, `BTCR2_CAS_RPC_URL` environment variable, and `profiles.<n>.cas.rpcUrl` config key configure a writable IPFS HTTP RPC endpoint (reads + writes). `resolveConnectionConfig` now carries `cas.rpcUrl` through the flag/env/config precedence chain; a previously silently-dropped `config set profiles.x.cas.rpcUrl` is now honored. When both a gateway and an RPC URL are set, the writable RPC endpoint takes precedence.
  - `update` and `deactivate` gain `--publish-to-cas <auto|always|never>`, validated at parse time and forwarded to the api's `publishToCas`. It **defaults to `never`**: CAS publication is optional and never required, so updates complete sidecar-only unless the user opts in. This replaces the hardcoded `'never'` from the previous release with no change to default behavior.

  See ADR 072.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.16.0

## 0.13.0

### Minor Changes

- **Breaking output change:** `update` and `deactivate` now print the api's enriched `DidUpdateResult` instead of the bare signed update. The old payload moves under `data.signedUpdate`; new fields are `data.txid`, `data.announcement` (CAS beacons), `data.proof` (SMT beacons), and `data.publishedToCas`. Note that `data.proof` changes meaning: it was the signed update's Data Integrity proof (now at `data.signedUpdate.proof`) and is now the optional SMT inclusion proof. Scripts parsing this output must be updated.

  The enriched output surfaces the artifacts required for manual sidecar distribution (txid, announcement, SMT proof). The cli passes `publishToCas: 'never'` explicitly (its CAS configuration is read-only gateway-only for now); a follow-up exposes writable-CAS configuration and a `--publish-to-cas` flag.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.15.0
  - @did-btcr2/method@0.54.0

## 0.12.18

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.14.0

## 0.12.17

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.53.0
  - @did-btcr2/api@0.13.12

## 0.12.16

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.52.0
  - @did-btcr2/api@0.13.11

## 0.12.15

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.51.0
  - @did-btcr2/api@0.13.10
