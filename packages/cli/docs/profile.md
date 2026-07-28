# btcr2 profile

Manages named configuration profiles inside the CLI's `config.json`. A profile is a bundle of
connection and identity settings (Bitcoin REST/RPC endpoints, CAS endpoints, fee and timeout
knobs, keystore and signing-key references) that other commands resolve at run time. `profile`
itself only creates, selects, shows, and deletes these bundles; the keys inside a profile are
edited with `btcr2 config set`. The command group is fully offline: it opens no network
connection, never touches the keystore, and never prompts for a passphrase. Its only side effect
is an atomic read-modify-write of the config file.

## Synopsis

```
btcr2 profile [options] [command]

btcr2 profile add <name>                      # create an empty profile
btcr2 profile use <name>                      # set the active profile (writes defaults.profile)
btcr2 profile show [--show-secrets] [name]    # print a profile (defaults to the active one)
btcr2 profile remove <name>                   # delete a profile
btcr2 profile rm <name>                       # alias of remove
btcr2 profile help [command]                  # help for the group or a subcommand
```

## Subcommands

### add

```
btcr2 profile add <name>
```

Creates `profiles.<name>` as an empty object `{}` in the config file. If the file does not exist
yet, it is created (this is the same atomic write path every config mutation uses: temp file plus
rename, file mode `0600`, parent directory `0700`, `schemaVersion: 1` stamped, unknown keys in an
existing file preserved). If `profiles.<name>` already exists, the command fails with
`Profile "<name>" already exists.` on stderr and exit code 1, and the file is not written.

`<name>` is an arbitrary string; the CLI does not validate it. In particular an empty name is not
rejected: `btcr2 profile add ''` succeeds and creates a profile keyed by the empty string, which
`profile show ''` then cannot target because an empty positional is treated as omitted (it falls
back to `defaults.profile` or errors with `No profile specified and no active profile is set.`).
Two naming conventions carry extra meaning elsewhere in the CLI:

- A profile named after a supported network (`bitcoin`, `testnet3`, `testnet4`, `signet`,
  `mutinynet`, `regtest`) is auto-selected as the profile for operations on that network when no
  profile is explicitly active, and its name implies its target network.
- A profile with any other name (for example `production`) can still pin its target network by
  setting the `network` key inside it (`btcr2 config set profiles.production.network mutinynet`).

Adding a profile does not activate it; follow with `btcr2 profile use` if you want it active.

Output payload: `{ "profile": "<name>" }` (json mode wraps it as
`{ "action": "profile-add", "data": { "profile": "<name>" } }`).

### use

```
btcr2 profile use <name>
```

Writes `defaults.profile = <name>` in the config file, making `<name>` the active profile for
every later command run against this config (unless overridden per invocation with the global
`--profile` flag). The subcommand does not verify that `profiles.<name>` exists: pointing
`defaults.profile` at a profile that was never added succeeds and simply resolves to an empty
override set later (source behavior, confirmed at runtime). Creates the `defaults` object, and the
config file itself, if absent.

Output payload: `{ "profile": "<name>" }` (json action: `profile-use`).

### show

```
btcr2 profile show [options] [name]
```

Reads the config file and prints one profile. The target is the positional `name` when given,
otherwise the config file's `defaults.profile`. Note that the target fallback reads
`defaults.profile` from the file directly: the global `--profile` flag is not consulted by
`profile show` (source wins here; pass the name positionally instead).

Error conditions, each printed to stderr with exit code 1:

- No positional name and no `defaults.profile` set:
  `No profile specified and no active profile is set.`
- Target not present under `profiles`: `Profile "<target>" not found.`

The printed payload is `{ "profile": "<target>", ...<profile contents> }`. By default all secret
values are redacted for display only (the stored file is untouched):

- Scalar values under any key matching the pattern
  `pass|secret|token|auth|api-key|api_key|apikey|credential|bearer` (case-insensitive) are
  replaced with `********`. This catches `btc.rpcPass` as well as credential-bearing header names
  (for example an `Authorization` entry inside `btc.headers` or `btc.rpcHeaders`).
- A password embedded in a URL value (`scheme://user:pass@host`, for example in `btc.rpcUrl`) is
  scrubbed to `scheme://user:********@host` regardless of the key name.

`--show-secrets` disables both redactions and prints the stored values verbatim.

Output json action: `profile-show`.

### remove

```
btcr2 profile remove <name>
btcr2 profile rm <name>          # alias
```

Deletes `profiles.<name>` from the config file. Fails with `Profile "<name>" not found.` (stderr,
exit code 1) when it does not exist. Removal does not touch `defaults.profile`: if the removed
profile was active, `defaults.profile` keeps pointing at the now-missing name until you run
`btcr2 profile use` again (later `profile show` calls then fail with the not-found error above).

Output payload: `{ "profile": "<name>" }` (json action: `profile-remove`).

## Options

