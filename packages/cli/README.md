# @did-btcr2/cli

Command-line interface for the [did:btcr2](https://dcdpr.github.io/did-btcr2/) DID method.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package provides the `btcr2` CLI for creating, resolving, updating, and deactivating did:btcr2 decentralized identifiers. It wraps the `@did-btcr2/api` SDK via dependency injection, using [commander.js](https://github.com/tj/commander.js/) for argument parsing.

Out of the box, `btcr2 resolve` works with zero configuration. The Bitcoin network is derived from the DID itself, and public endpoints (mempool.space, ipfs.io) are used as defaults. Override endpoints via CLI flags, environment variables, or a config file.

> **Note:** `update` and `deactivate` are parsed and validated but will exit with an error. CLI signing is not yet implemented; use `@did-btcr2/api` with a `Signer` directly until this is wired up.

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

| Command | Alias | Status | Description |
|---|---|---|---|
| `create` | - | Working | Create an identifier and initial DID document |
| `resolve` | `read` | Working | Resolve a DID document |
| `update` | - | Not implemented | Update a DID document (CLI signing pending) |
| `deactivate` | `delete` | Not implemented | Deactivate a DID permanently (CLI signing pending) |

### create

Required flags: `-t/--type`, `-n/--network`, `-b/--bytes`.

| Flag | Description |
|---|---|
| `-t, --type <type>` | Identifier type: `k` (deterministic, 33-byte compressed pubkey) or `x` (external, 32-byte SHA-256 hash) |
| `-n, --network <network>` | Bitcoin network: `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, or `regtest` |
| `-b, --bytes <bytes>` | Genesis bytes as a hex string |

### resolve (alias: read)

Required flag: `-i/--identifier`. At most one of `-r` or `-p` may be given.

| Flag | Description |
|---|---|
| `-i, --identifier <identifier>` | did:btcr2 identifier to resolve (required) |
| `-r, --resolution-options <json>` | Resolution options as an inline JSON string |
| `-p, --resolution-options-path <path>` | Path to a JSON file containing resolution options |

### update (not yet implemented)

Parses and validates flags, then exits with `NOT_IMPLEMENTED_ERROR`. Use `@did-btcr2/api` with a `Signer` directly.

Required flags: `-s/--source-document`, `--source-version-id`, `-p/--patches`, `-m/--verification-method-id`, `-b/--beacon-id`.

### deactivate (alias: delete, not yet implemented)

Parses and validates flags, then exits with `NOT_IMPLEMENTED_ERROR`. Use `@did-btcr2/api` with a `Signer` directly.

Required flags: `-s/--source-document`, `--source-version-id`, `-m/--verification-method-id`, `-b/--beacon-id`.

## Usage

### Create a DID

```bash
# Deterministic (type=k): from a compressed secp256k1 public key (33 bytes hex)
btcr2 create -t k -n regtest -b 02aa...

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

### Update a DID (not yet implemented)

The command is registered and flags are validated, but it will always exit with an error:

```
CLI signing is not yet implemented. Use @did-btcr2/api with a Signer directly.
```

### Deactivate a DID (not yet implemented)

Same as `update` - flags are parsed but the command exits with `NOT_IMPLEMENTED_ERROR`.

## Configuration

Override precedence, highest wins: CLI flags, then environment variables, then config file, then network defaults.

### Global flags

| Flag | Description |
|---|---|
| `-v, --version` | Output the current version |
| `-o, --output <format>` | Output format: `json` or `text` (default: `text`) |
| `--verbose` | Verbose output |
| `--quiet` | Suppress non-essential output |
| `-c, --config <path>` | Path to config file (default: `$XDG_CONFIG_HOME/btcr2/config.json`) |
| `--profile <name>` | Config profile name (default: auto-detected from network) |
| `--btc-rest <url>` | Override Bitcoin REST endpoint (Esplora API) |
| `--btc-rpc-url <url>` | Override Bitcoin Core RPC endpoint |
| `--btc-rpc-user <user>` | Bitcoin Core RPC username |
| `--btc-rpc-pass <pass>` | Bitcoin Core RPC password |
| `--cas-gateway <url>` | IPFS HTTP gateway for CAS reads |

### Environment variables

| Variable | Equivalent flag |
|---|---|
| `BTCR2_BTC_REST` | `--btc-rest` |
| `BTCR2_BTC_RPC_URL` | `--btc-rpc-url` |
| `BTCR2_BTC_RPC_USER` | `--btc-rpc-user` |
| `BTCR2_BTC_RPC_PASS` | `--btc-rpc-pass` |
| `BTCR2_CAS_GATEWAY` | `--cas-gateway` |

### Config file

Default location: `$XDG_CONFIG_HOME/btcr2/config.json` (falls back to `~/.config/btcr2/config.json`).

Profiles are matched by network name when `--profile` is not specified. For example, resolving a regtest DID automatically selects the `"regtest"` profile.

```json
{
  "profiles": {
    "regtest": {
      "btc": {
        "rest": "http://localhost:3000",
        "rpcUrl": "http://localhost:18443",
        "rpcUser": "polaruser",
        "rpcPass": "polarpass"
      }
    },
    "bitcoin": {
      "btc": { "rest": "https://my-mempool/api" },
      "cas": { "gateway": "https://ipfs.io" }
    }
  }
}
```

### Defaults

When no overrides are configured:

- **Bitcoin REST**: [mempool.space](https://mempool.space) for `bitcoin`, `testnet3`, `testnet4`, and `signet`; [mutinynet.com](https://mutinynet.com) for `mutinynet`; `http://localhost:3000` for `regtest`
- **Bitcoin RPC**: `http://localhost:18443` for `regtest` (credentials required), not configured for public networks
- **CAS**: [ipfs.io](https://ipfs.io) HTTP gateway (read-only)

## Links

- [did:btcr2 specification](https://dcdpr.github.io/did-btcr2/)
- [did-btcr2-js monorepo](https://github.com/dcdpr/did-btcr2-js)
- [npm: @did-btcr2/cli](https://www.npmjs.com/package/@did-btcr2/cli)
- [Implementation docs](https://btcr2.dev/impls/ts)

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
