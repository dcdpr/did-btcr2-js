# btcr2 quickstart

`btcr2 quickstart` is the setup in one command (ADR 083). It creates the home directory. It writes a default `config.json` if none exists. It creates the keystore if none exists: encrypted with a confirmed passphrase by default, or unencrypted with `--dev`. It records the Bitcoin network as `defaults.network`. With `--unlock`, it caches the keystore passphrase for the session (ADR 081). Then it runs an advisory endpoint probe (on by default, `--no-doctor` skips it).

The command composes the same steps as `btcr2 init`, `btcr2 keystore unlock`, and `btcr2 config doctor`. It implements nothing twice, so the keystore and session guarantees of ADRs 080 and 081 hold by construction. Use it as the first command in a fresh environment (a workshop, a demo, a CI sandbox). It is idempotent: a second run never touches an existing keystore, and it never overwrites a network default that you set before.

## Synopsis

```
btcr2 quickstart [options]

btcr2 quickstart [-n <network>] [--dev] [--unlock [--ttl <duration>]]
                 [--no-doctor] [--allow-mainnet] [--force]
```

There are no arguments and no subcommands.

## Options

| Flag | Value | Default | Description |
|---|---|---|---|
| `-n, --network <network>` | One of `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`. Another value fails with `Invalid network "<value>". Must be one of bitcoin, testnet3, testnet4, signet, mutinynet, regtest.` (exit code 1). | The existing `defaults.network` of the config file, else `mutinynet` | The network to set up. The command always writes an explicit `-n` to `defaults.network` in the config file, also over a different recorded value. Without the flag, the command uses a recorded `defaults.network` as it is. Only if no network is recorded does the built-in `mutinynet` fallback apply, and then the command records it. |
| `--dev` | boolean | `false` | Create an UNENCRYPTED dev keystore: plaintext keys, no passphrase. Test networks only. A later command refuses a mainnet operation, and the command refuses `quickstart -n bitcoin --dev` up front. The command prints a plaintext warning on stderr (`--quiet` suppresses it). The flag also disables `--unlock` without a message: a dev keystore has no passphrase to cache. |
| `--unlock` | boolean | `false` | Cache the verified keystore passphrase in `<home>/session.json` (mode `0600`), so that a later command does not ask for it until the session expires or `btcr2 keystore lock` revokes it (ADR 081). See "Session" below for the exact behavior. The command ignores the flag with `--dev`. |
| `--ttl <duration>` | A positive integer with an optional suffix: bare digits are seconds, `s` seconds, `m` minutes, `h` hours (the pattern is `^\d+[smh]?$` after a trim). The value must be more than 0 and at most 24 hours. A malformed value, a value of 0 or less, or a value over the cap fails with an `INVALID_ARGUMENT_ERROR` that names the source (`--ttl` or `$BTCR2_KEYSTORE_TTL`). | `$BTCR2_KEYSTORE_TTL` if set, else 1 hour (`3600` seconds) | The session lifetime for `--unlock`. The command reads the flag only if `--unlock` applies (and not `--dev`). Otherwise it ignores the flag, and it does not validate it. |
| `--no-doctor` | boolean | the probe runs by default | Skip the endpoint probe. Without this flag, the command probes the resolved Bitcoin REST endpoint, the Bitcoin Core RPC endpoint (only if one is configured), and the CAS endpoint, each with a 5-second timeout. A probe failure is advisory: it appears in the report and as a stderr warning in text mode, but the command still exits with code 0. |
| `--allow-mainnet` | boolean | `false` | Permit a mainnet (`bitcoin`) quickstart. Without it, the command refuses a `bitcoin` target before it writes any file (`MAINNET_QUICKSTART_REFUSED_ERROR`, exit code 1). With it, the command records mainnet as the default network. With `--unlock`, the cached session records `allowMainnet: true`, so that a mainnet signature can use it. The command still refuses a `--dev` keystore on mainnet, also with this flag. |
| `--force` | boolean | `false` | Write `config.json` again, also if it exists. The command resets the file to the default scaffold, so the custom profiles and defaults in it are lost. Then it records `defaults.network` again: an explicit `-n` value, else the `mutinynet` fallback. A network that you chose before without `-n` does not survive a `--force` run. The command NEVER creates the keystore again, also with `--force`. It leaves an existing keystore intact and prints a stderr note that points at `btcr2 keystore init --force`. |
| `-h, --help` | boolean | | Print the help of the command. |

