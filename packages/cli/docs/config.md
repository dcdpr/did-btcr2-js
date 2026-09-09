# btcr2 config

Reads, writes, validates, and inspects the CLI config. The config file is a JSON document (default `<home>/config.json`, and the home default is `~/.btcr2`). It holds the tool defaults and the named profiles with the Bitcoin and CAS endpoints, the credentials, and the identity references. Use `config` to write a fresh file (`init`), to edit one key (`set`, `unset`), to inspect the stored values (`get`, `list`), to check the file against the known schema (`validate`), to see the connection values that a live command uses and their source (`effective`), to print the resolved paths on disk (`path`), and to probe the endpoints (`doctor`). Each subcommand is offline, except `doctor`, which does read-only network probes.

## Synopsis

```
btcr2 config init [--force]
btcr2 config get [path] [--show-secrets]
btcr2 config set <path> <value>
btcr2 config unset <path>
btcr2 config list [--show-secrets]              (alias: btcr2 config ls)
btcr2 config validate
btcr2 config effective [-n <network>] [--show-secrets]
btcr2 config path
btcr2 config doctor [-n <network>]
btcr2 config help [command]
```

## Subcommands

The output modes (all subcommands): in `text` mode (the default), the command prints the payload only: an object as pretty JSON, a string leaf as the bare string, a missing value as `null`. In `json` mode (`-o json`, `BTCR2_OUTPUT=json`, or config `defaults.output`), the command prints the full envelope `{ "action": "config-<sub>", "data": ... }`. An error always goes to stderr as a plain message (the full error object only under `--verbose`), with exit code 1.

### config init

Creates a default config file at the resolved config path (the `-c/--config` flag, else `<home>/config.json`). The scaffold contains `schemaVersion: 1`, `defaults.output: "text"`, and one empty profile per supported network (`bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`). If the file exists, the command fails with `Config already exists at <path>. Use --force to overwrite.`, unless `--force` is present. The write is atomic, with file mode `0600`. The command creates the parent directory with mode `0700`. This is the same scaffold that `btcr2 init` writes. `config init` touches the config file only (no keystore, no default network).

Prints `{ "path": "<config path>" }` (text) or `{ "action": "config-init", "data": { "path": ... } }` (json).

```sh
btcr2 config init
btcr2 config init --force
```

### config get

Prints the value at a dotted path (for example `profiles.mutinynet.btc.rest`), or the whole config if the `path` argument is absent. The command treats an absent config file as `{}`. A path that does not exist prints `null`. By default, the command redacts the secret values. A scalar under a key whose name matches `pass`, `secret`, `token`, `auth`, `api-key`, `api_key`, `apikey`, `credential`, or `bearer` (case-insensitive) prints as `********`. The command also masks a password in a URL value (`scheme://user:pass@host`), whatever the key name. `--show-secrets` prints the stored values as they are. The redaction applies to the output only. The command never changes the file.

The command fails on a config file that exists but is not valid JSON (`CONFIG_PARSE_ERROR`), or that has a `schemaVersion` newer than this CLI supports (`CONFIG_SCHEMA_VERSION_ERROR`).

```sh
btcr2 config get                              # the whole config, secrets redacted
btcr2 config get defaults.network
btcr2 config get profiles.mutinynet.btc.rpcPass --show-secrets
```

### config set

Sets a value at a dotted path, creates the intermediate objects if necessary, and writes the file again atomically. The value parse rules:

- The command always stores a known string path as a raw string, so a bare `8080` never becomes a number. These paths are: `defaults.profile`, `defaults.network`, `defaults.output`, `profiles.<name>.network`, `profiles.<name>.btc.{rest,rpcUrl,rpcUser,rpcPass,changeAddress,wallet}`, `profiles.<name>.cas.{gateway,rpcUrl}`, and `profiles.<name>.identity.{keystore,default}`.
- The command parses every other path as JSON if the value is valid JSON (a number, a boolean, an object, an array). Otherwise it stores the value as a plain string.

The validation at write time against the known schema:

- The command refuses an invalid value at an enum leaf. `defaults.network` and `profiles.<name>.network` must be one of `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`. `defaults.output` must be `json` or `text`. `profiles.<name>.btc.signalDiscovery` must be `indexer` or `fullnode`.
- A number leaf (`schemaVersion`, `profiles.<name>.btc.feeRate`, `profiles.<name>.btc.timeoutMs`, `profiles.<name>.cas.timeoutMs`) must parse as a JSON number. The command refuses a non-numeric value.
- An object leaf (`profiles.<name>.btc.headers`, `profiles.<name>.btc.rpcHeaders`) must be a JSON object, for example `'{"X-Api-Key":"abc"}'`.
- The command still writes an unknown path (for forward compatibility and for third-party keys), but it prints `Warning: "<path>" is not a known config path; writing it anyway.` on stderr. `--quiet` suppresses the warning, not the write.

More behavior: the command refuses the path segments `__proto__`, `constructor`, and `prototype` (`INVALID_ARGUMENT_ERROR`). Each write stamps `schemaVersion: 1` and keeps the unknown keys (a read, a change, and a write of the raw JSON). A config file that exists but is malformed JSON fails the write. The command does not overwrite it (`Fix the file by hand; the CLI will not overwrite it while it is unparseable.`).

Prints `{ "path": "<dotted path>" }` on success.

```sh
btcr2 config set defaults.network mutinynet
btcr2 config set profiles.mutinynet.btc.feeRate 2
btcr2 config set profiles.mutinynet.btc.headers '{"X-Api-Key":"abc123"}'
```

### config unset

Deletes the value at a dotted path and writes the file again. A path that does not exist is a silent no-op (the command still writes the file again and stamps it). The same refusal of an unsafe segment and of a malformed file as in `config set` applies. Prints `{ "path": "<dotted path>" }`.

```sh
btcr2 config unset profiles.mutinynet.btc.rpcPass
```

### config list (alias: ls)

Prints the whole config file with the same secret redaction as `config get`. `--show-secrets` shows the stored values. An absent file prints `{}`.

```sh
btcr2 config list
btcr2 config ls --show-secrets
```

### config validate

Checks the config file against the known schema and prints `{ "ok": <boolean>, "issues": [ { "path", "issue" }, ... ] }`. The findings:

- `unknown key` for a key outside the known schema (the walk does not enter an unknown subtree, so one unknown parent gives one finding),
- an invalid enum value (`defaults.network`, `defaults.output`, `profiles.<name>.network`, `profiles.<name>.btc.signalDiscovery`),
- a non-number value at a number leaf, and a non-object value at an object leaf,
- a `schemaVersion` newer than this CLI supports (a finding, not a stop: `validate` reads the raw file, and it bypasses the schema version limit that the read subcommands apply).

The exit code is 1 if the command finds an issue, and 0 if the file is clean or absent. A file that is not valid JSON still stops the command with `CONFIG_PARSE_ERROR` (there is nothing to walk).

```sh
btcr2 config validate
```

### config effective

Prints the resolved Bitcoin and CAS connection config of one network, with the source of each value. The command reads the values through the real resolver (the same code path as a live command), so the output cannot differ from the live behavior. Each entry is `{ "value": ..., "source": ... }`. `source` is one of `flag`, `env`, `file`, or `default`. An unresolved value omits `value` (JSON output drops undefined) and reports `source: "default"`.

The shape: the top-level `network` and `profile` (the active profile name, absent if no profile is active), `btc.{rest,rpcUrl,rpcUser,rpcPass,rpcWallet,signalDiscovery,timeoutMs}`, and `cas.{gateway,rpcUrl,timeoutMs}`.

Network selection: `-n/--network` if present (validated against the supported list), else `defaults.network` of the config file, else the network of the active profile (its explicit `network` field, or its name if the name is a network), else `regtest`. The `--help` text calls this "config default network". The source implements the full fallback chain above.

Resolution notes:

- The RPC endpoint resolves as one credential unit: `rpcUrl`, `rpcUser`, and `rpcPass` come together from the highest precedence layer that supplies a URL (else the highest that supplies a credential). A host from one layer never gets the password of another layer.
- The command resolves an RPC password that is a secret reference (`env:<VAR>` or `file:<path>`, from the environment or from a profile) to its literal value. A password from the file that `BTCR2_BTC_RPC_PASS_FILE` names reports `source: "env"`.
- An endpoint value with `source: "default"` is the SDK default of the network. REST: `https://mempool.space/api` (bitcoin), `https://mempool.space/testnet/api` (testnet3), `https://mempool.space/testnet4/api` (testnet4), `https://mempool.space/signet/api` (signet), `https://mutinynet.com/api` (mutinynet), `http://localhost:3000` (regtest). RPC: `http://localhost:18443` (regtest only, no default credentials). CAS gateway: `https://ipfs.io`.
- A timeout has no default. `btc.timeoutMs` must be 1 ms or more, and `cas.timeoutMs` must be 0 ms or more (`0` disables the CAS timeout). An invalid `--btc-timeout` or `--cas-timeout` value stops the command.
- The command reads `btc.signalDiscovery` back from the constructed api, so it always carries a value: `indexer` with `source: "default"` if no layer sets it. `fullnode` resolves only on a network that ends up with an RPC client. A request for it without one stops the subcommand at the api construction. The command does not report an unusable mode.

By default, the resolved RPC password prints as `********`, and the command masks a `user:pass@` userinfo in the REST, RPC, and CAS endpoint URLs. The source still shows where each value came from. `--show-secrets` shows them. The subcommand constructs an api client, but it does no network I/O.

```sh
btcr2 config effective -n mutinynet
btcr2 config effective -n regtest --show-secrets
```

### config path

Prints the resolved locations on disk as `{ "home", "config", "keystore" }`:

- `home`: the `--home` flag, else `$BTCR2_HOME`, else the platform default. The platform default is `~/.btcr2` on Linux and macOS. On Windows it is `%LOCALAPPDATA%\btcr2`, else `%APPDATA%\btcr2`, else `<user profile>\btcr2`. A blank value at one layer defers to the next layer.
- `config`: the `-c/--config` flag, else `<home>/config.json`.
- `keystore`: the `--keystore` flag, else the `identity.keystore` of the active profile, else `<home>/keystore.json`. This is a diagnostic command, so the keystore lookup is lenient. A malformed config file falls back to the home default instead of a stop. A command that changes the keystore stops with a message in the same situation.

The command never reads key material, never asks for a passphrase, and never touches the network.

```sh
btcr2 config path
BTCR2_HOME=/tmp/btcr2-demo btcr2 config path
```

### config doctor

Probes the resolved endpoints of one network (the same network selection and connection resolution as `config effective`). The command is read-only: it fetches status endpoints, and it never writes or broadcasts. Each probe has a 5000 ms timeout. The checks:

- `btc-rest`: `GET <rest-host>/blocks/tip/height`, with the configured REST headers.
- `btc-rpc`: a `getblockchaininfo` RPC call, only if an RPC client exists. An RPC client exists if a layer supplies an RPC URL, or on regtest (its default host `http://localhost:18443` always creates one, so the probe always runs there). On another network, credentials, a wallet name, or headers alone without an RPC URL create no RPC client, and the command skips the check.
- `cas`: if a writable CAS RPC is configured, `POST <cas-rpc-url>/api/v0/version` (a Kubo node answers a POST only). Otherwise `GET` on the resolved gateway base URL (default `https://ipfs.io`).

Prints `{ "checks": [ { "endpoint", "target", "ok", "detail"? }, ... ] }`. `detail` carries the HTTP status or the error message of a failed check. If the active profile declares a network that differs from the probed network, the output includes a `coherence` object (`{ "profile", "declared", "encoding" }`). The exit code is 1 if a check fails.

```sh
btcr2 config doctor -n mutinynet
btcr2 --profile regtest config doctor -n regtest
```

## Options

