# The config file

The config file holds the defaults of the CLI and the named profiles. A profile holds the endpoints, the transaction settings, and the key settings for one setup, for example one network. The file is optional: with no config file, the CLI uses the built-in default of each value. `btcr2 init`, `btcr2 quickstart`, and `btcr2 config init` write a first config file. `btcr2 config` and `btcr2 profile` read and change it.

This page shows each key of the file, the commands that read the key, and the rules that select a profile. [config.md](./config.md) documents the `config` subcommands, and [profile.md](./profile.md) documents the `profile` subcommands.

## Location

The file is `<home>/config.json`. The home is `--home`, else `BTCR2_HOME`, else `~/.btcr2` (`%LOCALAPPDATA%\btcr2` on Windows). `-c, --config <path>` selects another file. `btcr2 config path` prints the path that the CLI uses.

The CLI writes the file atomically with file mode `0600`, in a directory with mode `0700`. Each write sets `schemaVersion` to `1`.

## A full example

This example sets each key of the file at least once. `defaults.cas` and a profile `cas` block take the same keys, so the example spreads the CAS keys over the two blocks. The values are examples. A real file sets only the keys that it needs.

```json
{
  "schemaVersion": 1,
  "defaults": {
    "profile": "production",
    "network": "bitcoin",
    "output": "text",
    "cas": {
      "rpcUrl": "https://ipfs.example.com",
      "rpcUser": "btcr2",
      "rpcPass": "env:IPFS_RPC_PASSWORD",
      "timeoutMs": 60000
    }
  },
  "profiles": {
    "production": {
      "network": "bitcoin",
      "btc": {
        "rest": "https://esplora.example.com/api",
        "headers": { "X-Api-Key": "abc123" },
        "rpcUrl": "https://bitcoind.example.com",
        "rpcUser": "btcr2",
        "rpcPass": "file:/home/me/.btcr2/bitcoind-rpc-pass",
        "rpcHeaders": { "X-Proxy-Key": "def456" },
        "wallet": "btcr2",
        "timeoutMs": 15000,
        "signalDiscovery": "fullnode",
        "feeRate": 10,
        "changeAddress": "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
      },
      "cas": {
        "timeoutMs": 120000
      },
      "identity": {
        "keystore": "/home/me/.btcr2/production-keystore.json",
        "default": "prod"
      }
    },
    "testing": {
      "network": "mutinynet",
      "btc": {
        "rest": "https://mutinynet.example.com/api"
      },
      "cas": {
        "gateway": "https://gateway.example.com"
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
    }
  }
}
```

### The defaults

- `defaults.profile` makes `production` the active profile of each command. `--profile testing` and `--profile regtest` select the other profiles.
- The active profile applies also to an identifier of another network. For example, `btcr2 resolve` of a mutinynet identifier reads the mainnet endpoints of `production`, and it prints a warning. Pass `--profile testing` for a mutinynet identifier.
- `defaults.network` is the network of `create` and `genesis build` if `-n` is absent and the active profile has no network. Each profile of this example has a network, so the network of the active profile wins (ADR 131).
- `defaults.output` sets the output format. `text` is also the built-in default.
- `defaults.cas` makes each profile read and write CAS data through the IPFS node `https://ipfs.example.com`, with HTTP Basic auth. The password comes from the environment variable `IPFS_RPC_PASSWORD`. A CAS request stops after 60 seconds. A profile `cas` block can replace these values.

### The production profile

- `btcr2 create` makes a `bitcoin` identifier from the key named `prod` in `/home/me/.btcr2/production-keystore.json`. `update` and `deactivate` sign with the same key.
- `resolve`, `update`, and `deactivate` read the chain through `https://esplora.example.com/api`, with the `X-Api-Key` header. `signalDiscovery` `fullnode` makes them read the beacon signals from the blocks of the Bitcoin Core node.
- The Bitcoin Core RPC password comes from the file `/home/me/.btcr2/bitcoind-rpc-pass`. The RPC requests have the `X-Proxy-Key` header, and they use the wallet `btcr2`.
- A beacon transaction pays 10 sat/vByte and sends its change to `bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4`.
- `update --publish-to-cas auto` and `always` write to the IPFS node of `defaults.cas`. The commands also read CAS data through this node.
- A Bitcoin request stops after 15 seconds. A CAS request stops after 120 seconds: the `cas.timeoutMs` of the profile wins over the value of `defaults.cas`.

