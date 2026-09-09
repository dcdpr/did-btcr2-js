# @did-btcr2/cli

Command-line interface for the [did:btcr2](https://dcdpr.github.io/did-btcr2/) DID method.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

The `btcr2` command creates, resolves, updates, and deactivates did:btcr2 identifiers. It decodes and validates identifiers offline. It builds the genesis document of an external identifier. It manages the keys in an encrypted keystore. It reads and writes the CLI config and its profiles. It prints shell completion scripts.

The CLI wraps the `@did-btcr2/api` SDK. It parses the arguments with [commander.js](https://github.com/tj/commander.js/).

`btcr2 resolve` works with no config. The identifier names its network, and the CLI uses public endpoints (mempool.space, ipfs.io) by default. A flag, an environment variable, or the config file can override each endpoint.

`update` and `deactivate` read the signing key from the keystore. Select a key with `--signing-key <ref>`, or set the active key with `btcr2 key use <ref>`.

The reference documentation is in [`docs/`](./docs/README.md). It has one page per command, the global flags, the environment variables, and the precedence rules. [`docs/DEMO.md`](./docs/DEMO.md) is a walkthrough of the full lifecycle on mutinynet.

## Install

```bash
npm install -g @did-btcr2/cli
```

Or with pnpm:

```bash
pnpm add -g @did-btcr2/cli
```

The CLI needs Node.js 22 or newer.

To run the CLI without a global install, use npx:

```bash
npx @did-btcr2/cli resolve -i did:btcr2:k1qq...
```

## Commands

| Command | Alias | Description |
|---|---|---|
| [`init`](./docs/init.md) | | Set up the home: create the directory, a default config file, and the keystore. |
| [`quickstart`](./docs/quickstart.md) | | Set up the home in one command, record the network, and (optional) cache the session and probe the endpoints. |
| [`create`](./docs/create.md) | | Create an identifier and its initial DID document (offline). |
| [`resolve`](./docs/resolve.md) | `read` | Resolve the DID document of an identifier. |
| [`update`](./docs/update.md) | | Update a DID document. The keystore signs the update. |
| [`deactivate`](./docs/deactivate.md) | `delete` | Deactivate an identifier. This is permanent. The keystore signs the deactivation. |
| [`identifier`](./docs/identifier.md) | | Decode and validate identifiers (offline). |
| [`genesis`](./docs/genesis.md) | | Build the genesis document of an external identifier (offline). |
| [`key`](./docs/key.md) | | Manage the keys in the keystore. |
| [`keystore`](./docs/keystore.md) | | Create, inspect, re-key, and unlock the keystore. |
| [`config`](./docs/config.md) | | Read and write the CLI config. |
| [`profile`](./docs/profile.md) | | Manage the config profiles. |
| [`completion`](./docs/completion.md) | | Print a shell completion script. |

Each page lists the flags, the output, the environment variables, and examples of the command. `btcr2 <command> --help` prints the flags of a command.

## Usage

```bash
# Set up the home, the config file, and an encrypted keystore on mutinynet.
# Cache the passphrase for two hours.
btcr2 quickstart -n mutinynet --unlock --ttl 2h

# Generate a key, store it as the active key, and create an identifier (offline).
btcr2 create -n mutinynet

# Resolve the DID document from Bitcoin.
btcr2 resolve -i did:btcr2:k1q5p...

# Update the DID document: sign a JSON Patch and broadcast a beacon signal.
btcr2 update -i did:btcr2:k1q5p... \
  -p '[{"op":"add","path":"/alsoKnownAs","value":["https://example.com/demo"]}]'
```

An update needs a funded beacon. On a test network, `create` prints the beacon address and the faucet link. [`docs/DEMO.md`](./docs/DEMO.md) has the full sequence.

## Configuration

The CLI keeps its state in one home directory: `~/.btcr2` on Linux and macOS, `%LOCALAPPDATA%\btcr2` on Windows. The home holds `config.json`, `keystore.json`, and `session.json`. `--home <dir>` or `BTCR2_HOME` moves the home.

A value comes from the first of these sources: a flag, an environment variable, the active profile in the config file, the built-in default of the network. [`docs/config.md`](./docs/config.md) describes the config file and the `config` subcommands. [`docs/README.md`](./docs/README.md) lists the global flags, the environment variables, and the precedence of each value.

## Links

- [did:btcr2 specification](https://dcdpr.github.io/did-btcr2/)
- [did-btcr2-js monorepo](https://github.com/dcdpr/did-btcr2-js)
- [npm: @did-btcr2/cli](https://www.npmjs.com/package/@did-btcr2/cli)
- [Implementation docs](https://btcr2.dev/impls/ts)

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
