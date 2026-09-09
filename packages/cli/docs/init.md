# btcr2 init

`btcr2 init` sets up the home in one command. It creates the home directory (mode `0700`). It writes a default `config.json` if none exists. It creates the keystore if none exists: encrypted under a confirmed passphrase by default, or unencrypted with `--dev` for throwaway test-network keys. With `-n/--network`, it also records the network as `defaults.network` in the config file, so that a later command can omit `-n`.

The command is idempotent. A second run does not touch the existing files. `--force` writes the config file again, never the keystore. So the command is safe before any other command. It is the expected first step of a fresh installation, before `btcr2 key generate --set-active` and `btcr2 create`.

## Synopsis

```
btcr2 [global flags] init [-n <network>] [--dev] [--force]
btcr2 init --help
```

`init` takes no arguments and has no subcommands. An extra argument fails with `too many arguments for 'init'. Expected 0 arguments but got 1.`

## Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-n, --network <network>` | One of `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest` | none (the command writes nothing, see the fallback below) | The Bitcoin network to record as `defaults.network` in the config file. The write is idempotent: it happens only if the flag value differs from the raw `defaults.network` on disk. Another value fails with `Invalid network "<value>". Must be one of bitcoin, testnet3, testnet4, signet, mutinynet, regtest.` (exit code 1). Without the flag, `init` never writes `defaults.network`. The network that it reports is then the existing `defaults.network`, else the network of the active profile, else the built-in `regtest`. |
| `--dev` | boolean | `false` | Create an UNENCRYPTED dev keystore: the keys are plaintext, and no command asks for a passphrase. The command prints a warning on stderr (`--quiet` suppresses it). A later command refuses a mainnet (`bitcoin`) operation with a dev keystore. The flag applies only if this run creates a keystore. It does not convert an existing keystore. |
| `--force` | boolean | `false` | Write the config scaffold again, also if `config.json` exists. This overwrites the file with the default scaffold and removes each customization in it, also a recorded `defaults.network` (pass `-n` in the same run to record one). `--force` NEVER touches the keystore. If a keystore exists, the command prints a note on stderr (`--quiet` suppresses it) that points at `btcr2 keystore init --force` for a deliberate re-creation. |
| `-h, --help` | | | Print the help of the command. |

**Scaffold rules.** The command creates the home directory (recursively, `0700`) if it is absent. It writes the config file only if the file is absent or if `--force` is present. The scaffold is `schemaVersion: 1`, `defaults.output: "text"`, and one empty profile per supported network (`bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`). The command creates the keystore only if no file exists at the resolved keystore path, with or without `--force`. Each file write is atomic (a temporary file next to the target, then a rename) with file mode `0600` and directory mode `0700`.

**Passphrase.** If the run creates an encrypted keystore (no `--dev`), the command gets the passphrase in this order: the `BTCR2_KEYSTORE_PASSPHRASE` environment variable, then the file that `--passphrase-file` names, then a hidden interactive prompt, entered twice (`New keystore passphrase: `, `Confirm passphrase: `). The CLI trims a trailing newline from the environment and file sources. The failure modes, each with exit code 1: no source and stdin is not a terminal (`No passphrase available. Set BTCR2_KEYSTORE_PASSPHRASE, pass --passphrase-file, or run in a terminal.`), a confirmation that does not match (`Passphrases did not match.`), and an empty or whitespace-only passphrase (`A non-empty keystore passphrase is required.`). Ctrl-C at the prompt stops the command. The command never reads a cached session for the first passphrase. Each time the command creates a keystore (encrypted or dev), it deletes a cached session file at `<home>/session.json`. That session can only belong to a keystore that no longer exists.

**Output.** In text mode (the default), stdout is the data payload as pretty JSON:

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

Then a next-step hint follows on stderr (`--quiet` suppresses it): `btcr2 home ready at <home> on <network>. Next: btcr2 key generate --set-active`. In JSON mode (`-o json`), stdout is the same payload in the envelope `{ "action": "init", "data": { ... } }`, and the command prints no next-step hint. The `--dev` warning and the `--force` keystore note still go to stderr in JSON mode, unless `--quiet` is present. `created` lists what this run wrote: a subset of `config` and `keystore`, empty on an idempotent second run. `protection` is the protection label of the keystore, read from the file structure after the run: `encrypted` (sealed under a passphrase), `dev` (plaintext), or `absent`. `absent` is possible only if a file at the keystore path is not a keystore that this CLI knows. `init` leaves such a file intact. `init` prints no faucet or explorer hint. `btcr2 create` and `btcr2 quickstart` print those.