Notes on the `--help` text (the source wins over the `--help` words):

- The `--help` text of `-n` says `(default: mutinynet)`. In the source, a recorded `defaults.network` wins over that fallback. `mutinynet` is the last resort, if nothing is recorded and `-n` is absent.
- The `--help` text of `--allow-mainnet` says that it permits `-n bitcoin`. In the source, the mainnet guard applies to the effective network from any source: a recorded `defaults.network` of `bitcoin` also needs `--allow-mainnet`, also without `-n`.

### Execution order

1. Validate an explicit `-n` value. Compute the effective network (the flag, then the raw `defaults.network` of the config file, then `mutinynet`). Apply the mainnet guard before any write.
2. Scaffold: create the home directory (`0700`), write `config.json` if it is absent (or with `--force`), and create `keystore.json` if it is absent. A fresh encrypted keystore gets the passphrase with a confirmation (see "Passphrase sources" below) and clears a stale `session.json`. Then record `defaults.network` (idempotent).
3. With `--unlock` (and not `--dev`): cache the session (see "Session").
4. Unless `--no-doctor`: run the advisory endpoint probe.
5. Print the result envelope. In text mode, also print the next-step hints on stderr.

### Session (`--unlock`)

- On a fresh encrypted keystore, the command reuses the confirmed passphrase of the creation step for the session, so there is no second prompt. The command still verifies it against the keystore verifier before the cache.
- On an existing encrypted keystore with a live session that matches, the step is an idempotent skip: the command reports the expiry of the existing session and writes nothing.
- Otherwise the command gets the passphrase (the environment variable, the passphrase file, or a prompt), verifies it, and writes the session. A wrong passphrase fails with `DECRYPT_ERROR` and writes no session file.
- Non-interactive edge case (ADR 083): on an existing keystore with no passphrase source and no terminal, the cache step is a non-fatal skip. The command prints a stderr note (unless `--quiet`), the result reports `unlocked: false`, and the command still exits with code 0, because the scaffold succeeded. An interactive wrong passphrase still fails the command.
- The session file is `<home>/session.json`, mode `0600`. It holds the passphrase base64url-encoded (an encoding, not encryption: the file mode is its only protection at rest). The session is bound to the keystore path and to a fingerprint of the passphrase verifier of the keystore. A changed passphrase or a new keystore invalidates it.

### Passphrase sources

If the run creates an encrypted keystore (no `--dev`), the command gets the passphrase in this order: the `BTCR2_KEYSTORE_PASSPHRASE` environment variable, then the file that `--passphrase-file` names, then a terminal prompt with no echo (`New keystore passphrase: `) and a second entry as a confirmation. The confirmation step does nothing for the environment and file sources. With no source and no terminal, the command fails with `PASSPHRASE_REQUIRED_ERROR` (exit code 1). Two interactive entries that differ fail with `PASSPHRASE_MISMATCH_ERROR`. The command refuses an empty or whitespace-only passphrase. The command never takes the passphrase as a flag value.

### Endpoint probe (doctor)

The probe resolves the endpoints through the standard CLI precedence chain (the flags, then the environment variables, then the config profile, then the SDK defaults of the network). It checks:

- `btc-rest`: `GET <rest-host>/blocks/tip/height` (for the default mutinynet setup, the host is `https://mutinynet.com/api`).
- `btc-rpc`: a `getblockchaininfo` call, only if an RPC endpoint is configured. Regtest has the default `http://localhost:18443`. A public network has none unless you configure one.
- `cas`: `POST <cas-rpc-url>/api/v0/version` if a writable CAS RPC endpoint is configured, else `GET` on the resolved read-only gateway (default `https://ipfs.io`).

Each probe has a 5000 ms timeout. The report also carries a `coherence` warning if the active profile declares a network that differs from the recorded network. Each finding is advisory: the exit code stays 0, and text mode adds a stderr warning that suggests `btcr2 config doctor`.

### Output

The `data` fields of the result envelope are: `home`, `config`, `keystore` (absolute paths), `network`, `created` (a subset of `["config", "keystore"]`, empty on an idempotent second run), `protection` (`encrypted` or `dev`), `unlocked` (boolean), `session` (`{ expiresAt, ttlSeconds }`, epoch milliseconds and whole seconds) only if a session is live, and `doctor` (`{ checks, coherence? }`) only if the probe ran.

In text mode (the default), the command prints the `data` object as pretty JSON on stdout, then the next-step hints on stderr:

```
$ btcr2 quickstart --dev --no-doctor
warning: establishing an UNENCRYPTED dev keystore. Keys are stored in plaintext. Use it only for disposable testnet material; mainnet operations will be refused.
{
  "home": "/home/user/.btcr2",
  "config": "/home/user/.btcr2/config.json",
  "keystore": "/home/user/.btcr2/keystore.json",
  "network": "mutinynet",
  "created": [
    "config",
    "keystore"
  ],
  "protection": "dev",
  "unlocked": false
}
btcr2 home ready at /home/user/.btcr2 on mutinynet.
Dev keystore: keys are stored in plaintext; mainnet operations are refused.
Next: btcr2 key generate --name demo --set-active
Faucet (fund your beacon after "btcr2 create"): https://faucet.mutinynet.com/
```

The stderr hint lines, in this order, each with its condition (ADR 082 and 083):

1. `btcr2 home ready at <home> on <network>.` (always)
2. `Session cached until <ISO-8601 UTC>; signing will not re-prompt until it expires.` (only if a session is live)
3. `Dev keystore: keys are stored in plaintext; mainnet operations are refused.` (only with a dev keystore)
4. `Warning: one or more endpoints were unreachable (see the doctor report). Re-run "btcr2 config doctor" for detail.` (only if a probe failed)
5. `Next: btcr2 key generate --name demo --set-active` (always)
6. `Faucet (fund your beacon after "btcr2 create"): <url>` (only on a network with a faucet: `mutinynet` `https://faucet.mutinynet.com/`, `signet` `https://signetfaucet.com/`, `testnet4` `https://mempool.space/testnet4/faucet`, `testnet3` `https://coinfaucet.eu/en/btc-testnet/`. Never for `bitcoin` or `regtest`.)

`--quiet` and JSON mode suppress the hints. In JSON mode (`-o json` or configured), the command prints the full envelope `{ "action": "quickstart", "data": { ... } }` on stdout. The operational warnings (the dev keystore plaintext warning, the `--force` keystore note, and the skipped session note) go to stderr in both modes. Only `--quiet` suppresses them.

The exit code is 0 on success, also with a failed probe and a skipped session cache. A refusal or an error exits with code 1 and prints the error message only. The full error object needs `--verbose`.

## Environment and configuration

The command reads these environment variables:

| Variable | Role |
|---|---|
| `BTCR2_HOME` | The home directory that holds `config.json`, `keystore.json`, and `session.json`. `--home` wins. |
| `BTCR2_KEYSTORE_PASSPHRASE` | The keystore passphrase for unattended use. The command reads it before `--passphrase-file` and the prompt, at the creation step and for the `--unlock` verification. |
| `BTCR2_KEYSTORE_TTL` | The default session TTL if `--ttl` is absent (the same value format as the flag). |
| `BTCR2_OUTPUT` | The output format (`json` or `text`) if `-o/--output` is absent. |
| `BTCR2_BTC_REST`, `BTCR2_BTC_RPC_URL`, `BTCR2_BTC_RPC_USER`, `BTCR2_BTC_RPC_PASS`, `BTCR2_BTC_RPC_PASS_FILE`, `BTCR2_CAS_GATEWAY`, `BTCR2_CAS_RPC_URL`, `BTCR2_BTC_SIGNAL_DISCOVERY`, `BTCR2_BTC_TIMEOUT`, `BTCR2_CAS_TIMEOUT` | The endpoint overrides. Only the endpoint probe reads them. They select the endpoints that the probe checks. |

The config file keys that feed the command (in `<home>/config.json`, or the file that `-c/--config` names):

| Key | Role |
|---|---|
| `defaults.network` | The command reads it raw (no profile fallback) to compute the effective network before any write. The command writes it idempotently: an explicit `-n` always writes, and the `mutinynet` fallback writes only if the key is unset. |
| `defaults.output` | The output format if neither `-o/--output` nor `BTCR2_OUTPUT` is set. |
| `defaults.profile` | The active profile if `--profile` is absent. It affects the keystore path and the endpoint probe. |
| `profiles.<name>.identity.keystore` | The keystore path of the active profile. `--keystore` wins over it, and `<home>/keystore.json` is the fallback. |
| `profiles.<name>.network` | The network that a profile declares. A mismatch with the recorded network shows as the `coherence` warning of the doctor report. |
| `profiles.<name>.btc.*` (`rest`, `rpcUrl`, `rpcUser`, `rpcPass`, `timeoutMs`, `headers`, `wallet`, `rpcHeaders`, `signalDiscovery`) and `profiles.<name>.cas.*` (`gateway`, `rpcUrl`, `timeoutMs`) | The endpoint config that the endpoint probe reads. |

