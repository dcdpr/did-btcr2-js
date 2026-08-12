# btcr2 CLI documentation

Reference documentation for `btcr2`, the command-line tool for creating, resolving, updating, and
deactivating `did:btcr2` identifiers.

## Commands

| Command | Purpose |
|---------|---------|
| [`btcr2 init`](./init.md) | Set up the btcr2 home: create the directory, a default config, and establish the keystore. |
| [`btcr2 quickstart`](./quickstart.md) | One-command onboarding: home + config + keystore, record the network, optionally cache a session and probe endpoints. |
| [`btcr2 create`](./create.md) | Create an identifier and initial DID document (offline). |
| [`btcr2 resolve`](./resolve.md) | Resolve the DID document of an identifier (alias: `read`). |
| [`btcr2 update`](./update.md) | Update a did:btcr2 document: sign a JSON Patch and broadcast a beacon signal. |
| [`btcr2 deactivate`](./deactivate.md) | Permanently deactivate an identifier (alias: `delete`; irreversible). |
| [`btcr2 key`](./key.md) | Manage keypairs in the encrypted keystore. |
| [`btcr2 keystore`](./keystore.md) | Establish, inspect, re-key, and unlock the keystore. |
| [`btcr2 config`](./config.md) | Read and write CLI configuration. |
| [`btcr2 profile`](./profile.md) | Manage configuration profiles. |
| [`btcr2 completion`](./completion.md) | Print a shell completion script (bash, zsh, or fish). |
| [DEMO.md](./DEMO.md) | Guided end-to-end walkthrough: create, fund, resolve, update, deactivate on mutinynet. |

## Global options

Global flags are declared on the root program (before the command word) and are shared by every
command; each command doc lists which globals it actually consumes. The table below matches
`btcr2 --help` (v0.18.1) and the option declarations in `src/cli.ts`.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-v, --version` | none | n/a | Print `btcr2 <version>` and exit. |
| `-o, --output <format>` | `json` \| `text` | resolved per invocation: flag, else `BTCR2_OUTPUT`, else config `defaults.output`, else `text` | Output format. `text` prints only the data payload (pretty-printed JSON, or a bare string for `create`); `json` prints the full `{ "action": ..., "data": ... }` envelope. Help-text note: `--help` says "default: config defaults.output, else text" and omits the `BTCR2_OUTPUT` layer; in source the env var sits between the flag and the config default. |
| `--verbose` | boolean | `false` | Print the full structured error object and stack on failure instead of the message alone. |
| `--quiet` | boolean | `false` | Suppress non-essential stderr output (hints, warnings). Never changes the stdout payload. |
| `--home <dir>` | directory path | `$BTCR2_HOME`, else `~/.btcr2` on Linux/macOS; `%LOCALAPPDATA%\btcr2` on Windows (falling back to `%APPDATA%\btcr2`, then the user profile) | The btcr2 home directory holding `config.json`, `keystore.json`, and `session.json`. A blank value at any layer defers to the next. |
| `-c, --config <path>` | file path | `<home>/config.json` | Config file to read and write. Names a specific file; it does not move the home. |
| `--profile <name>` | profile name | config `defaults.profile`, else the profile named after the operation's network | Selects the active config profile (see [profile.md](./profile.md)). |
| `--btc-rest <url>` | URL | per-network SDK default (mempool.space-style endpoints; tabulated in [resolve.md](./resolve.md#environment--configuration)) | Override the Bitcoin REST (Esplora) endpoint. |
| `--btc-rpc-url <url>` | URL | `http://localhost:18443` on regtest; none on other networks | Override the Bitcoin Core RPC endpoint. |
| `--btc-rpc-user <user>` | string | none | Bitcoin Core RPC username. The RPC password has no flag (a password on argv is visible in `ps` and shell history); supply it via `BTCR2_BTC_RPC_PASS`, `BTCR2_BTC_RPC_PASS_FILE`, or the profile's `btc.rpcPass` (which accepts a literal value or an `env:<VAR>` / `file:<path>` secret reference). RPC url, user, and pass resolve as one atomic unit per precedence layer (ADR 074). |
| `--cas-gateway <url>` | URL | `https://ipfs.io` | IPFS HTTP gateway for CAS reads (read-only). |
| `--cas-rpc-url <url>` | URL | none | IPFS HTTP RPC endpoint for a writable CAS (reads + writes). Configuring one is what makes `--publish-to-cas auto`/`always` on `update`/`deactivate` meaningful. |
| `--btc-timeout <ms>` | finite number >= 1 | unset (unbounded) | Bitcoin REST/RPC request timeout in milliseconds. |
| `--cas-timeout <ms>` | finite number >= 0; `0` disables | unset; the api layer then applies 30000 ms | CAS request timeout in milliseconds. |
| `--btc-rest-header <header>` | `'Key: Value'`, repeatable | `[]` | Extra Bitcoin REST header. Merges over the profile's `btc.headers`, flag winning per key. A value without a `Key: Value` colon is rejected. |
| `--btc-rpc-wallet <name>` | string | none | Bitcoin Core wallet name for wallet-scoped RPCs. |
| `--btc-rpc-header <header>` | `'Key: Value'`, repeatable | `[]` | Extra Bitcoin Core RPC header. Merges over the profile's `btc.rpcHeaders`. |
| `--keystore <path>` | file path | active profile's `identity.keystore`, else `<home>/keystore.json` | Path to the keystore file. The flag short-circuits before any config read. |
| `--passphrase-file <path>` | file path | none | Read the keystore passphrase from a file (unattended use). Note: `BTCR2_KEYSTORE_PASSPHRASE` is consulted BEFORE this file. |
| `--signing-key <ref>` | key URN (`urn:kms:secp256k1:<32 hex>`), unique `name` tag, or unique fingerprint prefix | active profile's `identity.default`, else the keystore's active key | Key for `create`/`update`/`deactivate` signing. |
| `-h, --help` | none | n/a | Display help for the command. |

