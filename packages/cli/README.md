# @did-btcr2/cli

Command-line interface for the [did:btcr2](https://dcdpr.github.io/did-btcr2/) DID method.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package provides the `btcr2` CLI for creating, resolving, updating, and deactivating did:btcr2 decentralized identifiers. It also manages an encrypted keystore of keypairs, reads and writes CLI configuration and profiles, and prints shell completion scripts. It wraps the `@did-btcr2/api` SDK via dependency injection, using [commander.js](https://github.com/tj/commander.js/) for argument parsing.

Out of the box, `btcr2 resolve` works with zero configuration. The Bitcoin network is derived from the DID itself, and public endpoints (mempool.space, ipfs.io) are used as defaults. Override endpoints via CLI flags, environment variables, or a config file.

Signing operations (`update`, `deactivate`, and generated `create` keys) read secret keys from an encrypted on-disk keystore. Choose a key with `--signing-key <ref>` or set an active key with `btcr2 key use <ref>`.

## Install

```bash
npm install -g @did-btcr2/cli
```

Or with pnpm:

```bash
pnpm add -g @did-btcr2/cli
```

Requires Node.js >= 22.

Without installing globally, run directly via npx:

```bash
npx @did-btcr2/cli resolve -i did:btcr2:k1qq...
```

## Commands

| Command | Alias | Description |
|---|---|---|
| `create` | - | Create an identifier and initial DID document |
| `resolve` | `read` | Resolve a DID document |
| `update` | - | Update a DID document (signs via the keystore) |
| `deactivate` | `delete` | Deactivate a DID permanently (signs via the keystore) |
| `key` | - | Manage keypairs in the encrypted keystore |
| `config` | - | Read and write CLI configuration |
| `profile` | - | Manage configuration profiles |
| `completion` | - | Print a shell completion script |

### create

Creates an identifier and initial DID document. Two identifier types, selected by `-t/--type`:

- **`k`** (deterministic): a 33-byte compressed secp256k1 public key. Three mutually-exclusive input modes:
  - **generate** (neither `--bytes` nor `--signing-key`): mint a fresh key, persist it to the keystore, set it active, and print the identifier. Sealing the secret prompts for the keystore passphrase.
  - **existing** (`--signing-key <ref>`): use a stored key's public key as the genesis bytes. Reading a public key never decrypts, so this never prompts.
  - **raw** (`--bytes <hex>`): a 33-byte public key as hex. Offline and keystore-free.
- **`x`** (external): raw-bytes only, the 32-byte SHA-256 hash of a genesis document via `--bytes`.

| Flag | Description |
|---|---|
| `-t, --type <type>` | Identifier type: `k` (deterministic) or `x` (external). Default: `k` |
| `-n, --network <network>` | Bitcoin network: `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, or `regtest`. Default: config `defaults.network`, else the active profile's network, else `regtest` |
| `-b, --bytes <bytes>` | Genesis bytes as a hex string. For type=k, a 33-byte public key (omit to generate a key); for type=x, the 32-byte genesis-document hash |

`--signing-key <ref>` (global) selects a stored key for the existing-key mode; it applies only to `-t k`.

### resolve (alias: read)

Required flag: `-i/--identifier`. At most one of `-r` or `-p` may be given.

| Flag | Description |
|---|---|
| `-i, --identifier <identifier>` | did:btcr2 identifier to resolve (required) |
| `-r, --resolution-options <json>` | Resolution options as an inline JSON string |
| `-p, --resolution-options-path <path>` | Path to a JSON file containing resolution options |

### update

Signs and broadcasts an update to a DID document. The signing key comes from the encrypted keystore (choose one with `--signing-key <ref>` or set an active key with `btcr2 key use`).

Required flags: `-s/--source-document`, `--source-version-id`, `-p/--patches`, `-m/--verification-method-id`, `-b/--beacon-id`.

| Flag | Description |
|---|---|
| `-s, --source-document <json>` | Source DID document as a JSON string |
| `--source-version-id <number>` | Source version ID as a non-negative integer |
| `-p, --patches <json>` | JSON Patch operations as a JSON array string |
| `-m, --verification-method-id <id>` | DID document verification method ID |
| `-b, --beacon-id <json>` | Beacon ID as a JSON string |
| `--publish-to-cas <mode>` | Publish update artifacts to a writable CAS before broadcast: `auto`, `always`, or `never` (default: `never`). See [Publishing updates to CAS](#publishing-updates-to-cas) |
| `--fee-rate <satsPerVByte>` | Fee rate in sats/vByte for the beacon transaction (default: `5`). Raise it under congestion so the transaction confirms (also `BTCR2_FEE_RATE`, profile `btc.feeRate`) |
| `--change-address <address>` | Send transaction change to this address instead of the beacon address, so a DID's announcements are not linked on-chain (profile `btc.changeAddress`) |

### deactivate (alias: delete)

Permanently deactivates a DID. This is irreversible. Deactivation applies the `{ "op": "add", "path": "/deactivated", "value": true }` patch and routes through the same signed-update path as `update`, so it also signs via the keystore.

Required flags: `-s/--source-document`, `--source-version-id`, `-m/--verification-method-id`, `-b/--beacon-id`. Optional: `--publish-to-cas <mode>`, `--fee-rate <satsPerVByte>`, `--change-address <address>` (same as `update`).

### key

Manage keypairs in the encrypted keystore. All subcommands operate offline (no Bitcoin connection).

| Subcommand | Alias | Description |
|---|---|---|
| `key generate` | - | Generate a new keypair and store it. Flags: `--name <name>`, `--set-active` |
| `key list` | `ls` | List stored keys (id, fingerprint, name, active) |
| `key show <ref>` | - | Show a key's public material and tags (never prints the secret) |
| `key import` | - | Import a secret from a hex file (`--secret-file`) or a public key as watch-only (`--public`). Flags: `--name`, `--set-active` |
| `key export <ref>` | - | Export public material by default; `--secret --out <path>` writes the secret to a new 0600 file |
| `key delete <ref>` | `rm` | Delete a key. `--force` deletes even the active key |
| `key use <ref>` | - | Set the active key, persisted across invocations |

A key reference is a full URN, a unique `name` tag, or a unique fingerprint prefix.

### config

Read and write CLI configuration.

| Subcommand | Alias | Description |
|---|---|---|
| `config init` | - | Create a default config file with one profile per network. `--force` overwrites |
| `config get [path]` | - | Print a value at a dotted path, or the whole config. Secret values are redacted; `--show-secrets` reveals them |
| `config set <path> <value>` | - | Set a value at a dotted path (value parsed as JSON when valid, else a string). An invalid enum for a known key is rejected; an unknown path warns but writes |
| `config unset <path>` | - | Delete a value at a dotted path |
| `config list` | `ls` | Print the entire config file. Secret values are redacted; `--show-secrets` reveals them |
| `config validate` | - | Report unknown keys, invalid enum values, and an unsupported schema version |
| `config effective` | - | Print the resolved connection config with per-value provenance (`flag`/`env`/`file`/`default`). `-n, --network <n>` selects the network; `--show-secrets` reveals the RPC password |
| `config path` | - | Print the resolved config-file and keystore paths |
| `config doctor` | - | Probe reachability of the resolved endpoints (read-only; touches the network). `-n, --network <n>` selects the network |

### profile

Manage configuration profiles.

| Subcommand | Alias | Description |
|---|---|---|
| `profile add <name>` | - | Add an empty profile |
| `profile use <name>` | - | Set the active profile (writes `defaults.profile`) |
| `profile show [name]` | - | Show a profile (defaults to the active profile) |
| `profile remove <name>` | `rm` | Remove a profile |

### completion

`btcr2 completion [shell]` prints a shell completion script (bash, zsh, or fish) to stdout. Defaults to bash. For example: `eval "$(btcr2 completion bash)"`.

## Usage

### Create a DID

```bash
# Generate a fresh key (type=k), store it in the keystore, and print the identifier
btcr2 create -n regtest

# Deterministic (type=k): from an explicit compressed secp256k1 public key (33 bytes hex)
btcr2 create -t k -n regtest -b 02aa...

# Deterministic (type=k): from a stored key's public key
btcr2 create -t k -n regtest --signing-key mykey

# External (type=x): from a SHA-256 hash of a genesis document (32 bytes hex)
btcr2 create -t x -n bitcoin -b bb...
```

### Resolve a DID

```bash
# Zero-config: network and endpoints are derived from the DID
btcr2 resolve -i did:btcr2:k1qq...

# Alias: read
btcr2 read -i did:btcr2:k1qq...

# With resolution options as inline JSON
btcr2 resolve -i did:btcr2:k1qq... -r '{"versionId":"1"}'

# With resolution options from a JSON file
btcr2 resolve -i did:btcr2:k1qq... -p resolution-options.json

# JSON output
btcr2 -o json resolve -i did:btcr2:k1qq...
```

### Update a DID

```bash
# Signs with the active keystore key (or one chosen via --signing-key)
btcr2 update \
  -s "$(cat did.json)" \
  --source-version-id 1 \
  -p '[{"op":"add","path":"/service/-","value":{"id":"#svc","type":"X","serviceEndpoint":"https://x"}}]' \
  -m 'did:btcr2:k1qq...#key-0' \
  -b '{"id":"#beacon-0","type":"SingletonBeacon","serviceEndpoint":"bitcoin:bc1..."}'
```

### Deactivate a DID

```bash
# Irreversible. Applies the deactivation patch and signs via the keystore.
btcr2 deactivate \
  -s "$(cat did.json)" \
  --source-version-id 1 \
  -m 'did:btcr2:k1qq...#key-0' \
  -b '{"id":"#beacon-0","type":"SingletonBeacon","serviceEndpoint":"bitcoin:bc1..."}'
```

### Manage keys

```bash
btcr2 key generate --name mykey --set-active
btcr2 key list
btcr2 key use mykey
```

## Configuration

Override precedence, highest wins: CLI flags, then environment variables, then config file, then network defaults.

### Global flags

| Flag | Description |
|---|---|
| `-v, --version` | Output the current version |
| `-o, --output <format>` | Output format: `json` or `text` (default: config `defaults.output`, else `text`) |
| `--verbose` | Verbose output |
| `--quiet` | Suppress non-essential output |
| `-c, --config <path>` | Path to config file (default: `$XDG_CONFIG_HOME/btcr2/config.json`) |
| `--profile <name>` | Config profile name (default: auto-detected from network) |
| `--btc-rest <url>` | Override Bitcoin REST endpoint (Esplora API) |
| `--btc-rpc-url <url>` | Override Bitcoin Core RPC endpoint |
| `--btc-rpc-user <user>` | Bitcoin Core RPC username |
| `--btc-rpc-pass <pass>` | Bitcoin Core RPC password (accepts an `env:<VAR>` or `file:<path>` secret reference) |
| `--btc-rpc-wallet <name>` | Bitcoin Core wallet name for wallet-scoped RPCs (`/wallet/<name>`) |
| `--btc-rpc-header <header>` | Extra Bitcoin Core RPC header `"Key: Value"` (repeatable) |
| `--btc-rest-header <header>` | Extra Bitcoin REST header `"Key: Value"` (repeatable), e.g. an API key |
| `--btc-timeout <ms>` | Bitcoin REST/RPC request timeout in milliseconds (default: unbounded) |
| `--cas-gateway <url>` | IPFS HTTP gateway for CAS reads (read-only) |
| `--cas-rpc-url <url>` | IPFS HTTP RPC endpoint for a writable CAS (reads + writes; enables `--publish-to-cas`) |
| `--cas-timeout <ms>` | CAS request timeout in milliseconds (default: `30000`; `0` disables) |
| `--keystore <path>` | Path to the keystore file (default: `$XDG_DATA_HOME/btcr2/keystore.json`) |
| `--passphrase-file <path>` | Read the keystore passphrase from a file (unattended use) |
| `--signing-key <ref>` | Key for create/update/deactivate signing: a URN, fingerprint prefix, or name |

### Environment variables

| Variable | Equivalent flag |
|---|---|
| `BTCR2_BTC_REST` | `--btc-rest` |
| `BTCR2_BTC_RPC_URL` | `--btc-rpc-url` |
| `BTCR2_BTC_RPC_USER` | `--btc-rpc-user` |
| `BTCR2_BTC_RPC_PASS` | `--btc-rpc-pass` |
| `BTCR2_BTC_RPC_PASS_FILE` | file whose contents are the RPC password |
| `BTCR2_CAS_GATEWAY` | `--cas-gateway` |
| `BTCR2_CAS_RPC_URL` | `--cas-rpc-url` |
| `BTCR2_BTC_TIMEOUT` | `--btc-timeout` |
| `BTCR2_CAS_TIMEOUT` | `--cas-timeout` |
| `BTCR2_FEE_RATE` | `--fee-rate` |
| `BTCR2_OUTPUT` | `-o, --output` |

### Config file

Default location: `$XDG_CONFIG_HOME/btcr2/config.json` (falls back to `~/.config/btcr2/config.json`). An empty `$XDG_CONFIG_HOME` is treated as unset. A malformed config file fails loudly (the CLI never silently falls back to public endpoints, and never overwrites an unparseable file).

Profiles are matched by network name when `--profile` is not specified. For example, resolving a regtest DID automatically selects the `"regtest"` profile. A profile that is not named after a network can declare its network with a `network` field.

```json
{
  "schemaVersion": 1,
  "defaults": {
    "profile": "production",
    "network": "bitcoin",
    "output": "text"
  },
  "profiles": {
    "regtest": {
      "btc": {
        "rest": "http://localhost:3000",
        "rpcUrl": "http://localhost:18443",
        "rpcUser": "polaruser",
        "rpcPass": "polarpass",
        "wallet": "primary",
        "feeRate": 5,
        "timeoutMs": 30000
      }
    },
    "production": {
      "network": "bitcoin",
      "btc": {
        "rest": "https://my-mempool/api",
        "headers": { "Authorization": "Bearer <api-key>" },
        "feeRate": 20
      },
      "cas": { "gateway": "https://ipfs.io", "rpcUrl": "http://127.0.0.1:5001", "timeoutMs": 30000 },
      "identity": { "keystore": "/secure/prod-keystore.json", "default": "did:btcr2:...#key-0" }
    }
  }
}
```

Field notes:

- **`defaults`**: `profile` selects the active profile; `network` fixes the network `create` encodes when `-n` is absent; `output` sets the default output format. `schemaVersion` is stamped on every write; a file written by a newer CLI is refused.
- **`btc`**: `rest`/`rpcUrl`/`rpcUser`/`rpcPass` are endpoints and credentials; `wallet` targets a Bitcoin Core wallet (`/wallet/<name>`); `headers`/`rpcHeaders` add REST/RPC headers; `feeRate` (sats/vByte), `changeAddress`, and `timeoutMs` set broadcast and request behavior. The RPC url, user, and pass are resolved as one atomic unit, so a URL from a higher-precedence layer never inherits credentials from a lower one.
- **`cas`**: `gateway` is a read-only IPFS HTTP gateway; `cas.rpcUrl` is a writable IPFS HTTP RPC endpoint (enables `--publish-to-cas`; `rpcUrl` wins over `gateway`); `timeoutMs` bounds CAS operations (`0` disables).
- **`identity`**: `keystore` points the profile at its own keystore file, and `default` is the profile's default signing key. Both fall **below** the corresponding `--keystore` / `--signing-key` flags.

Use `config validate` to check a file, and `config effective` to see the resolved values with their provenance.

### RPC password and secrets

`config get` and `config list` redact secret-looking values (RPC password and any `pass`/`secret`/`token` key) by default; pass `--show-secrets` to reveal them.

An `rpcPass` written directly into `config.json` is stored in cleartext (the file is mode 0600 but not encrypted). For anything sensitive, keep the secret out of the file with a reference or an RPC-URL-embedded credential:

- `"rpcPass": "env:MY_RPC_PASS"` reads the password from the `MY_RPC_PASS` environment variable.
- `"rpcPass": "file:/run/secrets/rpc-pass"` reads it from a file (a single trailing newline is trimmed).
- `BTCR2_BTC_RPC_PASS_FILE=/run/secrets/rpc-pass` names a file to read when no other RPC password source applies.

### Defaults

When no overrides are configured:

- **Bitcoin REST**: [mempool.space](https://mempool.space) for `bitcoin`, `testnet3`, `testnet4`, and `signet`; [mutinynet.com](https://mutinynet.com) for `mutinynet`; `http://localhost:3000` for `regtest`
- **Bitcoin RPC**: `http://localhost:18443` for `regtest` (credentials required), not configured for public networks
- **CAS**: [ipfs.io](https://ipfs.io) HTTP gateway (read-only). Configure a writable CAS with `--cas-rpc-url` (or `cas.rpcUrl`) to publish with `--publish-to-cas`

## Publishing updates to CAS

CAS publication is **optional and never required**. Every `update` and `deactivate` can be completed and shared entirely via sidecar: the command always prints the artifacts a resolver needs (the signed update, the transaction id, the CAS announcement for CAS beacons, and the SMT proof for SMT beacons) for you to distribute yourself.

Optionally, the signed update (and, for CAS beacons, the announcement) can be published to a content-addressed store before the on-chain broadcast, so any OP_RETURN update hash is fetchable from CAS at resolution time without sidecar data. This is opt-in via `--publish-to-cas`:

| Mode | Behavior |
|---|---|
| `never` (default) | Publish nothing. Distribute the printed artifacts via sidecar. |
| `auto` | Best-effort. Publish when a writable CAS is configured; otherwise skip publication silently for every beacon type and proceed. Never blocks an update. |
| `always` | Require a writable CAS; error up-front for every beacon type when none is configured. |

A writable CAS is configured with `--cas-rpc-url <url>` (an IPFS HTTP RPC endpoint, e.g. a local Kubo node at `http://127.0.0.1:5001`), the `BTCR2_CAS_RPC_URL` environment variable, or a profile's `cas.rpcUrl`. The default IPFS gateway is read-only, so without a configured `--cas-rpc-url`, `--publish-to-cas auto` publishes nothing and completes the update sidecar-only, while `--publish-to-cas always` errors up-front (naming the fix) for every beacon type.

**Privacy:** under `auto`/`always`, canonical signed updates (and announcements) are published to the configured, possibly public, CAS before the on-chain anchor. Keep `never` (the default) to distribute update data privately via sidecar.

```bash
# Opt into CAS publication against a local IPFS (Kubo) node
btcr2 update \
  --cas-rpc-url http://127.0.0.1:5001 \
  --publish-to-cas auto \
  -s "$(cat did.json)" \
  --source-version-id 1 \
  -p '[{"op":"add","path":"/service/-","value":{"id":"#svc","type":"X","serviceEndpoint":"https://x"}}]' \
  -m 'did:btcr2:k1qq...#key-0' \
  -b '{"id":"#beacon-0","type":"SingletonBeacon","serviceEndpoint":"bitcoin:bc1..."}'
```

## Links

- [did:btcr2 specification](https://dcdpr.github.io/did-btcr2/)
- [did-btcr2-js monorepo](https://github.com/dcdpr/did-btcr2-js)
- [npm: @did-btcr2/cli](https://www.npmjs.com/package/@did-btcr2/cli)
- [Implementation docs](https://btcr2.dev/impls/ts)

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
