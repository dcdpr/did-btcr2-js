# @did-btcr2/cli

Command-line interface for the [did:btcr2](https://dcdpr.github.io/did-btcr2/) DID method.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

This package provides the `btcr2` CLI for creating, resolving, updating, and deactivating did:btcr2 decentralized identifiers. It wraps the `@did-btcr2/api` SDK via dependency injection, using [commander.js](https://github.com/tj/commander.js/) for argument parsing.

Out of the box, `btcr2 resolve` works with zero configuration. The Bitcoin network is derived from the DID itself, and public endpoints (mempool.space, ipfs.io) are used as defaults. Override endpoints via CLI flags, environment variables, or a config file.

## Install

```bash
npm install -g @did-btcr2/cli
```

Or with pnpm:

```bash
pnpm add -g @did-btcr2/cli
```

Requires Node.js >= 22.

## Usage

### Create a DID

```bash
# Deterministic (type=k) — from a compressed secp256k1 public key (33 bytes hex)
btcr2 create -t k -n regtest -b 02aa...

# External (type=x) — from a SHA-256 hash of a genesis document (32 bytes hex)
btcr2 create -t x -n bitcoin -b bb...
```

### Resolve a DID

```bash
# Zero-config — network and endpoints are derived from the DID
btcr2 resolve -i did:btcr2:k1qq...

# With resolution options from a JSON file
btcr2 resolve -i did:btcr2:k1qq... -p resolution-options.json

# JSON output
btcr2 -o json resolve -i did:btcr2:k1qq...
```

### Update a DID

```bash
btcr2 update \
  -s '{"id":"did:btcr2:k1qq...","service":[...]}' \
  --source-version-id 1 \
  -p '[{"op":"add","path":"/service/1","value":{...}}]' \
  -m '#initialKey' \
  -b '#beacon-0'
```

### Deactivate a DID

```bash
btcr2 deactivate \
  -s '{"id":"did:btcr2:k1qq...","service":[...]}' \
  --source-version-id 2 \
  -m '#initialKey' \
  -b '#beacon-0'
```

## Configuration

Override precedence (highest wins): CLI flags > environment variables > config file > network defaults.

### CLI flags

| Flag | Description |
|---|---|
| `-o, --output <format>` | Output format: `json` or `text` (default: `text`) |
| `-c, --config <path>` | Path to config file |
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

- **Bitcoin REST**: [mempool.space](https://mempool.space) for public networks, `localhost:3000` for regtest
- **Bitcoin RPC**: `localhost:18443` for regtest (credentials required), not configured for public networks
- **CAS**: [ipfs.io](https://ipfs.io) HTTP gateway (read-only)

## Links

- [did:btcr2 specification](https://dcdpr.github.io/did-btcr2/)
- [did-btcr2-js monorepo](https://github.com/dcdpr/did-btcr2-js)
- [npm: @did-btcr2/cli](https://www.npmjs.com/package/@did-btcr2/cli)
- [Implementation docs](https://btcr2.dev/impls/ts)
