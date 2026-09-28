# The config file

The config file holds the defaults of the CLI and the named profiles. A profile holds the endpoints, the transaction settings, and the key settings for one setup, for example one network. The file is optional: with no config file, the CLI uses the built-in default of each value. `btcr2 init`, `btcr2 quickstart`, and `btcr2 config init` write a first config file. `btcr2 config` and `btcr2 profile` read and change it.

This page shows each key of the file, the commands that read the key, and the rules that select a profile. [config.md](./config.md) documents the `config` subcommands, and [profile.md](./profile.md) documents the `profile` subcommands.

## Location

The file is `<home>/config.json`. The home is `--home`, else `BTCR2_HOME`, else `~/.btcr2` (`%LOCALAPPDATA%\btcr2` on Windows). `-c, --config <path>` selects another file. `btcr2 config path` prints the path that the CLI uses.

The CLI writes the file atomically with file mode `0600`, in a directory with mode `0700`. Each write sets `schemaVersion` to `1`.

## A full example

```json
{
  "schemaVersion": 1,
  "defaults": {
    "profile": "mutinynet",
    "output": "text"
  },
  "profiles": {
    "mutinynet": {
      "btc": {
        "rest": "https://esplora.example.com/api",
        "headers": { "X-Api-Key": "abc123" },
        "timeoutMs": 15000,
        "feeRate": 2
      },
      "cas": {
        "gateway": "https://ipfs.example.com",
        "timeoutMs": 30000
      },
      "identity": {
        "default": "demo"
      }
    },
    "regtest": {
      "btc": {
        "rest": "http://127.0.0.1:3000",
        "rpcUrl": "http://127.0.0.1:18443",
        "rpcUser": "polaruser",
        "rpcPass": "file:/home/me/.btcr2/regtest-rpc-pass"
      },
      "cas": {
        "rpcUrl": "http://127.0.0.1:5001"
      }
    },
    "production": {
      "network": "bitcoin",
      "btc": {
        "rest": "https://mainnet.example.com/api"
      },
      "identity": {
        "default": "prod"
      }
    }
  }
}
```

With this file:

- `defaults.profile` selects the `mutinynet` profile for each command. Pass `--profile regtest` to use the local regtest node, or `--profile production` to use mainnet.
- `btcr2 create` makes a mutinynet identifier from the key named `demo`. The name of the `mutinynet` profile gives the network. `btcr2 update` signs with the same key.
- `resolve`, `update`, and `deactivate` read the chain through `https://esplora.example.com/api`, with the `X-Api-Key` header.
- With `--profile regtest`, the RPC password comes from the file `/home/me/.btcr2/regtest-rpc-pass`, and `--publish-to-cas` can write to the local IPFS node.
- `btcr2 --profile production create` makes a `bitcoin` identifier from the key named `prod`.

The `production` profile shows the case where the `network` key matters. `production` is not a network name, so only the `network` key gives the network of the profile. Without the key, `btcr2 --profile production create` makes a `regtest` identifier and prints no warning. The `mutinynet` and `regtest` profiles do not need the key, because the profile name gives the network.

The file does not set `defaults.network`, because `defaults.network` wins over the `network` key of the active profile. With `defaults.network` set to `mutinynet`, `btcr2 --profile production create` makes a mutinynet identifier and prints a warning. `init -n` and `quickstart -n` write `defaults.network`.

## Top-level keys

