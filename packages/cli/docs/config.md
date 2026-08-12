# btcr2 config

Reads, writes, validates, and introspects the CLI's configuration. The config file is a JSON
document (default `<home>/config.json`, home default `~/.btcr2`) holding tool-wide defaults and
named profiles of Bitcoin/CAS endpoints, credentials, and identity references. Use `config` to
scaffold a fresh file (`init`), edit individual keys (`set`/`unset`), inspect stored values
(`get`/`list`), check the file against the known schema (`validate`), see the connection values a
live command would actually use and where each came from (`effective`), print the resolved on-disk
paths (`path`), and probe endpoint reachability (`doctor`). All subcommands are offline except
`doctor`, which performs read-only network probes.

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

Output modes (all subcommands): in `text` mode (the default) only the payload is printed: objects
as pretty-printed JSON, a string leaf as the bare string, a missing value as `null`. In `json`
mode (`-o json`, `BTCR2_OUTPUT=json`, or config `defaults.output`) the full envelope
`{ "action": "config-<sub>", "data": ... }` is printed. Errors always go to stderr as a plain
message (full error object only under `--verbose`) with exit code 1.

### config init

Creates a default config file at the resolved config path (`-c/--config` flag, else
`<home>/config.json`). The scaffold contains `schemaVersion: 1`, `defaults.output: "text"`, and
one empty profile per supported network (`bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`,
`regtest`). If the file already exists the command fails with
`Config already exists at <path>. Use --force to overwrite.` unless `--force` is given. The write
is atomic, file mode `0600`, parent directory created with mode `0700`. This is the same scaffold
`btcr2 init` seeds; `config init` touches only the config file (no keystore, no default network).

Prints `{ "path": "<config path>" }` (text) or `{ "action": "config-init", "data": { "path": ... } }`
(json).

```sh
btcr2 config init
btcr2 config init --force
```

### config get

Prints the value at a dotted path (e.g. `profiles.mutinynet.btc.rest`), or the whole config when
the positional `path` is omitted. An absent config file is treated as `{}`; a path that does not
exist prints `null`. By default, secret values are redacted: any scalar under a key whose name
matches `pass`, `secret`, `token`, `auth`, `api-key`/`api_key`/`apikey`, `credential`, or `bearer`
(case-insensitive) prints as `********`, and a password embedded in a URL value
(`scheme://user:pass@host`) is masked regardless of key name. `--show-secrets` prints the stored
values verbatim. Redaction is display-only; the file is never modified.

Fails on a config file that exists but is not valid JSON (`CONFIG_PARSE_ERROR`) or that has a
`schemaVersion` newer than this CLI supports (`CONFIG_SCHEMA_VERSION_ERROR`).

```sh
btcr2 config get                              # whole config, secrets redacted
btcr2 config get defaults.network
btcr2 config get profiles.mutinynet.btc.rpcPass --show-secrets
```

### config set

Sets a value at a dotted path, creating intermediate objects as needed, and rewrites the file
atomically. Value parsing:

- Known string-scalar paths are always stored as raw strings, so a bare `8080` is never coerced to
  a number. These paths are: `defaults.profile`, `defaults.network`, `defaults.output`,
  `profiles.<name>.network`, `profiles.<name>.btc.{rest,rpcUrl,rpcUser,rpcPass,changeAddress,wallet}`,
  `profiles.<name>.cas.{gateway,rpcUrl}`, and `profiles.<name>.identity.{keystore,default}`.
- Every other path is parsed as JSON when valid (numbers, booleans, objects, arrays), else stored
  as a plain string.

Write-time validation against the known schema:

- Enum leaves are hard-rejected on an invalid value: `defaults.network` and
  `profiles.<name>.network` must be one of `bitcoin`, `testnet3`, `testnet4`, `signet`,
  `mutinynet`, `regtest`; `defaults.output` must be `json` or `text`.
- Number leaves (`schemaVersion`, `profiles.<name>.btc.feeRate`, `profiles.<name>.btc.timeoutMs`,
  `profiles.<name>.cas.timeoutMs`) must parse as JSON numbers; a non-numeric value is rejected.
- Object leaves (`profiles.<name>.btc.headers`, `profiles.<name>.btc.rpcHeaders`) must be JSON
  objects, e.g. `'{"X-Api-Key":"abc"}'`.