### Related per-command flags

These are not global flags; they live on individual commands and are documented there:

- `--publish-to-cas <auto|always|never>`, `--fee-rate <satsPerVByte>`, and
  `--change-address <address>` on [`update`](./update.md) and [`deactivate`](./deactivate.md).
- `-n, --network <network>` on [`create`](./create.md), [`init`](./init.md),
  [`quickstart`](./quickstart.md), and `config effective` / `config doctor`
  ([config.md](./config.md)). Commands that take a DID or a DID document derive the network from
  it instead.
- `--ttl <duration>` and `--allow-mainnet` on `keystore unlock` ([keystore.md](./keystore.md)) and
  [`quickstart`](./quickstart.md).

### Environment variables

Every `BTCR2_*` variable the CLI consults, from `src/config.ts`, `src/paths.ts`,
`src/keystore/passphrase.ts`, and `src/keystore/session.ts`:

| Variable | Equivalent flag / role |
|----------|------------------------|
| `BTCR2_HOME` | Home directory when `--home` is absent. Blank values are ignored. |
| `BTCR2_OUTPUT` | Output format (`json` or `text`) when `-o/--output` is absent. |
| `BTCR2_BTC_REST` | `--btc-rest` |
| `BTCR2_BTC_RPC_URL` | `--btc-rpc-url` |
| `BTCR2_BTC_RPC_USER` | `--btc-rpc-user` |
| `BTCR2_BTC_RPC_PASS` | RPC password (no flag equivalent). The value may itself be an `env:<VAR>` / `file:<path>` secret reference. |
| `BTCR2_BTC_RPC_PASS_FILE` | Path to a file whose contents are the RPC password. No flag equivalent; the final fallback when no layer supplies a password, read lazily only when an RPC config is actually built. |
| `BTCR2_CAS_GATEWAY` | `--cas-gateway` |
| `BTCR2_CAS_RPC_URL` | `--cas-rpc-url` |
| `BTCR2_BTC_TIMEOUT` | `--btc-timeout` |
| `BTCR2_CAS_TIMEOUT` | `--cas-timeout` |
| `BTCR2_FEE_RATE` | `--fee-rate` (a per-command flag on `update`/`deactivate`) |
| `BTCR2_KEYSTORE_PASSPHRASE` | Keystore passphrase for unattended use. Consulted BEFORE `--passphrase-file`; never accepted as a flag value. One trailing newline is trimmed. |
| `BTCR2_KEYSTORE_TTL` | Default session TTL below the `--ttl` flag (`keystore unlock`, `quickstart --unlock`). Same value domain as `--ttl`. |

There is no environment variable for the network, the change address, the keystore path, or the
signing-key reference.

### Precedence

The general rule is often summarized as `flag > env var > profile config > config defaults >
built-in default`. What the source actually implements is per-knob; the full five-layer chain
exists only where a `defaults.*` config key exists for the knob (`defaults.*` holds only
`profile`, `network`, and `output`):

- Connection values (endpoints, credentials, timeouts, headers):
  `flag > env var > active profile in config.json > built-in per-network SDK default`. There is no
  `defaults.*` layer for connection values. A blank value at any layer defers to the next layer
  instead of masking it.
- Output format: `-o/--output` flag `>` `BTCR2_OUTPUT` `>` config `defaults.output` `>` `text`.
- Network, for commands that do not take a DID: `-n` flag `>` config `defaults.network` `>` the
  active profile's network (its `network` field, else its name when it names a network) `>` a
  built-in fallback (`regtest`; `quickstart` alone falls back to `mutinynet`). Note the
  `defaults.network` layer sits ABOVE the profile layer here, and there is no env var. Commands
  that take a DID or DID document always derive the network from it.