The subcommand flags. Each subcommand also accepts `-h, --help`.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--force` | boolean | `false` | `config init` only. Overwrite an existing config file instead of a failure. |
| `--show-secrets` | boolean | `false` | `config get`, `config list`, `config effective`. Show the secret values (the RPC password, a secret-named key, a credential in a URL) instead of the `********` redaction. |
| `-n, --network <network>` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | `defaults.network`, else the network of the active profile, else `regtest` | `config effective`, `config doctor`. The network whose connection config the command resolves. An unsupported value fails with `INVALID_ARGUMENT_ERROR`. |

The arguments:

| Argument | Subcommand | Value | Description |
|---|---|---|---|
| `[path]` | `config get` | a dotted config path | Optional. Without it, the command prints the whole config. |
| `<path>` | `config set`, `config unset` | a dotted config path | Required. The command refuses the segments `__proto__`, `constructor`, `prototype`. |
| `<value>` | `config set` | string | The command parses it as JSON if the value is valid JSON, unless the path is a known string leaf (see `config set`). |

## Environment and configuration

The environment variables that the command group reads:

| Variable | Used by | Effect |
|---|---|---|
| `BTCR2_HOME` | all subcommands | The home directory that holds `config.json` and `keystore.json`. `--home` wins. |
| `BTCR2_OUTPUT` | all subcommands | The output format (`json` or `text`). `-o/--output` wins over it, and it wins over config `defaults.output`. |
| `BTCR2_BTC_REST` | `effective`, `doctor` | The Bitcoin REST endpoint override (as `--btc-rest`). |
| `BTCR2_BTC_RPC_URL` | `effective`, `doctor` | The Bitcoin Core RPC endpoint override (as `--btc-rpc-url`). |
| `BTCR2_BTC_RPC_USER` | `effective`, `doctor` | The RPC username (as `--btc-rpc-user`). |
| `BTCR2_BTC_RPC_PASS` | `effective`, `doctor` | The RPC password (an `env:<VAR>` or `file:<path>` secret reference is valid). There is no flag: a password on argv is visible through `ps` and the shell history. |
| `BTCR2_BTC_RPC_PASS_FILE` | `effective`, `doctor` | The path of a file with the RPC password. The CLI reads it only if no layer supplies a password and it builds an RPC config. |
| `BTCR2_CAS_GATEWAY` | `effective`, `doctor` | The IPFS HTTP gateway for CAS reads (as `--cas-gateway`). |
| `BTCR2_CAS_RPC_URL` | `effective`, `doctor` | The IPFS HTTP RPC endpoint of a writable CAS (as `--cas-rpc-url`). |
| `BTCR2_BTC_SIGNAL_DISCOVERY` | `effective`, `doctor` | The source of the beacon signals, `indexer` or `fullnode` (as `--btc-signal-discovery`). Another value stops the command. |
| `BTCR2_BTC_TIMEOUT` | `effective`, `doctor` | The Bitcoin request timeout in ms, 1 or more (as `--btc-timeout`). |
| `BTCR2_CAS_TIMEOUT` | `effective`, `doctor` | The CAS request timeout in ms, 0 or more. `0` disables it (as `--cas-timeout`). |

The known config file keys (the schema that `config set` validates against and that `config validate` walks):

| Key | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Each write stamps it to `1`. `get`, `set`, `unset`, `list`, `effective`, and `doctor` refuse a file with a newer version. `validate` reports it as a finding instead. `init` never reads the file (`--force` overwrites it). `path` falls back to the default keystore path. |
| `defaults.profile` | string | The active profile if `--profile` is absent. |
| `defaults.network` | enum | `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`. The default network of `effective` and `doctor` (and of the offline `create`). |
| `defaults.output` | enum | `json` or `text`. The default output format. |
| `profiles.<name>.network` | enum | The network of the endpoints of a profile. It drives the `doctor` coherence warning and the default network resolution. |
| `profiles.<name>.btc.rest` | string | The Esplora REST endpoint. |
| `profiles.<name>.btc.rpcUrl` | string | The Bitcoin Core RPC endpoint. |
| `profiles.<name>.btc.rpcUser` | string | The RPC username. |
| `profiles.<name>.btc.rpcPass` | string | The RPC password. An `env:<VAR>` or `file:<path>` secret reference is valid. The output redacts it. |
| `profiles.<name>.btc.feeRate` | number | The fee rate in sats/vByte of a beacon transaction (the `config` subcommands do not read it). |
| `profiles.<name>.btc.changeAddress` | string | The beacon change address (the `config` subcommands do not read it). |
| `profiles.<name>.btc.timeoutMs` | number | The Bitcoin request timeout. No default (no limit). |
| `profiles.<name>.btc.headers` | object | Extra REST headers, for example an API key. The output redacts a secret-named header. |
| `profiles.<name>.btc.wallet` | string | The Bitcoin Core wallet name for wallet-scoped RPCs. |
| `profiles.<name>.btc.rpcHeaders` | object | Extra Bitcoin Core RPC headers. |
| `profiles.<name>.btc.signalDiscovery` | `"indexer"` \| `"fullnode"` | The source of the beacon signals. `fullnode` scans blocks over Bitcoin Core RPC. |
| `profiles.<name>.cas.gateway` | string | The IPFS HTTP gateway (a read-only CAS). |
| `profiles.<name>.cas.rpcUrl` | string | The IPFS HTTP RPC endpoint (a writable CAS). It wins over the gateway. |
| `profiles.<name>.cas.timeoutMs` | number | The CAS timeout. The api default is 30000 ms. `0` disables it. |
| `profiles.<name>.identity.keystore` | string | The keystore path of this profile. It feeds `config path`. |
| `profiles.<name>.identity.default` | string | The default signing key reference (the `config` subcommands do not read it). |

The precedence of each value that `config effective` and `config doctor` resolve: the CLI flag, then the environment variable, then the profile in the config file, then the built-in (SDK per-network) default. A blank value at one layer defers to the next layer. The RPC URL, username, and password come together from one layer (never mixed across layers). The active profile is `--profile`, else `defaults.profile`. If neither is set, the connection values come from the profile with the name of the resolved network.

The file subcommands (`init`, `get`, `set`, `unset`, `list`, `validate`) work on the file itself. Only `--home`, `$BTCR2_HOME`, and `-c/--config` affect them. The endpoint flags and environment variables never change what the command stores or prints from the file.

Passphrase and session: no `config` subcommand reads the keystore content, asks for a passphrase, or reads the session. `config path` reports the keystore location only.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. The interactions here: `--home` and `-c/--config` select the file that each subcommand works on. `--profile` selects the active profile for `effective`, `doctor`, and the keystore path in `config path`. `--keystore` overrides the keystore path that `config path` reports. `-o/--output` selects text or JSON. `--quiet` suppresses the unknown path warning of `config set`. `--verbose` prints the full error objects. The connection override flags (`--btc-rest`, `--btc-rpc-url`, `--btc-rpc-user`, `--btc-rpc-wallet`, `--btc-rest-header`, `--btc-rpc-header`, `--btc-signal-discovery`, `--btc-timeout`, `--cas-gateway`, `--cas-rpc-url`, `--cas-timeout`) feed the `flag` layer of `effective` and `doctor`.

## Examples

```sh
# Write a config file, and select mutinynet as the default network
btcr2 config init
btcr2 config set defaults.network mutinynet

