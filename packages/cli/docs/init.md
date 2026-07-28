# btcr2 init

`btcr2 init` is the one-command entry point that sets up the btcr2 home: it creates the home
directory (mode `0700`), writes a default `config.json` if none exists, and establishes the
keystore if none exists (encrypted under a confirmed passphrase by default, or unencrypted with
`--dev` for disposable testnet material). With `-n/--network` it also records the chosen network as
`defaults.network` in the config so later commands can omit `-n`. The command is idempotent:
re-running it leaves existing files untouched (`--force` re-creates only the regenerable config,
never the keystore), so it is safe to run before any other command and is the expected first step
of a fresh installation, ahead of `btcr2 key generate --set-active` and `btcr2 create`.

## Synopsis

```
btcr2 [global options] init [-n <network>] [--dev] [--force]
btcr2 init --help
```

`init` takes no positional arguments and has no subcommands; a stray argument fails with
`too many arguments for 'init'. Expected 0 arguments but got 1.`

## Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-n, --network <network>` | One of `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest` | none (nothing is written; see fallback below) | Bitcoin network to record as `defaults.network` in the config file. The write is idempotent: it only happens when the flag value differs from the raw `defaults.network` already on disk. Any other value fails with `Invalid network "<value>". Must be one of bitcoin, testnet3, testnet4, signet, mutinynet, regtest.` (exit code 1). When the flag is omitted, `init` never writes `defaults.network`; the network it reports is the existing `defaults.network` if set, else the active profile's network, else the built-in `regtest`. |
| `--dev` | boolean flag | `false` | Establish an UNENCRYPTED dev keystore: keys are stored as plaintext, no passphrase is ever prompted for. Prints a warning to stderr (suppressed by `--quiet`). Mainnet (`bitcoin`) operations are hard-refused against a dev keystore by later commands. Only applies when a keystore is being established in this run; it does not convert an existing keystore. |
| `--force` | boolean flag | `false` | Re-create the config scaffold even if `config.json` already exists. This overwrites the file with the pristine scaffold, discarding any customizations it held, including a previously recorded `defaults.network` (pass `-n` in the same run to keep one recorded). The keystore is NEVER touched by `--force`; if one exists, a note is printed to stderr (suppressed by `--quiet`) pointing at `btcr2 keystore init --force` for a deliberate re-establishment. |
| `-h, --help` | | | Display help for the command. |

**Scaffolding rules.** The home directory is created (recursively, `0700`) if absent. The config is
written only when absent or when `--force` is given; the scaffold is `schemaVersion: 1`,
`defaults.output: "text"`, and one empty profile per supported network (`bitcoin`, `testnet3`,
`testnet4`, `signet`, `mutinynet`, `regtest`). The keystore is established only when no file exists
at the resolved keystore path, regardless of `--force`. All file writes are atomic (temp sibling +
rename) with file mode `0600` and directory mode `0700`.

**Passphrase establishment.** When a fresh encrypted keystore is established (no `--dev`), the
passphrase is acquired in this order: the `BTCR2_KEYSTORE_PASSPHRASE` environment variable, then
the file named by `--passphrase-file`, then a hidden interactive prompt entered twice
(`New keystore passphrase: `, `Confirm passphrase: `). A trailing newline is trimmed from env and
file sources. Failure modes, each exit code 1: no source available and stdin is not a terminal
(`No passphrase available. Set BTCR2_KEYSTORE_PASSPHRASE, pass --passphrase-file, or run in a
terminal.`), mismatched confirmation (`Passphrases did not match.`), and an empty or
whitespace-only passphrase (`A non-empty keystore passphrase is required.`). Ctrl-C during the
prompt aborts. A cached session is never consulted during establishment. Whenever a keystore is
established (encrypted or dev), any cached session file at `<home>/session.json` is deleted, since
it could only belong to a keystore that no longer exists.

**Output.** In text mode (the default), stdout is the pretty-printed data payload:

```json
{
  "home": "/home/user/.btcr2",
  "config": "/home/user/.btcr2/config.json",
  "keystore": "/home/user/.btcr2/keystore.json",
  "network": "mutinynet",
  "created": ["config", "keystore"],
  "protection": "encrypted"
}
```

followed by a next-step hint on stderr (suppressed by `--quiet`):
`btcr2 home ready at <home> on <network>. Next: btcr2 key generate --set-active`. In JSON mode
(`-o json`), stdout is the same payload wrapped as `{ "action": "init", "data": { ... } }` and the
next-step hint is not printed; the `--dev` warning and the `--force` keystore-left-intact note
still go to stderr in JSON mode unless `--quiet` is given. `created` lists what this run actually
wrote (a subset of `config` and `keystore`; empty on an idempotent re-run). `protection` is the
keystore's protection label read structurally after the run: `encrypted` (passphrase-sealed),
`dev` (plaintext), or `absent` (only possible when a pre-existing file at the keystore path is not
a keystore this CLI recognizes; `init` leaves such a file intact). `init` prints no faucet or
explorer hints; those come from `btcr2 create` and `btcr2 quickstart`.