- An unknown path is still written (forward-compatible and third-party keys work) but prints
  `Warning: "<path>" is not a known config path; writing it anyway.` on stderr. `--quiet`
  suppresses the warning, not the write.

Additional behavior: the path segments `__proto__`, `constructor`, and `prototype` are rejected
(`INVALID_ARGUMENT_ERROR`); every write stamps `schemaVersion: 1` and preserves unknown keys
(read-modify-write of the raw JSON); a config file that exists but is malformed JSON makes the
write fail rather than clobbering it (`Fix the file by hand; the CLI will not overwrite it while
it is unparseable.`).

Prints `{ "path": "<dotted path>" }` on success.

```sh
btcr2 config set defaults.network mutinynet
btcr2 config set profiles.mutinynet.btc.feeRate 2
btcr2 config set profiles.mutinynet.btc.headers '{"X-Api-Key":"abc123"}'
```

### config unset

Deletes the value at a dotted path and rewrites the file. A path that does not exist is a silent
no-op (the file is still rewritten and re-stamped). The same unsafe-segment rejection and
malformed-file refusal as `config set` apply. Prints `{ "path": "<dotted path>" }`.

```sh
btcr2 config unset profiles.mutinynet.btc.rpcPass
```

### config list (alias: ls)

Prints the entire config file with the same secret redaction as `config get`; `--show-secrets`
reveals stored values. An absent file prints `{}`.

```sh
btcr2 config list
btcr2 config ls --show-secrets
```

### config validate

Checks the config file against the known schema and prints
`{ "ok": <boolean>, "issues": [ { "path", "issue" }, ... ] }`. Findings collected:

- `unknown key` for any key outside the known schema (the walk does not descend into an unknown
  subtree, so one unknown parent yields one finding),
- invalid enum values (`defaults.network`, `defaults.output`, `profiles.<name>.network`),
- non-number values at number leaves and non-object values at object leaves,
- a `schemaVersion` newer than this CLI supports (reported as a finding, not an abort: `validate`
  reads the raw file, bypassing the schema-version ceiling that the reading subcommands enforce).

Exit code is 1 when any issue is found, 0 when the file is clean or absent. A file that is not
valid JSON still aborts with `CONFIG_PARSE_ERROR` (there is nothing to walk).

```sh
btcr2 config validate
```

### config effective

Prints the resolved Bitcoin and CAS connection configuration for one network, with per-value
provenance. Values are read back through the real resolver (the same code path live commands use),
so the output cannot drift from actual behavior. Each entry is `{ "value": ..., "source": ... }`
where `source` is one of `flag`, `env`, `file`, or `default`; an unresolved value omits `value`
(json output drops undefined) and reports `source: "default"`.

Shape: top-level `network` and `profile` (the active profile name; omitted when no profile is
active), `btc.{rest,rpcUrl,rpcUser,rpcPass,rpcWallet,timeoutMs}`, and
`cas.{gateway,rpcUrl,timeoutMs}`.

Network selection: `-n/--network` when given (validated against the supported list), else the
config file's `defaults.network`, else the active profile's network (its explicit `network` field,
or its name when named after a network), else `regtest`. The `--help` text summarizes this as
"config default network"; the full fallback chain above is what the source implements.

Resolution notes:

- The RPC endpoint is resolved as one atomic credential unit: `rpcUrl`, `rpcUser`, and `rpcPass`
  are taken together from the highest-precedence layer that supplies a URL (else the highest that
  supplies a credential), so a host from one layer is never paired with another layer's password.
