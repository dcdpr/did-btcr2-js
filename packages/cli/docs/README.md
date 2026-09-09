# btcr2 CLI documentation

Reference documentation for `btcr2`, the command-line tool of the `did:btcr2` method. This page lists the commands, the global flags, the environment variables, and the precedence of each value. One page per command follows the links in the table.

The text matches `@did-btcr2/cli` v0.23.0.

## Commands

| Command | Purpose |
|---------|---------|
| [`init`](./init.md) | Set up the home: create the directory, a default config file, and the keystore. |
| [`quickstart`](./quickstart.md) | Set up the home in one command. Record the network. Cache the session and probe the endpoints (optional). |
| [`create`](./create.md) | Create an identifier and its initial DID document (offline). |
| [`resolve`](./resolve.md) | Resolve the DID document of an identifier (alias: `read`). |
| [`update`](./update.md) | Update a DID document: sign a JSON Patch and broadcast a beacon signal. |
| [`deactivate`](./deactivate.md) | Deactivate an identifier (alias: `delete`). This is permanent. |
| [`identifier`](./identifier.md) | Decode and validate identifiers offline. `decode` prints the components. `validate` prints a conformance report. |
| [`genesis`](./genesis.md) | Build the genesis document of an external identifier offline. `build` asks for the keys, the beacons, and the services, or reads `--spec`. It writes the file and prints the identifier. |
| [`key`](./key.md) | Manage the keys in the keystore. |
| [`keystore`](./keystore.md) | Create, inspect, re-key, and unlock the keystore. |
| [`config`](./config.md) | Read and write the CLI config. |
| [`profile`](./profile.md) | Manage the config profiles. |
| [`completion`](./completion.md) | Print a shell completion script (bash, zsh, or fish). |
| [DEMO.md](./DEMO.md) | Walkthrough: create, fund, resolve, update, and deactivate an identifier on mutinynet. |

## Global flags

