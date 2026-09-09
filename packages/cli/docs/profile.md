# btcr2 profile

Manages the named profiles in the config file of the CLI. A profile is a set of connection and identity settings: the Bitcoin REST and RPC endpoints, the CAS endpoints, the fee and timeout values, and the keystore and signing key references. The other commands resolve these settings at run time. `profile` itself only creates, selects, shows, and deletes a profile. `btcr2 config set` edits the keys inside a profile. The command group is offline: it opens no network connection, never touches the keystore, and never asks for a passphrase. Its only side effect is an atomic read, change, and write of the config file.

## Synopsis

```
btcr2 profile [options] [command]

btcr2 profile add <name>                      # create an empty profile
btcr2 profile use <name>                      # set the active profile (writes defaults.profile)
btcr2 profile show [--show-secrets] [name]    # print a profile (default: the active profile)
btcr2 profile remove <name>                   # delete a profile
btcr2 profile rm <name>                       # alias of remove
btcr2 profile help [command]                  # the help of the group or of a subcommand
```

## Subcommands

### add

```
btcr2 profile add <name>
```

Creates `profiles.<name>` as an empty object `{}` in the config file. If the file does not exist yet, the command creates it. This is the same atomic write path as each config change: a temporary file and a rename, file mode `0600`, parent directory `0700`, a `schemaVersion: 1` stamp, and the unknown keys of an existing file kept. If `profiles.<name>` exists, the command fails with `Profile "<name>" already exists.` on stderr and exit code 1, and it does not write the file.

`<name>` is any string. The CLI does not validate it. The CLI also accepts an empty name: `btcr2 profile add ''` succeeds and creates a profile with the empty string as its key. `profile show ''` cannot reach that profile. An empty argument bypasses the `defaults.profile` fallback, but it still fails the empty check. So it always fails with `No profile specified and no active profile is set.`, also if an active profile is set.

Two name conventions have a meaning elsewhere in the CLI:

- A profile with the name of a supported network (`bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`) is the profile of an operation on that network if no profile is active. Its name implies its network.
- A profile with another name (for example `production`) can declare its network with the `network` key inside it (`btcr2 config set profiles.production.network mutinynet`).

`add` does not activate the profile. Run `btcr2 profile use` if you want it active.

The output payload: `{ "profile": "<name>" }` (JSON mode: `{ "action": "profile-add", "data": { "profile": "<name>" } }`).

### use

```
btcr2 profile use <name>
```

Writes `defaults.profile = <name>` in the config file. `<name>` becomes the active profile of each later command against this config file, unless the global `--profile` flag overrides it for one invocation. The subcommand does not check that `profiles.<name>` exists. A `defaults.profile` that points at a profile that was never added succeeds, and it resolves to an empty override set later (the source behavior, confirmed at run time). The command creates the `defaults` object, and the config file itself, if they are absent.

The output payload: `{ "profile": "<name>" }` (the JSON action: `profile-use`).

### show

```
btcr2 profile show [options] [name]
```

Reads the config file and prints one profile. The target is the `name` argument if present, else `defaults.profile` of the config file. The fallback reads `defaults.profile` from the file directly. `profile show` does not read the global `--profile` flag (the source wins here, so pass the name as the argument).

The error conditions, each on stderr with exit code 1:

- No `name` argument and no `defaults.profile`: `No profile specified and no active profile is set.`
- The target is not under `profiles`: `Profile "<target>" not found.`

The printed payload is `{ "profile": "<target>", ...<the profile content> }`. By default, the command redacts each secret value in the output only (the stored file stays the same):

- A scalar under a key whose name matches the pattern `pass|secret|token|auth|api-key|api_key|apikey|credential|bearer` (case-insensitive) prints as `********`. This covers `btc.rpcPass` and a credential header name (for example an `Authorization` entry inside `btc.headers` or `btc.rpcHeaders`).
- A password in a URL value (`scheme://user:pass@host`, for example in `btc.rpcUrl`) prints as `scheme://user:********@host`, whatever the key name.

`--show-secrets` disables both redactions and prints the stored values as they are.

The JSON action: `profile-show`.

### remove

```
btcr2 profile remove <name>
btcr2 profile rm <name>          # alias
```

Deletes `profiles.<name>` from the config file. If the profile does not exist, the command fails with `Profile "<name>" not found.` (stderr, exit code 1). The removal does not touch `defaults.profile`. If the removed profile was active, `defaults.profile` still points at the missing name until you run `btcr2 profile use` again. A later `profile show` then fails with the not-found error above.

The output payload: `{ "profile": "<name>" }` (the JSON action: `profile-remove`).

## Options