- An RPC password given as a secret reference (`env:<VAR>` or `file:<path>`, via flag,
  environment variable, or profile) is resolved to its literal value; a password taken from the file named by
  `BTCR2_BTC_RPC_PASS_FILE` reports `source: "env"`.
  - An `env:` reference naming a variable that is not set **throws** (`CONFIG_READ_ERROR`)
    rather than resolving to nothing, so a networked command (one that resolves an RPC host)
    fails fast naming the variable instead of surfacing later as an opaque RPC auth failure.
    Offline commands (create, key management) never resolve a connection and are unaffected.
  - The `env:` and `file:` prefixes are reserved: a value starting with either is ALWAYS treated
    as a reference and there is no escape syntax, so a literal password cannot begin with `env:`
    or `file:`. If a real password starts with one of those prefixes, store it in a file and use
    a `file:<path>` reference (the file's contents are used verbatim).
  - A `file:` reference, and the file named by `BTCR2_BTC_RPC_PASS_FILE`, must satisfy the
    shared secret-file permission policy: mode `0600`, `0400`, `0440`, or `0640` (owner
    read/write, group read at most, no access for others, no execute bits). Anything
    group/world-writable or more open is rejected. Not enforceable on Windows.
- `default`-sourced endpoint values are the SDK per-network defaults: REST
  `https://mempool.space/api` (bitcoin), `https://mempool.space/testnet/api` (testnet3),
  `https://mempool.space/testnet4/api` (testnet4), `https://mempool.space/signet/api` (signet),
  `https://mutinynet.com/api` (mutinynet), `http://localhost:3000` (regtest); RPC
  `http://localhost:18443` (regtest only, no default credentials); CAS gateway `https://ipfs.io`.
- Timeouts have no defaults; `btc.timeoutMs` must be >= 1 ms and `cas.timeoutMs` >= 0 ms (`0`
  disables the CAS timeout). An invalid `--btc-timeout`/`--cas-timeout` value aborts.

By default the resolved RPC password prints as `********` and any `user:pass@` userinfo embedded
in the REST, RPC, or CAS endpoint URLs is masked; provenance still shows where each value came
from. `--show-secrets` reveals them. Despite constructing an API client, this subcommand performs
no network I/O.

```sh
btcr2 config effective -n mutinynet
btcr2 config effective -n regtest --show-secrets
```

### config path

Prints the resolved on-disk locations as `{ "home", "config", "keystore" }`:

- `home`: `--home` flag, else `$BTCR2_HOME`, else the platform default (`~/.btcr2` on
  Linux/macOS; `%LOCALAPPDATA%\btcr2` on Windows, falling back to `%APPDATA%\btcr2`, then
  `<user profile>\btcr2`). A blank value at any layer defers to the next.
- `config`: `-c/--config` flag, else `<home>/config.json`.
- `keystore`: `--keystore` flag, else the active profile's `identity.keystore`, else
  `<home>/keystore.json`. This is a diagnostic command, so the keystore lookup is lenient: a
  malformed config file falls back to the home default instead of aborting (keystore-mutating
  commands abort loudly in the same situation).

Never reads key material, never prompts for a passphrase, never touches the network.

```sh
btcr2 config path
BTCR2_HOME=/tmp/btcr2-demo btcr2 config path
```

### config doctor

Probes reachability of the resolved endpoints for one network (same network selection and
connection resolution as `config effective`). Read-only: it fetches status endpoints and never
writes or broadcasts. Each probe has a 5000 ms timeout. Checks performed:

- `btc-rest`: `GET <rest-host>/blocks/tip/height` with any configured REST headers.
- `btc-rpc`: a `getblockchaininfo` RPC call, only when an RPC client exists: an RPC URL supplied
  by any layer, or regtest (whose default host `http://localhost:18443` always creates one, so the
  probe always runs there). On other networks, credentials, a wallet name, or headers alone
  without an RPC URL do not create an RPC client and the check is skipped.
- `cas`: when a writable CAS RPC is configured, `POST <cas-rpc-url>/api/v0/version` (a Kubo node
  answers only POST); otherwise `GET` on the resolved gateway base URL (default
  `https://ipfs.io`).

Prints `{ "checks": [ { "endpoint", "target", "ok", "detail"? }, ... ] }` where `detail` carries
the HTTP status or error message for a failed check. Credentials embedded in endpoint URLs
(`scheme://user:pass@host`) are masked as `********` in both `target` and `detail`, matching the
redaction `config get`/`list`/`effective` apply. When the active profile declares a network
different from the one being probed, a `coherence` object
(`{ "profile", "declared", "encoding" }`) is included. Exit code is 1 when any check fails.

```sh
btcr2 config doctor -n mutinynet
btcr2 --profile regtest config doctor -n regtest
```

## Options

Subcommand-specific flags. Every subcommand also accepts `-h, --help`.

| Flag | Value | Default | Description |
|---|---|---|---|
| `--force` | boolean | `false` | `config init` only. Overwrite an existing config file instead of failing. |
| `--show-secrets` | boolean | `false` | `config get`, `config list`, `config effective`. Reveal secret values (RPC password, secret-named keys, URL-embedded credentials) instead of redacting them as `********`. |
| `-n, --network <network>` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | `defaults.network`, else the active profile's network, else `regtest` | `config effective`, `config doctor`. Network to resolve the connection config for. An unsupported value fails with `INVALID_ARGUMENT_ERROR`. |

Positionals:

| Positional | Subcommand | Value | Description |
|---|---|---|---|
| `[path]` | `config get` | dotted config path | Optional; omitted prints the whole config. |
| `<path>` | `config set`, `config unset` | dotted config path | Required. Segments `__proto__`, `constructor`, `prototype` are rejected. |
| `<value>` | `config set` | string | Parsed as JSON when valid unless the path is a known string-scalar leaf (see `config set`). |

## Environment & configuration

Environment variables consulted:

| Variable | Used by | Effect |
|---|---|---|
| `BTCR2_HOME` | all subcommands | Home directory holding `config.json` and `keystore.json`. Overridden by `--home`. |
| `BTCR2_OUTPUT` | all subcommands | Output format (`json` or `text`). Overridden by `-o/--output`; overrides config `defaults.output`. |
| `BTCR2_BTC_REST` | `effective`, `doctor` | Bitcoin REST endpoint override (as `--btc-rest`). |
| `BTCR2_BTC_RPC_URL` | `effective`, `doctor` | Bitcoin Core RPC endpoint override (as `--btc-rpc-url`). |
| `BTCR2_BTC_RPC_USER` | `effective`, `doctor` | RPC username (as `--btc-rpc-user`). |
| `BTCR2_BTC_RPC_PASS` | `effective`, `doctor` | RPC password (no flag equivalent; the value may itself be an `env:<VAR>` / `file:<path>` secret reference). Ignored (with a stderr warning) when a flag or profile layer supplies the RPC url or user, because credentials resolve as one atomic unit per layer. |
| `BTCR2_BTC_RPC_PASS_FILE` | `effective`, `doctor` | Path to a file whose contents are the RPC password; consulted only when no layer supplies a password and an RPC config is being built. Subject to the secret-file permission policy (0600/0400/0440/0640). |
| `BTCR2_CAS_GATEWAY` | `effective`, `doctor` | IPFS HTTP gateway for CAS reads (as `--cas-gateway`). |
| `BTCR2_CAS_RPC_URL` | `effective`, `doctor` | IPFS HTTP RPC endpoint for a writable CAS (as `--cas-rpc-url`). |
| `BTCR2_BTC_TIMEOUT` | `effective`, `doctor` | Bitcoin request timeout in ms, >= 1 (as `--btc-timeout`). |
| `BTCR2_CAS_TIMEOUT` | `effective`, `doctor` | CAS request timeout in ms, >= 0; `0` disables (as `--cas-timeout`). |

Known config-file keys (the schema `config set` validates against and `config validate` walks):

| Key | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Stamped to `1` on every write. A file with a newer version is refused by `get`, `set`, `unset`, `list`, `effective`, and `doctor`; `validate` reports it as a finding instead; `init` never reads the file (`--force` overwrites it); `path` falls back leniently to the default keystore path. |
| `defaults.profile` | string | Active profile when `--profile` is not given. |
| `defaults.network` | enum | `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`. Default network for `effective`/`doctor` (and for offline `create`). |
| `defaults.output` | enum | `json` or `text`. Default output format. |
| `profiles.<name>.network` | enum | The network a profile's endpoints target; drives the `doctor` coherence warning and default-network resolution. |
| `profiles.<name>.btc.rest` | string | Esplora REST endpoint. |
| `profiles.<name>.btc.rpcUrl` | string | Bitcoin Core RPC endpoint. |
| `profiles.<name>.btc.rpcUser` | string | RPC username. |
| `profiles.<name>.btc.rpcPass` | string | RPC password; accepts `env:<VAR>` / `file:<path>` secret references. Redacted in output. |
| `profiles.<name>.btc.feeRate` | number | Sats/vByte for beacon transactions (not read by `config` subcommands themselves). |
| `profiles.<name>.btc.changeAddress` | string | Beacon change address (not read by `config` subcommands themselves). |
| `profiles.<name>.btc.timeoutMs` | number | Bitcoin request timeout; no default (unbounded). |
| `profiles.<name>.btc.headers` | object | Extra REST headers, e.g. an API key. Secret-named header keys are redacted in output. |
| `profiles.<name>.btc.wallet` | string | Bitcoin Core wallet name for wallet-scoped RPCs. |
| `profiles.<name>.btc.rpcHeaders` | object | Extra Bitcoin Core RPC headers. |
| `profiles.<name>.cas.gateway` | string | IPFS HTTP gateway (read-only CAS). |
| `profiles.<name>.cas.rpcUrl` | string | IPFS HTTP RPC endpoint (writable CAS); takes precedence over the gateway. |
| `profiles.<name>.cas.timeoutMs` | number | CAS timeout; api default 30000 ms; `0` disables. |
| `profiles.<name>.identity.keystore` | string | Keystore path for this profile; feeds `config path`. |
| `profiles.<name>.identity.default` | string | Default signing-key reference (not read by `config` subcommands themselves). |

Precedence for every value `config effective` and `config doctor` resolve: CLI flag > environment
variable > config-file profile > built-in (SDK per-network) default. A blank value at any layer
defers to the next layer. The RPC URL, username, and password are bound together from a single
layer (never mixed across layers). The active profile is `--profile`, else `defaults.profile`;
when neither is set, the profile named after the resolved network is used for connection values.

The file-editing subcommands (`init`, `get`, `set`, `unset`, `list`, `validate`) operate on the
file itself, so only `--home`/`$BTCR2_HOME` and `-c/--config` affect them; endpoint flags and env
vars never change what is stored or printed from the file.

Passphrase and session: no `config` subcommand reads the keystore contents, prompts for a
passphrase, or consults the session cache. `config path` reports the keystore location only.

## Global options

See the [docs README](./README.md#global-options) for the shared global flags. Notable interactions
here: `--home` and `-c/--config` select the file every subcommand operates on; `--profile` selects
the active profile for `effective`, `doctor`, and the keystore path in `config path`;
`--keystore` overrides the keystore path `config path` reports; `-o/--output` switches text/json;
`--quiet` suppresses the unknown-path warning from `config set`; `--verbose` prints full error
objects; and the connection override flags (`--btc-rest`, `--btc-rpc-url`, `--btc-rpc-user`,
`--btc-rpc-wallet`, `--btc-rest-header`, `--btc-rpc-header`, `--btc-timeout`,
`--cas-gateway`, `--cas-rpc-url`, `--cas-timeout`) feed the `flag` layer of `effective` and
`doctor`.

## Examples

```sh
# Scaffold a config, pick mutinynet as the default network
btcr2 config init
btcr2 config set defaults.network mutinynet

# Point the mutinynet profile at explicit endpoints and a fee rate
btcr2 config set profiles.mutinynet.btc.rest 'https://mutinynet.com/api'
btcr2 config set profiles.mutinynet.btc.feeRate 2

# Store an RPC credential as a secret reference (resolved at connection time)
btcr2 config set profiles.regtest.btc.rpcUser 'polaruser'
btcr2 config set profiles.regtest.btc.rpcPass 'env:BTC_RPC_PASS'

# Inspect: stored values (redacted), then what a live command would actually use
btcr2 config get profiles.mutinynet
btcr2 config effective -n mutinynet

# Check the file for typos and unknown keys (exit 1 on findings)
btcr2 config validate

# Where is my state? Which endpoints are reachable?
btcr2 config path
btcr2 config doctor -n mutinynet

# Machine-readable output
btcr2 -o json config list

# A sandboxed home for experiments (never touches ~/.btcr2)
BTCR2_HOME=/tmp/btcr2-demo btcr2 config init
```

## See also

- `btcr2 init`: seeds the same config scaffold plus a keystore and a default network.
- `btcr2 quickstart`: one-shot init + keystore + key + doctor for a chosen network.
- `btcr2 profile`: add/use/show/remove profiles (a task-focused layer over the same file).
- `btcr2 keystore`: keystore lifecycle and session status for the path `config path` reports.
- [README.md](./README.md) for the full global-flag reference and configuration setup; the
  [package README](../README.md) for installation.
- [DEMO.md](./DEMO.md) for an end-to-end walkthrough that exercises the config workflow.