- RPC endpoint: url, user, and pass are bound together from the single highest layer that supplies
  a url (else the highest that supplies a credential), so a host from one layer never receives
  another layer's credentials. `BTCR2_BTC_RPC_PASS_FILE` is the password fallback below all layers.
- Home directory: `--home` flag `>` `BTCR2_HOME` `>` platform default. The config file is never
  consulted (it lives inside the home).
- Keystore path: `--keystore` flag `>` active profile's `identity.keystore` `>`
  `<home>/keystore.json`.
- Signing key: `--signing-key` flag `>` active profile's `identity.default` `>` the keystore's
  active key.
- Keystore passphrase (exception: the env var outranks the flag-named file):
  `BTCR2_KEYSTORE_PASSPHRASE` `>` `--passphrase-file` `>` a live session at `<home>/session.json`
  `>` interactive prompt.
- Fee rate: `--fee-rate` `>` `BTCR2_FEE_RATE` `>` profile `btc.feeRate` `>` SDK default
  (5 sat/vB). Change address: `--change-address` `>` profile `btc.changeAddress` (no env var).
- Session TTL: `--ttl` `>` `BTCR2_KEYSTORE_TTL` `>` 1 hour (24-hour cap on all sources).

## Setting up your configuration

The CLI works with zero configuration on public networks: endpoints default to public
per-network services, and the DID itself fixes the network for `resolve`/`update`/`deactivate`.
Configuration exists to pick your default network, wire custom endpoints, and manage the keystore
that holds your signing keys. Full detail lives in [config.md](./config.md), [init.md](./init.md),
[quickstart.md](./quickstart.md), and [keystore.md](./keystore.md); the practical path follows.

### First-time setup

Two entry points scaffold the same home (`~/.btcr2` by default):

```sh
# One-command onboarding: home + config + encrypted keystore (prompts twice for
# a passphrase), records mutinynet as the default network, probes endpoints,
# and caches the passphrase for two hours so later commands do not re-prompt.
btcr2 quickstart -n mutinynet --unlock --ttl 2h

# Or the scaffold step alone, without the session cache and endpoint probe.
btcr2 init -n mutinynet
```

Both are idempotent: re-running never touches an existing keystore. Then generate a signing key
and mint a DID:

```sh
btcr2 key generate --name demo --set-active
btcr2 create -n mutinynet
```

### Reading and editing configuration

`btcr2 config` edits individual keys by dotted path and shows what a live command would actually
use:

```sh
btcr2 config path                                          # where is my state?
btcr2 config get                                           # stored file, secrets redacted
btcr2 config set defaults.network mutinynet                # default for -n-less commands
btcr2 config set profiles.mutinynet.btc.feeRate 2          # per-profile knobs
btcr2 config validate                                      # schema check, exit 1 on findings
btcr2 config effective -n mutinynet                        # merged values with provenance
btcr2 config doctor -n mutinynet                           # endpoint reachability probe
```

### Profiles and per-network presets

The scaffolded config contains one empty profile per supported network (`bitcoin`, `testnet3`,
`testnet4`, `signet`, `mutinynet`, `regtest`). A profile named after a network is auto-selected
for operations on that network, so per-network settings need no activation step. Empty profiles
cost nothing: built-in per-network presets (REST endpoints, faucet and explorer hints) already
cover the public networks. A custom-named profile pins its network explicitly:

```sh
btcr2 profile add production
btcr2 config set profiles.production.network mutinynet
btcr2 config set profiles.production.btc.rest 'https://mutinynet.com/api'
btcr2 profile use production                               # writes defaults.profile
```

See [profile.md](./profile.md) for semantics and [config.md](./config.md) for every profile key.

### Keystore and unlock sessions

Signing commands read keys from the encrypted keystore at `<home>/keystore.json` (established by
`init`/`quickstart`, or directly with `btcr2 keystore init`; `--dev` writes a plaintext keystore
for throwaway testnet material, refused for mainnet). To avoid a passphrase prompt on every
signing command, cache a session:

```sh
btcr2 keystore status                                      # path, protection, key count, session
btcr2 keystore unlock --ttl 2h                             # cache the passphrase (max 24h)
btcr2 keystore lock                                        # revoke the session when done
```

For unattended use, supply the passphrase via `BTCR2_KEYSTORE_PASSPHRASE` or `--passphrase-file`
instead. See [keystore.md](./keystore.md) for the session and mainnet-gating rules.

### Sandboxing

Point `BTCR2_HOME` (or `--home`) at a scratch directory to experiment without touching your real
`~/.btcr2`:

```sh
BTCR2_HOME=/tmp/btcr2-sandbox btcr2 quickstart --dev --no-doctor
```