**Errors from an existing config file.** If a config file exists but is not valid JSON, `init` stops (exit code 1) with `Config file at <path> is not valid JSON: ... Fix the file by hand; the CLI will not overwrite it while it is unparseable.`. `--force` alone does not bypass this check. The command also refuses a config file from a newer CLI (`schemaVersion` greater than 1), with a message to upgrade. Exception: both refusals occur while the command resolves the keystore path from the config file. An explicit `--keystore` with `--force` skips that read. Then the command DOES overwrite the unparseable (or newer) config file with the default scaffold.

## Environment and configuration

The command reads these environment variables:

| Variable | Role |
|----------|------|
| `BTCR2_HOME` | The home directory if `--home` is absent. The CLI ignores a blank value. |
| `BTCR2_KEYSTORE_PASSPHRASE` | The passphrase for a new encrypted keystore. The CLI reads it BEFORE `--passphrase-file`. For the passphrase, the environment variable outranks the file that the flag names. |
| `BTCR2_OUTPUT` | The output format (`json` or `text`) if `-o/--output` is absent. |

The command does not read the Bitcoin and CAS connection variables (`BTCR2_BTC_REST`, `BTCR2_BTC_RPC_*`, `BTCR2_BTC_TIMEOUT`, `BTCR2_BTC_SIGNAL_DISCOVERY`, `BTCR2_CAS_*`, `BTCR2_FEE_RATE`). `init` does no network I/O.

The config file keys that the command reads (from an existing config file, if any):

| Key | Role |
|-----|------|
| `defaults.network` | The reported network if `-n` is absent. The command does not change it. |
| `defaults.profile` | The active profile if `--profile` is absent. |
| `profiles.<name>.network` | The declared network of the active profile: the network fallback if neither `-n` nor `defaults.network` is set. A profile with a network name declares that network. |
| `profiles.<name>.identity.keystore` | The keystore path if `--keystore` is absent. |
| `defaults.output` | The output format fallback if neither `-o` nor `BTCR2_OUTPUT` is set. |

The config file keys that the command writes:

| Key | Condition |
|-----|-----------|
| the whole scaffold (`schemaVersion`, `defaults.output`, empty `profiles.*`) | The config file is absent, or `--force` is present. |
| `defaults.network` | `-n` is present, and its value differs from the raw value on disk. |

Precedence (the highest wins):

- Home directory: the `--home` flag, then `BTCR2_HOME`, then the platform default. The platform default is `~/.btcr2` on Linux and macOS. On Windows it is `%LOCALAPPDATA%\btcr2`, else `%APPDATA%\btcr2`, else the user profile.
- Config path: the `--config` flag, then `<home>/config.json`.
- Keystore path: the `--keystore` flag, then the `identity.keystore` of the active profile, then `<home>/keystore.json`.
- The recorded or reported network: the `-n` flag, then the existing `defaults.network`, then the network of the active profile, then the built-in `regtest`. Only the `-n` layer writes.
- Passphrase source: `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then the interactive prompt.
- Output format: the `-o` flag, then `BTCR2_OUTPUT`, then config `defaults.output`, then the built-in `text`.

The session file is always `<home>/session.json`. Its path comes from the home root alone, never from `--config`, `--keystore`, or the config file.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. `init` uses `--home`, `-c/--config`, `--keystore`, `--profile`, `--passphrase-file`, `-o/--output`, `--quiet` (suppresses the stderr hint, the `--dev` warning, and the `--force` keystore note), and `--verbose` (full error objects on a failure).

## Examples

```sh
# First setup on mutinynet: asks twice for a new keystore passphrase
btcr2 init -n mutinynet

# Unattended setup: the passphrase from a secrets file
btcr2 --passphrase-file /run/secrets/btcr2-pass init -n mutinynet

# Unattended setup: the passphrase from the environment
BTCR2_KEYSTORE_PASSPHRASE='correct horse battery staple' btcr2 init -n mutinynet

# Throwaway local development: a dev keystore on regtest
btcr2 init --dev -n regtest

# A sandbox home for experiments (the real ~/.btcr2 stays untouched)
BTCR2_HOME=/tmp/btcr2-sandbox btcr2 init -n mutinynet

# Repair a hand-edited config file: write the scaffold again (the keystore stays).
# Pass -n again, or the recorded defaults.network is lost with the old file.
btcr2 init --force -n mutinynet

# Machine-readable result
btcr2 -o json init -n mutinynet
```

## See also

- `btcr2 quickstart`: the setup in one command, built on the same scaffold step, with an optional session and an endpoint probe (the default network is mutinynet).
- `btcr2 keystore init`: create the keystore alone, or create it again on purpose (`--force` there DOES discard the existing keys).
- `btcr2 keystore status`, `btcr2 keystore unlock`, `btcr2 keystore lock`: inspect the keystore and manage the session.
- `btcr2 config init`: write the default config scaffold alone.
- `btcr2 key generate --set-active`: the next step after `init`.
- [README.md](./README.md): the global flags, the environment variables, and the config setup.
- [DEMO.md](./DEMO.md): a full walkthrough that starts with `quickstart`.