Only `show` has a flag of its own. The other subcommands take their argument only.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<name>` (the argument, required for `add`, `use`, `remove`) | any string, not validated (the CLI accepts an empty name, but `show` cannot reach it, see [add](#add)). A name equal to a supported network (`bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest`) also implies that network. | none | The profile to create, activate, or delete. |
| `[name]` (the argument, optional for `show`) | an existing profile name | `defaults.profile` of the config file | The profile to print. If the argument is absent and no active profile is set, the command fails. |
| `--show-secrets` (`show` only) | boolean | `false` | Show the secret values (the RPC password, a credential header, a URL userinfo) instead of the `********` redaction. |
| `-h, --help` | none | n/a | Print the help of the group or of the subcommand and exit. |

## Environment and configuration

The config file location (all four subcommands read this one file, and all except `show` write it):

1. The `-c, --config <path>` global flag, if present, names the file.
2. Otherwise `<home>/config.json`. The home directory is the `--home <dir>` flag, then the `BTCR2_HOME` environment variable, then the platform default. The platform default is `~/.btcr2` on Linux and macOS. On Windows it is `%LOCALAPPDATA%\btcr2`, else `%APPDATA%\btcr2`, else `<user profile>\btcr2`. A blank value at one layer defers to the next layer.

The config keys that the command group reads and writes:

- `profiles.<name>`: `add` creates it empty, `remove` deletes it, `show` prints it.
- `defaults.profile`: `use` writes it. `show` reads it as the default target.
- `schemaVersion`: each write stamps it to `1`. The command group refuses a file with a `schemaVersion` above 1 at read time (`CONFIG_SCHEMA_VERSION_ERROR`), so no subcommand writes a file from a newer CLI. The command group also refuses a file that exists but is not valid JSON (`Config file at <path> is not valid JSON: ... Fix the file by hand; the CLI will not overwrite it while it is unparseable.`), so a change never overwrites a malformed file that a person can repair. An absent file starts as `{}`.
- `defaults.output`: the shared output format resolution reads it (see below).

The environment variables that the command group reads:

- `BTCR2_HOME`: the default home directory (see above). `--home` wins.
- `BTCR2_OUTPUT`: the output format if `-o/--output` is absent. The full precedence of the printed format: the `-o/--output` flag, then `BTCR2_OUTPUT`, then config `defaults.output`, then `text`.

The `profile` group reads none of the Bitcoin and CAS connection variables (`BTCR2_BTC_REST`, `BTCR2_BTC_RPC_URL`, `BTCR2_BTC_RPC_USER`, `BTCR2_BTC_RPC_PASS`, `BTCR2_BTC_RPC_PASS_FILE`, `BTCR2_BTC_SIGNAL_DISCOVERY`, `BTCR2_CAS_GATEWAY`, `BTCR2_CAS_RPC_URL`, `BTCR2_BTC_TIMEOUT`, `BTCR2_CAS_TIMEOUT`, `BTCR2_FEE_RATE`). It manages the profiles that those settings merge with later. It has no keystore, passphrase, or session interaction, and it prints no network hint (no faucet or explorer URL).

The keys that a profile can hold (`btcr2 config set` and `btcr2 config validate` validate them, and `profile show` prints what is stored):

| Profile key | Value |
|-------------|-------|
| `network` | one of `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest` |
| `btc.rest`, `btc.rpcUrl`, `btc.rpcUser`, `btc.rpcPass`, `btc.changeAddress`, `btc.wallet` | string |
| `btc.feeRate` (sats/vByte), `btc.timeoutMs` | number |
| `btc.headers`, `btc.rpcHeaders` | object (a header map) |
| `btc.signalDiscovery` | `"indexer"` or `"fullnode"` (the source of the beacon signals. `fullnode` scans blocks over Bitcoin Core RPC) |
| `cas.gateway`, `cas.rpcUrl` | string |
| `cas.timeoutMs` | number (`0` disables the timeout) |
| `identity.keystore`, `identity.default` | string (the keystore path, the signing key reference) |

How the other commands use the active profile: the connection resolution takes the profile that the global `--profile` flag names, else `defaults.profile`, else the profile with the name of the network of the operation. A profile value sits at the bottom of the override chain: the flag, then the environment variable, then the profile, then the built-in default of the network.

The output modes: in `text` mode, each subcommand prints its data payload as pretty JSON (each payload is an object, so text and JSON mode differ in the wrapper only). In `json` mode, the command prints the full `{ "action": "profile-<sub>", "data": ... }` result. An error goes to stderr as a bare message with exit code 1. The global `--verbose` flag prints the full error object instead. `--quiet` does not change the `profile` output.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. The `profile` subcommands use `--home` and `-c/--config` (the file that the command reads and writes), `-o/--output` (the payload wrapper), and `--verbose` (the error detail). The global `--profile` flag does not select the target of `profile show`. Use the `name` argument.

## Examples

```sh
# Create and activate a mutinynet profile, then set its endpoints.
btcr2 profile add mutinynet
btcr2 profile use mutinynet
btcr2 config set profiles.mutinynet.btc.rest 'https://mutinynet.com/api'

# Show the active profile (secrets redacted), then with the secrets.
btcr2 profile show
btcr2 profile show --show-secrets

# Show one profile as machine-readable JSON.
btcr2 profile show mutinynet -o json

# A profile with a custom name that declares mutinynet.
btcr2 profile add production
btcr2 config set profiles.production.network mutinynet
btcr2 profile use production

# Manage the profiles in a sandbox home instead of ~/.btcr2.
BTCR2_HOME=/tmp/btcr2-sandbox btcr2 profile add demo

# Remove a profile (rm is an alias).
btcr2 profile rm demo
```

## See also

- `btcr2 config` (`init`, `get`, `set`, `unset`, `list`/`ls`, `validate`, `effective`, `path`, `doctor`): edits and inspects the keys inside a profile, and shows the merged connection config with the source of each value.
- `btcr2 init` and `btcr2 quickstart`: write a config file that already contains one empty profile per supported network.
- [DEMO.md](./DEMO.md): the walkthrough that uses profiles in the CLI lifecycle.