### The testing profile

- `testing` is not a network name, so the profile needs its `network` key. Without the key, the profile has no network.
- `btcr2 --profile testing resolve` reads a mutinynet identifier through `https://mutinynet.example.com/api`, and it reads CAS data through the gateway `https://gateway.example.com`. A gateway cannot write, so `--publish-to-cas always` fails with this profile. The gateway of the profile wins over the IPFS node of `defaults.cas`, because the CAS endpoint comes from one layer. The CAS timeout of `defaults.cas` still applies.
- `btcr2 --profile testing create` makes a `mutinynet` identifier from the key named `demo`. The `network` key of the profile wins over `defaults.network`.

### The regtest profile

- The profile name gives the network, so the profile needs no `network` key.
- `btcr2 --profile regtest` uses a local Bitcoin Core node, a local Esplora server, and a local IPFS node, for example a [Polar](https://lightningpolar.com) network. The local IPFS node needs no credentials. Its `cas.rpcUrl` wins over `defaults.cas`, and the CLI does not send the credentials of `defaults.cas` to it.

## Top-level keys

| Key | Type | Used by | Meaning |
|-----|------|---------|---------|
| `schemaVersion` | number | all commands | The version of the file format. The CLI sets it to `1`. A command refuses a file with a newer version. |
| `defaults.profile` | string | all commands | The active profile if `--profile` is absent. See [The active profile](#the-active-profile). |
| `defaults.network` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | `create`, `genesis build`, `config effective`, `config doctor` | The network of a command that does not take an identifier, if `-n` is absent and the active profile has no network. `init -n` and `quickstart -n` write it. A command that takes an identifier reads the network from the identifier. |
| `defaults.output` | `text` \| `json` | all commands | The output format, below `-o` and `BTCR2_OUTPUT`. |
| `defaults.cas` | object | `resolve`, `update`, `deactivate`, `config effective`, `config doctor` | The CAS values for all networks: `gateway`, `rpcUrl`, `rpcUser`, `rpcPass`, and `timeoutMs`, as in a profile [`cas` block](#cas-the-content-addressed-store). A profile value wins over it (ADR 129). |

## Profiles

`profiles` is an object. Each key is a profile name, and each value is a profile. A profile name can be a network name (`mutinynet`) or another name (`production`). `init` writes one empty profile for each network.

### The active profile

The active profile is the profile that `--profile` names, else the profile that `defaults.profile` names.

The CLI selects a profile in two different ways:

- **Connection values** (`network`, `btc.*`, `cas.*`): the active profile, also for an identifier of another network. If there is no active profile, the CLI uses the profile with the name of the network. For example, `btcr2 resolve` of a signet identifier with no `defaults.profile` uses `profiles.signet`.
- **Key settings** (`identity.keystore`, `identity.default`): the active profile only. The CLI does not use the profile with the name of the network for these keys. Set `defaults.profile`, or pass `--profile`, to make them apply.

A value that the profile does not set comes from the next layer. See [Precedence](#precedence).

### network

| Key | Type | Used by | Meaning |
|-----|------|---------|---------|
| `network` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | `create`, `genesis build`, `resolve`, `update`, `deactivate`, `config effective`, `config doctor`, `keystore unlock` | The network that the endpoints of the profile serve. If `-n` is absent, `create` uses this network. It wins over `defaults.network` (ADR 131). `create`, `genesis build`, `resolve`, `update`, and `deactivate` print a warning if the identifier has another network. A profile with a network name and no `network` key has the network of its name. A profile with another name, for example `production`, has no network without the key. |

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
| `cas.rpcUrl` | string (URL) | same as `cas.gateway` | An IPFS HTTP RPC endpoint (for example a Kubo node). The CLI reads and writes through it. In one layer, it wins over `cas.gateway`. `--publish-to-cas auto` and `always` need it. |
| `cas.rpcUser` | string | same as `cas.rpcUrl` | The HTTP Basic user name of the IPFS RPC endpoint, for a node behind a reverse proxy with authentication. |
| `cas.rpcPass` | string | same as `cas.rpcUrl` | The HTTP Basic password. Use a secret reference, not the password: `env:<VAR>` reads an environment variable, and `file:<path>` reads a file. See [Secrets](#secrets). |
| `cas.timeoutMs` | number | all CAS requests | The request timeout in milliseconds. The default is 30000. `0` disables the timeout. |

`defaults.cas` takes the same keys. It applies to each profile, and to a network with no profile. A profile value wins over it.

The CAS endpoint comes from one layer. The highest layer that sets `gateway` or `rpcUrl` gives the gateway, the RPC URL, the user, and the password (ADR 129). The layers are the flag, the environment variable, the profile `cas` block, and `defaults.cas`. So a profile `cas.gateway` wins over a `defaults.cas.rpcUrl`, and a URL never gets the password of another layer. `cas.timeoutMs` is not part of the endpoint: each layer can set it alone. `cas.rpcUser` and `cas.rpcPass` go together: if only one of them is set, a command that uses the CAS fails. If the layer of the URL gives no password, the CLI reads the file that `BTCR2_CAS_RPC_PASS_FILE` names.

### identity: the keys

The config file never holds a secret key. The secret keys are in the keystore. The `identity` keys only point to the keystore and to a key in it.

| Key | Type | Used by | Meaning |
|-----|------|---------|---------|
| `identity.keystore` | string (path) | `create`, `update`, `deactivate`, `key`, `keystore`, `config path` | The keystore file of the profile, below `--keystore`. The default is `<home>/keystore.json`. |
| `identity.default` | string (key reference) | `create`, `update`, `deactivate` | The default key of the profile: a key URN, a key name, or a fingerprint prefix. `create` makes the identifier from its public key, and `update` and `deactivate` sign with it. `create --key` and `--signing-key` win over it. For `update` and `deactivate`, the signing key of the identifier record also wins over it. It wins over the active key of the keystore. |

Use `identity.default` if one keystore holds keys for more than one profile. The active key of the keystore (`btcr2 key use`) applies to all profiles. `identity.default` gives one profile its own key. Remember that `identity.default` applies only to the active profile (see [The active profile](#the-active-profile)).

## Secrets

- `btc.rpcPass`, `cas.rpcPass`, and `defaults.cas.rpcPass` accept a secret reference: `env:<VAR>` or `file:<path>`. The CLI trims one trailing newline from the value. `BTCR2_BTC_RPC_PASS` and `BTCR2_CAS_RPC_PASS` accept the same references.
- The other keys do not accept a secret reference. A header value, for example an API key, is stored as written.
- `config get`, `config list`, and `profile show` print `********` for a value whose key name contains `pass`, `secret`, `token`, `auth`, `api-key`, `api_key`, `apikey`, `credential`, or `bearer`. They also mask a password in a URL. `config get --show-secrets` prints the stored values.
- The file mode `0600` keeps the file private to your user.

## Precedence

For each value, the highest layer that sets the value wins. A blank value at one layer goes to the next layer.

- Connection values: the flag, then the environment variable, then the profile, then `defaults.cas` (CAS values only), then the built-in default of the network.
- Bitcoin Core RPC endpoint (`btc.rpc*`): the URL, the user, and the password come together from the highest layer that gives a URL.
- CAS endpoint (`cas.gateway` and `cas.rpc*`): the gateway, the URL, the user, and the password come together from the highest layer that gives a gateway or a URL.
- `feeRate`: `--fee-rate`, then `BTCR2_FEE_RATE`, then `btc.feeRate`, then 5 sat/vByte. `changeAddress`: `--change-address`, then `btc.changeAddress`.
- Network (a command with no identifier): `-n`, then the `network` of the active profile, then `defaults.network`, then `regtest`.
- Keystore path: `--keystore`, then `identity.keystore`, then `<home>/keystore.json`.
- Key: `create --key` or `--signing-key`, then the signing key of the identifier record, then `identity.default`, then the active key. Only `update` and `deactivate` read the identifier record (ADR 133).
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

# Use one IPFS node for all networks
btcr2 config set defaults.cas.rpcUrl https://ipfs.example.com
btcr2 config set defaults.cas.rpcUser btcr2
btcr2 config set defaults.cas.rpcPass file:/home/me/.btcr2/ipfs-rpc-pass

# Publish the mutinynet updates to another IPFS node behind HTTP Basic auth
btcr2 config set profiles.mutinynet.cas.rpcUrl https://ipfs.example.com
btcr2 config set profiles.mutinynet.cas.rpcUser btcr2
btcr2 config set profiles.mutinynet.cas.rpcPass file:/home/me/.btcr2/ipfs-rpc-pass

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