A global flag goes before the command word. Every command accepts every global flag. Each command page lists the global flags that the command uses. The table matches `btcr2 --help` (v0.23.0) and the flag declarations in `src/cli.ts`.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-v, --version` | none | n/a | Print `btcr2 <version>` and exit. |
| `-o, --output <format>` | `json` \| `text` | the flag, else `BTCR2_OUTPUT`, else config `defaults.output`, else `text` | The output format. `text` prints the data payload only: an object as pretty JSON, a string as the bare string. `json` prints the full envelope `{ "action": ..., "data": ... }`. The `--help` text omits the `BTCR2_OUTPUT` layer. The source reads the variable between the flag and the config default. |
| `--verbose` | boolean | `false` | Print the full error object and the stack on a failure, not only the message. |
| `--quiet` | boolean | `false` | Do not print hints and warnings on stderr. The flag never changes the stdout payload. |
| `--home <dir>` | directory path | `$BTCR2_HOME`, else `~/.btcr2` on Linux and macOS. On Windows: `%LOCALAPPDATA%\btcr2`, else `%APPDATA%\btcr2`, else the user profile. | The home directory that holds `config.json`, `keystore.json`, and `session.json`. A blank value at one layer defers to the next layer. |
| `-c, --config <path>` | file path | `<home>/config.json` | The config file to read and write. The flag names one file. It does not move the home. |
| `--profile <name>` | profile name | config `defaults.profile`, else the profile with the name of the network of the operation | The active profile (see [profile.md](./profile.md)). |
| `--btc-rest <url>` | URL | the SDK default of the network (mempool.space endpoints, listed in [resolve.md](./resolve.md#environment-and-configuration)) | The Bitcoin REST (Esplora) endpoint. |
| `--btc-rpc-url <url>` | URL | `http://localhost:18443` on regtest, none on the other networks | The Bitcoin Core RPC endpoint. |
| `--btc-rpc-user <user>` | string | none | The Bitcoin Core RPC username. |
| `--cas-gateway <url>` | URL | `https://ipfs.io` | The IPFS HTTP gateway for CAS reads (read-only). |
| `--cas-rpc-url <url>` | URL | none | The IPFS HTTP RPC endpoint of a writable CAS (reads and writes). `--publish-to-cas auto` and `always` on `update` and `deactivate` need it. |
| `--btc-timeout <ms>` | finite number, 1 or more | none (no limit) | The Bitcoin REST and RPC request timeout in milliseconds. |
| `--cas-timeout <ms>` | finite number, 0 or more. `0` disables the timeout. | none. The api then applies 30000 ms. | The CAS request timeout in milliseconds. |
| `--btc-rest-header <header>` | `'Key: Value'`, repeatable | `[]` | An extra Bitcoin REST header. The flag merges over the profile's `btc.headers`, and the flag wins per key. The CLI refuses a value without a `Key: Value` colon. A header on argv is visible to every local user through `ps`, and it stays in the shell history and the CI logs. Put a credential header (an API key, a bearer token) in the profile's `btc.headers`. `profile show` redacts it there. |
| `--btc-rpc-wallet <name>` | string | none | The Bitcoin Core wallet name for wallet-scoped RPCs. |
| `--btc-rpc-header <header>` | `'Key: Value'`, repeatable | `[]` | An extra Bitcoin Core RPC header. The flag merges over the profile's `btc.rpcHeaders`. The argv exposure of `--btc-rest-header` applies. Keep a credential header in the profile. |
| `--btc-signal-discovery <mode>` | `indexer` \| `fullnode` | `indexer` | The source of the beacon signals. `fullnode` scans blocks over Bitcoin Core RPC instead of the Esplora indexer. It fails at connection setup on a network with no RPC client. Only regtest has a default RPC host. |
| `--keystore <path>` | file path | the active profile's `identity.keystore`, else `<home>/keystore.json` | The path of the keystore file. The flag applies before any config read. |
| `--passphrase-file <path>` | file path | none | Read the keystore passphrase from a file (unattended use). The CLI reads `BTCR2_KEYSTORE_PASSPHRASE` before this file. |
| `--signing-key <ref>` | a key URN (`urn:kms:secp256k1:<32 hex>`), a unique `name` tag, or a unique fingerprint prefix | the active profile's `identity.default`, else the active key of the keystore | The key that signs in `update` and `deactivate`. In `create`, the flag selects a stored key as the source of the identifier. |
| `-h, --help` | none | n/a | Print the help of the command. |

### Per-command flags

These flags are not global. The command page documents them:

- `--publish-to-cas <auto|always|never>`, `--fee-rate <satsPerVByte>`, and `--change-address <address>` on [`update`](./update.md) and [`deactivate`](./deactivate.md).
- `-r, --resolution-options <json>`, `--resolution-options-path <path>`, `--min-conf <n>`, and `--genesis-document <path>` on [`resolve`](./resolve.md), [`update`](./update.md), and [`deactivate`](./deactivate.md). `resolve` also has the short form `-p` for the path.
- `-n, --network <network>` on [`create`](./create.md), [`genesis build`](./genesis.md), [`init`](./init.md), [`quickstart`](./quickstart.md), and on `config effective` and `config doctor` ([config.md](./config.md)). A command that takes an identifier or a DID document reads the network from it.
- `--ttl <duration>` and `--allow-mainnet` on `keystore unlock` ([keystore.md](./keystore.md)) and [`quickstart`](./quickstart.md).
- `--initial-document` and `--genesis-document <path>` on [`identifier decode`](./identifier.md). `-b, --bytes <hex>` and `--genesis-document <path>` on [`identifier validate`](./identifier.md).
- `--spec <path>`, `--out <path>`, and `--force` on [`genesis build`](./genesis.md). `--document <path>` on [`create`](./create.md).

### Environment variables