A fresh scaffold contains `schemaVersion: 1`, `defaults.output: "text"`, and one empty profile per supported network. The network step adds `defaults.network`.

Precedence, the highest wins:

- Endpoints and output format: the flag, then the environment variable, then the config file (the profile), then the built-in default.
- Network: the `-n` flag, then `defaults.network` of the config file, then the built-in `mutinynet` default. There is no environment variable for the network.
- Session TTL: the `--ttl` flag, then `BTCR2_KEYSTORE_TTL`, then the 1-hour default. The cap is 24 hours for each source.
- Passphrase: `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then the terminal prompt.
- Home: the `--home` flag, then `BTCR2_HOME`, then `~/.btcr2` (`%LOCALAPPDATA%\btcr2` on Windows).
- A blank value at one layer defers to the next layer. It does not mask the next layer.

Failure modes that come from the config. The first step of each run reads the recorded `defaults.network` from the raw config file, in two forgiving ways. An unreadable or unparseable file counts as no recorded network. A file from a newer CLI (`schemaVersion` above 1) still parses raw, so its recorded `defaults.network` drives the effective network and the mainnet guard before any config error surfaces. A recorded `bitcoin` without `--allow-mainnet` fails with `MAINNET_QUICKSTART_REFUSED_ERROR`, although the command refuses the file later. After that guard, the command reads the config file to resolve the keystore path. An unreadable, invalid, or newer file stops the command there with `CONFIG_READ_ERROR`, `CONFIG_PARSE_ERROR`, or `CONFIG_SCHEMA_VERSION_ERROR`, before any scaffold: the command does not create the home directory, does not create a keystore, and shows no passphrase prompt. Only an explicit `--keystore` bypasses that read. Then the error of an unreadable or unparseable file surfaces at the network write. `CONFIG_SCHEMA_VERSION_ERROR` surfaces only if the network step writes (an explicit `-n` that differs from the recorded value, or no valid network recorded yet), else at the endpoint probe, or not at all with `--no-doctor`. `--keystore` with `--force` writes the whole config scaffold again before the network step, which clears the error instead of a report.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. `quickstart` uses `--home`, `-c/--config`, `--profile`, `--keystore`, `--passphrase-file`, `-o/--output`, `--quiet`, `--verbose`, and (through the endpoint probe) the endpoint overrides (`--btc-rest`, `--btc-rpc-url`, `--btc-rpc-user`, `--btc-rpc-wallet`, `--btc-rest-header`, `--btc-rpc-header`, `--btc-signal-discovery`, `--btc-timeout`, `--cas-gateway`, `--cas-rpc-url`, `--cas-timeout`).

## Examples

```sh
# The default setup: mutinynet, an encrypted keystore (asks for a confirmed
# passphrase), the network recorded, the endpoints probed.
btcr2 quickstart

# The same, and cache the passphrase for two hours, so that the next key and
# signing commands do not ask for it.
btcr2 quickstart -n mutinynet --unlock --ttl 2h

# A throwaway dev setup: an unencrypted keystore, no passphrase, no prompt.
btcr2 quickstart --dev

# An unattended (CI) setup on mutinynet with a session, no prompt.
BTCR2_KEYSTORE_PASSPHRASE='correct horse battery staple' btcr2 quickstart --unlock

# Signet, without the endpoint probe (for example offline).
btcr2 quickstart -n signet --no-doctor

# A sandbox home for a demo, with JSON output for a script.
BTCR2_HOME=/tmp/btcr2-demo btcr2 quickstart --dev --no-doctor -o json

# Mainnet needs the explicit opt-in. The command still refuses a dev keystore there.
btcr2 quickstart -n bitcoin --allow-mainnet
```

## See also

- `btcr2 init`: the scaffold step alone (the home, the config file, the keystore, the network record), without the session and the probe.
- `btcr2 keystore unlock`, `btcr2 keystore lock`, `btcr2 keystore status`: manage the session after the setup.
- `btcr2 keystore init --force`: the only way to create an existing keystore again.
- `btcr2 config doctor`: run the endpoint probe again at any time.
- `btcr2 key generate --name demo --set-active`: the next step after `quickstart`.
- [DEMO.md](./DEMO.md): the walkthrough that starts with `quickstart`.