# Point the mutinynet profile at explicit endpoints and a fee rate
btcr2 config set profiles.mutinynet.btc.rest 'https://mutinynet.com/api'
btcr2 config set profiles.mutinynet.btc.feeRate 2

# Store an RPC credential as a secret reference (resolved at connection time)
btcr2 config set profiles.regtest.btc.rpcUser 'polaruser'
btcr2 config set profiles.regtest.btc.rpcPass 'env:BTC_RPC_PASS'

# Inspect: the stored values (redacted), then the values that a live command uses
btcr2 config get profiles.mutinynet
btcr2 config effective -n mutinynet

# Check the file for typos and unknown keys (exit code 1 on a finding)
btcr2 config validate

# Where is the state? Which endpoints are reachable?
btcr2 config path
btcr2 config doctor -n mutinynet

# Machine-readable output
btcr2 -o json config list

# A sandbox home for experiments (never touches ~/.btcr2)
BTCR2_HOME=/tmp/btcr2-demo btcr2 config init
```

## See also

- `btcr2 init`: writes the same config scaffold, and also the keystore and a default network.
- `btcr2 quickstart`: the setup in one command: the home, the config file, the keystore, the network, an optional session, and the endpoint probe.
- `btcr2 profile`: add, use, show, and remove profiles (a task layer over the same file).
- `btcr2 keystore`: the keystore lifecycle and the session status for the path that `config path` reports.
- [README.md](./README.md): the full global flag reference and the config setup. The [package README](../README.md) has the install steps.
- [DEMO.md](./DEMO.md): the walkthrough that uses the config workflow.