Only `show` defines a flag of its own; the other subcommands take just their positional argument.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<name>` (positional; required for `add`, `use`, `remove`) | any string, not validated (an empty name is accepted but unreachable via `show`; see [add](#add)); names equal to a supported network (`bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest`) additionally imply that network | none | The profile to create, activate, or delete. |
| `[name]` (positional; optional for `show`) | an existing profile name | the config file's `defaults.profile` | The profile to print. When omitted and no active profile is set, the command errors. |
| `--show-secrets` (`show` only) | none (boolean) | `false` | Reveal secret values (RPC password, credential headers, URL userinfo) instead of redacting them to `********`. |
| `-h, --help` | none | n/a | Print usage for the group or subcommand and exit. |

## Environment & configuration

Config file location (all four subcommands read and, except `show`, write this one file):

1. `-c, --config <path>` global flag, when given, names the file outright.
2. Otherwise `<home>/config.json`, where the home directory resolves as
   `--home <dir>` flag > `BTCR2_HOME` env var > platform default (`~/.btcr2` on Linux/macOS;
   `%LOCALAPPDATA%\btcr2` on Windows, falling back to `%APPDATA%\btcr2`, then
   `<user profile>\btcr2`).
   A blank value at any layer defers to the next.

Config keys this command reads and writes:

- `profiles.<name>`: created empty by `add`, deleted by `remove`, printed by `show`.
- `defaults.profile`: written by `use`; read by `show` as the default target.
- `schemaVersion`: stamped to `1` on every write. A file whose `schemaVersion` is greater than 1
  is refused on read (`CONFIG_SCHEMA_VERSION_ERROR`), so no subcommand can rewrite a file from a
  newer CLI. A file that exists but is not valid JSON also refuses to load
  (`Config file at <path> is not valid JSON: ... Fix the file by hand; the CLI will not overwrite
  it while it is unparseable.`), so a mutation can never clobber a malformed-but-recoverable file.
  A genuinely absent file starts from `{}`.
- `defaults.output`: read indirectly by the shared output-format resolution (below).

Environment variables consulted:

- `BTCR2_HOME`: default home directory (see above). Overridden by `--home`.
- `BTCR2_OUTPUT`: output format when `-o/--output` is not passed. Full precedence for the printed
  format: `-o/--output` flag > `BTCR2_OUTPUT` > config `defaults.output` > `text`.

The `profile` group consults none of the Bitcoin or CAS connection variables (`BTCR2_BTC_REST`,
`BTCR2_BTC_RPC_URL`, `BTCR2_BTC_RPC_USER`, `BTCR2_BTC_RPC_PASS`, `BTCR2_BTC_RPC_PASS_FILE`,
`BTCR2_CAS_GATEWAY`, `BTCR2_CAS_RPC_URL`, `BTCR2_BTC_TIMEOUT`, `BTCR2_CAS_TIMEOUT`,
`BTCR2_FEE_RATE`); it manages the profiles those settings later merge with. It has no keystore,
passphrase, or session interaction, and prints no network hints (faucet or explorer URLs).

Keys a profile can hold (validated by `btcr2 config set` and `btcr2 config validate`; `profile
show` prints whatever is stored):

| Profile key | Value |
|-------------|-------|
| `network` | one of `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest` |
| `btc.rest`, `btc.rpcUrl`, `btc.rpcUser`, `btc.rpcPass`, `btc.changeAddress`, `btc.wallet` | string |
| `btc.feeRate` (sats/vByte), `btc.timeoutMs` | number |
| `btc.headers`, `btc.rpcHeaders` | object (header map) |
| `cas.gateway`, `cas.rpcUrl` | string |
| `cas.timeoutMs` | number (`0` disables) |
| `identity.keystore`, `identity.default` | string (keystore path; signing-key reference) |

How the active profile is consumed elsewhere (for context): connection resolution picks the
profile named by the global `--profile` flag, else `defaults.profile`, else the profile whose name
equals the operation's network. Profile values sit at the bottom of the override chain:
flag > env var > profile config > built-in network default.

Output modes: in `text` mode each subcommand prints its data payload as pretty-printed JSON (the
payloads are objects, so text and json modes differ only in the wrapper); in `json` mode the full
`{ "action": "profile-<sub>", "data": ... }` result is printed. Errors go to stderr as a bare
message with exit code 1; the global `--verbose` flag prints the full error object instead.
`--quiet` does not change `profile` output.

## Global options

Shared global flags are documented in the [docs README](./README.md#global-options). Globals this command notably
interacts with: `--home`, `-c/--config` (which file is read and written), `-o/--output` (payload
wrapper), `--verbose` (error detail). The global `--profile` flag does not select the target for
`profile show`; use the positional name.

## Examples

```sh
# Create and activate a mutinynet profile, then wire its endpoints.
btcr2 profile add mutinynet
btcr2 profile use mutinynet
btcr2 config set profiles.mutinynet.btc.rest 'https://mutinynet.com/api'

# Inspect the active profile (secrets redacted), then with secrets revealed.
btcr2 profile show
btcr2 profile show --show-secrets

# Inspect a specific profile as machine-readable JSON.
btcr2 profile show mutinynet -o json

# A non-network profile pinned to mutinynet.
btcr2 profile add production
btcr2 config set profiles.production.network mutinynet
btcr2 profile use production

# Manage profiles in a sandboxed home instead of ~/.btcr2.
BTCR2_HOME=/tmp/btcr2-sandbox btcr2 profile add demo

# Remove a profile (rm is an alias).
btcr2 profile rm demo
```

## See also

- `btcr2 config` (`init`, `get`, `set`, `unset`, `list`/`ls`, `validate`, `effective`, `path`,
  `doctor`): edits
  and inspects the keys inside profiles, and shows the fully merged connection config with
  per-value provenance.
- `btcr2 init` and `btcr2 quickstart`: scaffold a config file that already contains one empty
  profile per supported network.
- [DEMO.md](./DEMO.md): end-to-end walkthrough that uses profiles as part of the full CLI lifecycle.