**Error conditions from an existing config.** If a config file exists but is not valid JSON, `init`
aborts (exit 1) with `Config file at <path> is not valid JSON: ... Fix the file by hand; the CLI
will not overwrite it while it is unparseable.`; `--force` alone does not bypass this. A config
written by a newer CLI (`schemaVersion` greater than 1) is likewise refused with a message to
upgrade. Exception: both refusals are raised while resolving the keystore path from the config, so
passing an explicit `--keystore` together with `--force` skips that read and DOES overwrite the
unparseable (or newer-schema) config with the pristine scaffold.

## Environment & configuration

Environment variables consulted:

| Variable | Role |
|----------|------|
| `BTCR2_HOME` | Home directory when `--home` is absent. A blank value is ignored. |
| `BTCR2_KEYSTORE_PASSPHRASE` | Passphrase for establishing a fresh encrypted keystore. Consulted BEFORE `--passphrase-file` (for the passphrase specifically, the env var outranks the flag-named file). |
| `BTCR2_OUTPUT` | Output format (`json` or `text`) when `-o/--output` is absent. |

The Bitcoin/CAS endpoint variables (`BTCR2_BTC_REST`, `BTCR2_BTC_RPC_*`, `BTCR2_CAS_*`,
`BTCR2_FEE_RATE`) are not consulted: `init` performs no network I/O.

Config-file keys read (from an existing config, if any):

| Key | Role |
|-----|------|
| `defaults.network` | Reported as the resolved network when `-n` is absent; left untouched. |
| `defaults.profile` | Selects the active profile when `--profile` is absent. |
| `profiles.<name>.network` | The active profile's declared network: the network fallback when neither `-n` nor `defaults.network` is set. A profile named after a network counts as declaring it. |
| `profiles.<name>.identity.keystore` | Keystore path when `--keystore` is absent. |
| `defaults.output` | Output format fallback when neither `-o` nor `BTCR2_OUTPUT` is set. |

Config-file keys written:

| Key | When |
|-----|------|
| whole scaffold (`schemaVersion`, `defaults.output`, empty `profiles.*`) | Config absent, or `--force`. |
| `defaults.network` | `-n` given and its value differs from the raw on-disk value. |

Precedence (highest wins):

- Home directory: `--home` flag > `BTCR2_HOME` > platform default (`~/.btcr2` on Linux/macOS;
  `%LOCALAPPDATA%\btcr2` on Windows, falling back to `%APPDATA%\btcr2`, then the user profile).
- Config path: `--config` flag > `<home>/config.json`.
- Keystore path: `--keystore` flag > active profile's `identity.keystore` > `<home>/keystore.json`.
- Network recorded/reported: `-n` flag > existing `defaults.network` > active profile's network >
  built-in `regtest`. Only the `-n` layer ever writes.
- Passphrase source: `BTCR2_KEYSTORE_PASSPHRASE` > `--passphrase-file` > interactive prompt.
- Output format: `-o` flag > `BTCR2_OUTPUT` > config `defaults.output` > built-in `text`.

The session file is always `<home>/session.json`, derived from the home root alone (never from
`--config`, `--keystore`, or the config file).

## Global options

See the [docs README](./README.md#global-options) for the shared global flags; `init` notably interacts
with `--home`, `-c/--config`, `--keystore`, `--profile`, `--passphrase-file`, `-o/--output`,
`--quiet` (suppresses the stderr hint, the `--dev` warning, and the `--force` keystore note), and
`--verbose` (full error objects on failure).

## Examples

```sh
# First-time setup on mutinynet: prompts twice for a new keystore passphrase
btcr2 init -n mutinynet

# Unattended setup: passphrase from a secrets file
btcr2 --passphrase-file /run/secrets/btcr2-pass init -n mutinynet

# Unattended setup: passphrase from the environment
BTCR2_KEYSTORE_PASSPHRASE='correct horse battery staple' btcr2 init -n mutinynet

# Disposable local development: unencrypted dev keystore on regtest
btcr2 init --dev -n regtest

# Sandboxed home for experiments (real ~/.btcr2 untouched)
BTCR2_HOME=/tmp/btcr2-sandbox btcr2 init -n mutinynet

# Repair a hand-edited config: re-scaffold it (keystore untouched).
# Re-pass -n, or the previously recorded defaults.network is lost with the old file.
btcr2 init --force -n mutinynet

# Machine-readable result
btcr2 -o json init -n mutinynet
```

## See also

- `btcr2 quickstart`: one-command onboarding built on the same scaffolding step, with optional
  session unlock and endpoint probing (defaults the network to mutinynet).
- `btcr2 keystore init`: establish or deliberately re-establish just the keystore
  (`--force` there DOES discard existing keys).
- `btcr2 keystore status` / `btcr2 keystore unlock` / `btcr2 keystore lock`: inspect the keystore
  and manage the cached passphrase session.
- `btcr2 config init`: write just the default config scaffold.
- `btcr2 key generate --set-active`: the suggested next step after `init`.
- [README.md](./README.md) for global flags, environment variables, and configuration setup.
- [DEMO.md](./DEMO.md) for a full walkthrough that starts from `init`/`quickstart`.