The CLI reads these `BTCR2_*` variables. The sources are `src/config.ts`, `src/paths.ts`, `src/keystore/passphrase.ts`, and `src/keystore/session.ts`.

| Variable | Flag or role |
|----------|--------------|
| `BTCR2_HOME` | The home directory if `--home` is absent. The CLI ignores a blank value. |
| `BTCR2_OUTPUT` | The output format (`json` or `text`) if `-o/--output` is absent. |
| `BTCR2_BTC_REST` | `--btc-rest` |
| `BTCR2_BTC_RPC_URL` | `--btc-rpc-url` |
| `BTCR2_BTC_RPC_USER` | `--btc-rpc-user` |
| `BTCR2_BTC_RPC_PASS` | The Bitcoin Core RPC password. The value can be a secret reference: `env:<VAR>` or `file:<path>`. There is no flag. A password on argv is visible through `ps` and `/proc/<pid>/cmdline`, and it stays in the shell history and the CI logs. The RPC URL, user, and password resolve as one unit per precedence layer (ADR 074). A URL from a flag takes its password from `BTCR2_BTC_RPC_PASS_FILE`, not from this variable. |
| `BTCR2_BTC_RPC_PASS_FILE` | The path of a file that holds the RPC password. There is no flag. This is the last fallback if no layer supplies a password. The CLI reads the file only if it builds an RPC config. |
| `BTCR2_CAS_GATEWAY` | `--cas-gateway` |
| `BTCR2_CAS_RPC_URL` | `--cas-rpc-url` |
| `BTCR2_BTC_SIGNAL_DISCOVERY` | `--btc-signal-discovery` |
| `BTCR2_BTC_TIMEOUT` | `--btc-timeout` |
| `BTCR2_CAS_TIMEOUT` | `--cas-timeout` |
| `BTCR2_FEE_RATE` | `--fee-rate` (a flag of `update` and `deactivate`) |
| `BTCR2_KEYSTORE_PASSPHRASE` | The keystore passphrase for unattended use. The CLI reads it before `--passphrase-file`. There is no flag. The CLI trims one trailing newline. |
| `BTCR2_KEYSTORE_TTL` | The default session TTL below the `--ttl` flag (`keystore unlock`, `quickstart --unlock`). Same value format as `--ttl`. |

There is no environment variable for the network, the change address, the keystore path, or the signing key.

### Precedence

The short rule is: flag, then environment variable, then the active profile, then config `defaults.*`, then the built-in default. The source applies the rule per value. The five-layer chain exists only for a value with a `defaults.*` key. `defaults.*` holds `profile`, `network`, and `output` only.