| Key | Type | Used by | Meaning |
|-----|------|---------|---------|
| `schemaVersion` | number | all commands | The version of the file format. The CLI sets it to `1`. A command refuses a file with a newer version. |
| `defaults.profile` | string | all commands | The active profile if `--profile` is absent. See [The active profile](#the-active-profile). |
| `defaults.network` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | `create`, `genesis build`, `config effective`, `config doctor` | The network of a command that does not take an identifier, if `-n` is absent. `init -n` and `quickstart -n` write it. A command that takes an identifier reads the network from the identifier. |
| `defaults.output` | `text` \| `json` | all commands | The output format, below `-o` and `BTCR2_OUTPUT`. |

## Profiles

`profiles` is an object. Each key is a profile name, and each value is a profile. A profile name can be a network name (`mutinynet`) or another name (`production`). `init` writes one empty profile for each network.

### The active profile

The active profile is the profile that `--profile` names, else the profile that `defaults.profile` names.

The CLI selects a profile in two different ways:

- **Connection values** (`network`, `btc.*`, `cas.*`): the active profile. If there is no active profile, the CLI uses the profile with the name of the network. For example, `btcr2 resolve` of a signet identifier with no `defaults.profile` uses `profiles.signet`.
- **Key settings** (`identity.keystore`, `identity.default`): the active profile only. The CLI does not use the profile with the name of the network for these keys. Set `defaults.profile`, or pass `--profile`, to make them apply.

A value that the profile does not set comes from the next layer. See [Precedence](#precedence).

### network

| Key | Type | Used by | Meaning |
|-----|------|---------|---------|
| `network` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | `create`, `genesis build`, `config doctor` | The network that the endpoints of the profile serve. If `-n` and `defaults.network` are absent, `create` uses this network. `create` and `genesis build` print a warning if the identifier has another network. A profile with a network name and no `network` key has the network of its name. A profile with another name, for example `production`, has no network without the key. |

### btc: the Bitcoin endpoints and transactions

| Key | Type | Used by | Meaning |
|-----|------|---------|---------|
| `btc.rest` | string (URL) | `resolve`, `update`, `deactivate`, `config doctor` | The Esplora REST endpoint. |
| `btc.rpcUrl` | string (URL) | `resolve`, `update`, `deactivate`, `config doctor` | The Bitcoin Core RPC endpoint. It is optional. `btc.signalDiscovery` `fullnode` needs it. |
| `btc.rpcUser` | string | same as `btc.rpcUrl` | The RPC user name. |
| `btc.rpcPass` | string | same as `btc.rpcUrl` | The RPC password. Use a secret reference, not the password: `env:<VAR>` reads an environment variable, and `file:<path>` reads a file. See [Secrets](#secrets). |
| `btc.wallet` | string | same as `btc.rpcUrl` | The Bitcoin Core wallet name for wallet-scoped RPC calls. |
| `btc.headers` | object | same as `btc.rest` | Extra headers for each REST request, for example `{ "X-Api-Key": "abc123" }`. |
| `btc.rpcHeaders` | object | same as `btc.rpcUrl` | Extra headers for each RPC request. |
| `btc.timeoutMs` | number | all Bitcoin requests | The request timeout in milliseconds. With no value, there is no timeout. |
| `btc.signalDiscovery` | `indexer` \| `fullnode` | `resolve`, `update`, `deactivate` | The source of the beacon signals. `indexer` reads them from Esplora. `fullnode` scans the blocks over Bitcoin Core RPC. The default is `indexer`. |
| `btc.feeRate` | number | `update`, `deactivate` | The fee rate of a beacon transaction, in sats/vByte. The SDK default is 5. |
| `btc.changeAddress` | string | `update`, `deactivate` | The address that gets the change of a beacon transaction. With no value, the change goes back to the beacon address. |

The RPC URL, user, and password come from one layer together (ADR 074). A URL from a flag never gets the password of the profile.

### cas: the content-addressed store

| Key | Type | Used by | Meaning |
|-----|------|---------|---------|
| `cas.gateway` | string (URL) | `resolve`, `update`, `deactivate`, `config doctor` | An IPFS HTTP gateway. The CLI reads CAS data through it. It cannot write. |
| `cas.rpcUrl` | string (URL) | same as `cas.gateway` | An IPFS HTTP RPC endpoint (for example a Kubo node). The CLI reads and writes through it. It wins over `cas.gateway`. `--publish-to-cas auto` and `always` need it. |
| `cas.timeoutMs` | number | all CAS requests | The request timeout in milliseconds. The default is 30000. `0` disables the timeout. |

### identity: the keys

The config file never holds a secret key. The secret keys are in the keystore. The `identity` keys only point to the keystore and to a key in it.

| Key | Type | Used by | Meaning |
|-----|------|---------|---------|
| `identity.keystore` | string (path) | `create`, `update`, `deactivate`, `key`, `keystore`, `config path` | The keystore file of the profile, below `--keystore`. The default is `<home>/keystore.json`. |
| `identity.default` | string (key reference) | `create`, `update`, `deactivate` | The default key of the profile: a key URN, a key name, or a fingerprint prefix. `create` makes the identifier from its public key, and `update` and `deactivate` sign with it. `create --key` and `--signing-key` win over it. It wins over the active key of the keystore. |

Use `identity.default` if one keystore holds keys for more than one profile. The active key of the keystore (`btcr2 key use`) applies to all profiles. `identity.default` gives one profile its own key. Remember that `identity.default` applies only to the active profile (see [The active profile](#the-active-profile)).

## Secrets

- `btc.rpcPass` accepts a secret reference: `env:<VAR>` or `file:<path>`. The CLI trims one trailing newline from the value. `BTCR2_BTC_RPC_PASS` accepts the same references.
- The other keys do not accept a secret reference. A header value, for example an API key, is stored as written.
- `config get`, `config list`, and `profile show` print `********` for a value whose key name contains `pass`, `secret`, `token`, `auth`, `api-key`, `api_key`, `apikey`, `credential`, or `bearer`. They also mask a password in a URL. `config get --show-secrets` prints the stored values.
- The file mode `0600` keeps the file private to your user.

## Precedence

For each value, the highest layer that sets the value wins. A blank value at one layer goes to the next layer.

- Connection values: the flag, then the environment variable, then the profile, then the built-in default of the network.
- `feeRate`: `--fee-rate`, then `BTCR2_FEE_RATE`, then `btc.feeRate`, then 5 sat/vByte. `changeAddress`: `--change-address`, then `btc.changeAddress`.
- Network (a command with no identifier): `-n`, then `defaults.network`, then the `network` of the active profile, then `regtest`.
- Keystore path: `--keystore`, then `identity.keystore`, then `<home>/keystore.json`.
- Key: `create --key` or `--signing-key`, then `identity.default`, then the active key of the keystore.
- Output: `-o`, then `BTCR2_OUTPUT`, then `defaults.output`, then `text`.

The [docs README](./README.md#environment-variables) lists all environment variables. `btcr2 config effective` prints the resolved connection values and the layer of each value.

## Read and change the file

| Task | Command |
|------|---------|
| Write a first file | `btcr2 config init` (or `btcr2 init`) |
| Print the file | `btcr2 config list` |
| Print one value | `btcr2 config get profiles.mutinynet.btc.rest` |
| Set one value | `btcr2 config set profiles.mutinynet.btc.rest https://esplora.example.com/api` |
| Remove one value | `btcr2 config unset profiles.mutinynet.btc.rest` |
| Find wrong keys and values | `btcr2 config validate` |
| Print the resolved connection values | `btcr2 config effective` |
| Test the endpoints | `btcr2 config doctor` |
| Add, select, show, or remove a profile | `btcr2 profile add`, `use`, `show`, `remove` |

`config set` checks the value of each known key. It refuses a network, an output format, or a `signalDiscovery` value that is not in the list. It refuses a number key with a value that is not a number. It writes an unknown key, and it prints a warning. You can also edit the file in a text editor. Then run `btcr2 config validate`.

## Examples

```sh
# Make mutinynet the active profile. The profile name also gives the default network.
btcr2 config set defaults.profile mutinynet

# Add a mainnet profile. Its name is not a network name, so it needs the network key.
btcr2 profile add production
btcr2 config set profiles.production.network bitcoin
btcr2 config set profiles.production.btc.rest https://mainnet.example.com/api

# Give the mutinynet profile its own default key
btcr2 config set profiles.mutinynet.identity.default demo

# Use your own Esplora server with an API key
btcr2 config set profiles.mutinynet.btc.rest https://esplora.example.com/api
btcr2 config set profiles.mutinynet.btc.headers '{"X-Api-Key":"abc123"}'

# Read the RPC password from a file, not from the config file
btcr2 config set profiles.regtest.btc.rpcUrl http://127.0.0.1:18443
btcr2 config set profiles.regtest.btc.rpcUser polaruser
btcr2 config set profiles.regtest.btc.rpcPass file:/home/me/.btcr2/regtest-rpc-pass

# Publish updates to a local IPFS node
btcr2 config set profiles.regtest.cas.rpcUrl http://127.0.0.1:5001

# Check the result
btcr2 config validate
btcr2 --profile regtest config effective
```

## See also

- [config.md](./config.md): the `config` subcommands.
- [profile.md](./profile.md): the `profile` subcommands.
- [key.md](./key.md): the keys, the key references, and the active key.
- [keystore.md](./keystore.md): the keystore and the passphrase.
- [README.md](./README.md): the global flags, the environment variables, and the full precedence.
