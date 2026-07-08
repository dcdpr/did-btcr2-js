# @did-btcr2/cli

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