- Connection values (endpoints, credentials, timeouts, headers): flag, then environment variable, then the active profile in the config file, then the SDK default of the network. There is no `defaults.*` layer for a connection value. A blank value at one layer defers to the next layer.
- Output format: `-o/--output`, then `BTCR2_OUTPUT`, then config `defaults.output`, then `text`.
- Network, for a command that does not take an identifier: `-n`, then config `defaults.network`, then the network of the active profile, then a built-in fallback. The network of a profile is its `network` field, else its name if the name is a network. The fallback is `regtest`. `quickstart` alone falls back to `mutinynet`. The `defaults.network` layer sits above the profile layer here, and there is no environment variable. A command that takes an identifier or a DID document reads the network from it.
- RPC endpoint: the URL, the user, and the password come together from the highest layer that supplies a URL. If no layer supplies a URL, they come from the highest layer that supplies a credential. A host from one layer never gets the credentials of another layer. `BTCR2_BTC_RPC_PASS_FILE` is the password fallback below all layers.
- Home directory: `--home`, then `BTCR2_HOME`, then the platform default. The CLI never reads the home from the config file, because the config file is inside the home.
- Keystore path: `--keystore`, then the active profile's `identity.keystore`, then `<home>/keystore.json`.
- Signing key: `--signing-key`, then the active profile's `identity.default`, then the active key of the keystore.
- Keystore passphrase: `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then a live session in `<home>/session.json`, then the interactive prompt. This is the one value where the environment variable outranks a flag.
- Fee rate: `--fee-rate`, then `BTCR2_FEE_RATE`, then profile `btc.feeRate`, then the SDK default (5 sat/vB). Change address: `--change-address`, then profile `btc.changeAddress`. There is no environment variable.
- Session TTL: `--ttl`, then `BTCR2_KEYSTORE_TTL`, then 1 hour. The cap is 24 hours for every source.

## Set up the configuration

The CLI works with no config on the public networks. The endpoints default to public services per network. The identifier fixes the network for `resolve`, `update`, and `deactivate`. Use the config to set the default network, to point the CLI at custom endpoints, and to manage the keystore. [config.md](./config.md), [init.md](./init.md), [quickstart.md](./quickstart.md), and [keystore.md](./keystore.md) have the full detail. The usual path follows.

### First setup

Two commands create the same home (`~/.btcr2` by default):

```sh
# One command: the home, the config file, and an encrypted keystore.
# The command asks for a passphrase twice, records mutinynet as the
# default network, probes the endpoints, and caches the passphrase for
# two hours.
btcr2 quickstart -n mutinynet --unlock --ttl 2h

# Or the scaffold alone, without the session and the endpoint probe.
btcr2 init -n mutinynet
```

Both commands are idempotent. A second run never touches an existing keystore. Then create an identifier:

```sh
# Generate a key, store it as the active key, and print the identifier.
btcr2 create -n mutinynet
```

### Read and edit the config

`btcr2 config` edits one key at a dotted path and shows the values that a live command uses:

```sh
btcr2 config path                                          # the home, config, and keystore paths
btcr2 config get                                           # the stored file, secrets redacted
btcr2 config set defaults.network mutinynet                # the default for a command with no -n
btcr2 config set profiles.mutinynet.btc.feeRate 2          # a profile value
btcr2 config validate                                      # schema check, exit code 1 on a finding
btcr2 config effective -n mutinynet                        # the merged values with their source
btcr2 config doctor -n mutinynet                           # endpoint reachability probe
```

### Profiles and network presets

The scaffold contains one empty profile per network (`bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`). The CLI selects the profile with the network name for an operation on that network. A per-network setting needs no activation step. An empty profile costs nothing: the built-in presets (REST endpoints, faucet and explorer links) cover the public networks. A profile with a custom name declares its network:

```sh
btcr2 profile add production
btcr2 config set profiles.production.network mutinynet
btcr2 config set profiles.production.btc.rest 'https://mutinynet.com/api'
btcr2 profile use production                               # writes defaults.profile
```

See [profile.md](./profile.md) for the profile rules and [config.md](./config.md) for every profile key.

### Keystore and sessions

The signing commands read the keys from the encrypted keystore at `<home>/keystore.json`. `init`, `quickstart`, or `btcr2 keystore init` creates it. `--dev` writes an unencrypted dev keystore for throwaway test-network keys. The CLI refuses a dev keystore on mainnet. Cache a session so that the signing commands do not ask for the passphrase each time:

```sh
btcr2 keystore status                                      # path, protection, key count, session
btcr2 keystore unlock --ttl 2h                             # cache the passphrase (maximum 24h)
btcr2 keystore lock                                        # revoke the session
```

For unattended use, supply the passphrase with `BTCR2_KEYSTORE_PASSPHRASE` or `--passphrase-file`. See [keystore.md](./keystore.md) for the session rules and the mainnet gate.

### Sandbox

Point `BTCR2_HOME` (or `--home`) at a scratch directory. Then the CLI does not touch `~/.btcr2`:

```sh
BTCR2_HOME=/tmp/btcr2-sandbox btcr2 quickstart --dev --no-doctor
```
