# btcr2 quickstart

`btcr2 quickstart` is the one-command onboarding step (ADR 083): it creates the btcr2 home
directory, writes a default `config.json` if none exists, establishes the keystore if none exists
(encrypted with a confirmed passphrase by default, or unencrypted with `--dev`), records the chosen
Bitcoin network as `defaults.network`, optionally caches the keystore passphrase for the session
(`--unlock`, ADR 081), and runs an advisory endpoint reachability probe (on by default, skippable
with `--no-doctor`). It composes the same primitives as `btcr2 init`, `btcr2 keystore unlock`, and
`btcr2 config doctor`; it reimplements nothing, so the keystore and session guarantees of ADRs 080
and 081 hold by construction. Use it as the first command in a fresh environment (workshops, demos,
CI sandboxes); it is idempotent, so re-running it never touches an existing keystore and never
clobbers a network default the operator set earlier.

## Synopsis

```
btcr2 quickstart [options]

btcr2 quickstart [-n <network>] [--dev] [--unlock [--ttl <duration>]]
                 [--no-doctor] [--allow-mainnet] [--force]
```

There are no positional arguments and no subcommands.

## Options

| Flag | Value | Default | Description |
|---|---|---|---|
| `-n, --network <network>` | One of `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`. Any other value fails with `Invalid network "<value>". Must be one of bitcoin, testnet3, testnet4, signet, mutinynet, regtest.` (exit 1). | The config's existing `defaults.network`, else `mutinynet` | The network to set up. An explicit `-n` is always persisted to `defaults.network` in the config (overwriting a different recorded value). When omitted, an already-recorded `defaults.network` is used as-is; only when none is recorded does the built-in `mutinynet` fallback apply, and it is then persisted. |
| `--dev` | boolean | `false` | Establish an UNENCRYPTED dev keystore: plaintext keys, no passphrase. Testnet only; mainnet operations are refused later at use time, and `quickstart -n bitcoin --dev` is refused up front. Prints a plaintext warning to stderr (suppressed by `--quiet`). Also silently disables `--unlock` (a dev keystore has no passphrase to cache). |
| `--unlock` | boolean | `false` | Cache the verified keystore passphrase in `<home>/session.json` (mode `0600`) so later commands do not re-prompt until the session expires or `btcr2 keystore lock` revokes it (ADR 081). See "Session caching" below for the exact behavior. Ignored with `--dev`. |
| `--ttl <duration>` | A positive integer, optionally suffixed: bare digits are seconds, `s` seconds, `m` minutes, `h` hours (regex `^\d+[smh]?$` after trimming). Must be greater than 0 and at most 24 hours; a malformed, non-positive, or over-cap value fails with an `INVALID_ARGUMENT_ERROR` naming the offending source (`--ttl` or `$BTCR2_KEYSTORE_TTL`). | `$BTCR2_KEYSTORE_TTL` if set, else 1 hour (`3600` seconds) | Session lifetime for `--unlock`. Only consulted when `--unlock` is in effect (and not `--dev`); otherwise the flag is ignored entirely, not even validated. |
| `--no-doctor` | boolean | doctor runs by default | Skip the endpoint reachability probe. Without this flag, the resolved Bitcoin REST endpoint, the Bitcoin Core RPC endpoint (only when one is configured), and the CAS endpoint are each probed with a 5-second per-probe timeout. Probe failures are advisory: they appear in the report and produce a stderr warning in text mode, but the command still exits 0. |
| `--allow-mainnet` | boolean | `false` | Permit a mainnet (`bitcoin`) quickstart. Without it, a `bitcoin` target is refused before any file is written (`MAINNET_QUICKSTART_REFUSED_ERROR`, exit 1). With it, mainnet is recorded as the default network; combined with `--unlock`, the cached session records `allowMainnet: true` so mainnet signing can consume it. A `--dev` keystore is still refused on mainnet even with this flag. |
| `--force` | boolean | `false` | Re-create `config.json` even if it already exists. The file is reset to the default scaffold wholesale, so custom profiles and defaults in it are discarded, and `defaults.network` is then re-recorded (an explicit `-n` value, else the `mutinynet` fallback; a previously chosen non-`-n` network does not survive a `--force` re-scaffold). The keystore is NEVER re-created, even with `--force`: an existing one is left intact with a stderr note pointing at `btcr2 keystore init --force`. |
| `-h, --help` | boolean | | Display help for the command. |

Help-text notes (source wins over `--help` phrasing):

- The `--help` text for `-n` says `(default: mutinynet)`. In source, an existing recorded
  `defaults.network` takes precedence over that fallback; `mutinynet` is only the last resort when
  nothing is recorded and no `-n` is given.
- The `--help` text for `--allow-mainnet` says it permits `-n bitcoin`. In source the mainnet guard
  applies to the effective network however it was derived: a recorded `defaults.network` of
  `bitcoin` also requires `--allow-mainnet`, even without `-n`.

### Execution order

1. Validate an explicit `-n` value, compute the effective network (flag, then the raw
   `defaults.network` from the config, then `mutinynet`), and apply the mainnet guard before any
   write.
2. Scaffold: create the home directory (`0700`), write `config.json` if absent (or with `--force`),
   and establish `keystore.json` if absent. A fresh encrypted keystore acquires the passphrase with
   confirmation (see "Passphrase sources" below) and clears any stale `session.json`. Then record
   `defaults.network` idempotently.
3. With `--unlock` (and not `--dev`): cache the session (see "Session caching").
4. Unless `--no-doctor`: run the advisory endpoint probe.
5. Print the result envelope; in text mode, also print next-step hints to stderr.

### Session caching (`--unlock`)

- On a freshly established encrypted keystore, the establish-time confirmed passphrase is reused to
  seed the session, so there is no second prompt. It is still verified against the keystore
  verifier before caching.
- On an existing encrypted keystore with a live matching session, the step is an idempotent skip:
  the existing session's expiry is reported and nothing is rewritten.
- Otherwise the passphrase is acquired (env var, passphrase file, or prompt), verified, and the
  session written. A wrong passphrase fails with `DECRYPT_ERROR` and writes no session file.
- Non-interactive edge case (ADR 083): on an existing keystore with no passphrase source and no
  terminal, caching is a non-fatal skip. A stderr note is printed (unless `--quiet`), the result
  reports `unlocked: false`, and the command still exits 0, because the scaffold already succeeded.
  An interactive wrong passphrase still fails the command.
- The session file lives at `<home>/session.json`, mode `0600`, and holds the passphrase
  base64url-encoded (an encoding, not encryption; the file mode is its only at-rest protection). It
  is bound to the keystore path and to a fingerprint of the keystore's passphrase verifier, so a
  rotated passphrase or re-established keystore invalidates it.

### Passphrase sources

When a fresh encrypted keystore is established (no `--dev`), the passphrase is resolved in this
order: the `BTCR2_KEYSTORE_PASSPHRASE` environment variable, then the file named by
`--passphrase-file`, then a non-echoing terminal prompt (`New keystore passphrase: `) with a
confirming second entry. The confirm step is a no-op for the env-var and file sources. With no
source and no terminal, the command fails with `PASSPHRASE_REQUIRED_ERROR` (exit 1); mismatched
interactive entries fail with `PASSPHRASE_MISMATCH_ERROR`; an empty or whitespace-only passphrase
is rejected. The passphrase is never accepted as a command-line flag value.

### Endpoint probe (doctor)

The probe resolves endpoints through the standard CLI precedence chain (flags, then env vars, then
the config profile, then the per-network SDK defaults) and checks:

- `btc-rest`: `GET <rest-host>/blocks/tip/height` (for the default mutinynet setup this is
  `https://mutinynet.com/api`).
- `btc-rpc`: a `getblockchaininfo` call, only when an RPC endpoint is configured (regtest has a
  default of `http://localhost:18443`; public networks have none unless configured).
- `cas`: `POST <cas-rpc-url>/api/v0/version` when a writable CAS RPC endpoint is configured, else
  `GET` on the resolved read-only gateway (default `https://ipfs.io`).

Each probe has a 5000 ms timeout. The report also carries a `coherence` warning when the active
profile declares a network different from the one being recorded. All findings are advisory: the
exit code stays 0, and text mode adds a stderr warning suggesting `btcr2 config doctor`.

### Output

The result envelope's `data` fields are: `home`, `config`, `keystore` (absolute paths), `network`,
`created` (subset of `["config", "keystore"]`; empty on an idempotent re-run), `protection`
(`encrypted` or `dev`), `unlocked` (boolean), plus `session` (`{ expiresAt, ttlSeconds }`, epoch
milliseconds and whole seconds) only when a session is live, and `doctor` (`{ checks, coherence? }`)
only when the probe ran.

In text mode (the default), the `data` object is pretty-printed as JSON to stdout, followed by
next-step hints on stderr:

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

The stderr hint lines, in order and each conditional (ADR 082/083):

1. `btcr2 home ready at <home> on <network>.` (always)
2. `Session cached until <ISO-8601 UTC>; signing will not re-prompt until it expires.` (only when a
   session is live)
3. `Dev keystore: keys are stored in plaintext; mainnet operations are refused.` (only with a dev
   keystore)
4. `Warning: one or more endpoints were unreachable (see the doctor report). Re-run "btcr2 config
   doctor" for detail.` (only when a probe failed)
5. `Next: btcr2 key generate --name demo --set-active` (always)
6. `Faucet (fund your beacon after "btcr2 create"): <url>` (only on networks with a faucet:
   `mutinynet` `https://faucet.mutinynet.com/`, `signet` `https://signetfaucet.com/`, `testnet4`
   `https://mempool.space/testnet4/faucet`, `testnet3` `https://coinfaucet.eu/en/btc-testnet/`;
   never for `bitcoin` or `regtest`)

The hints are suppressed by `--quiet` and in JSON mode. In JSON mode (`-o json` or configured), the
full envelope `{ "action": "quickstart", "data": { ... } }` is printed to stdout. Operational
warnings (the dev-keystore plaintext warning, the `--force` keystore-left-intact note, and the
skipped-session note) go to stderr in both modes and are suppressed only by `--quiet`.

Exit code is 0 on success, including failed probes and a skipped session cache; refusals and errors
exit 1 with the error message only (the full error object requires `--verbose`).

## Environment & configuration

Environment variables this command consults:

| Variable | Role |
|---|---|
| `BTCR2_HOME` | Home directory holding `config.json`, `keystore.json`, and `session.json`. Overridden by `--home`. |
| `BTCR2_KEYSTORE_PASSPHRASE` | Keystore passphrase for unattended use; consulted before `--passphrase-file` and the prompt, both at establishment and for `--unlock` verification. |
| `BTCR2_KEYSTORE_TTL` | Default session TTL when `--ttl` is absent (same value domain as the flag). |
| `BTCR2_OUTPUT` | Output format (`json` or `text`) when `-o/--output` is absent. |
| `BTCR2_BTC_REST`, `BTCR2_BTC_RPC_URL`, `BTCR2_BTC_RPC_USER`, `BTCR2_BTC_RPC_PASS`, `BTCR2_BTC_RPC_PASS_FILE`, `BTCR2_CAS_GATEWAY`, `BTCR2_CAS_RPC_URL`, `BTCR2_BTC_SIGNAL_DISCOVERY`, `BTCR2_BTC_TIMEOUT`, `BTCR2_CAS_TIMEOUT` | Endpoint overrides consulted only by the doctor probe (they shape which endpoints get probed). |

Config-file keys that feed the command (in `<home>/config.json`, or the file named by
`-c/--config`):

| Key | Role |
|---|---|
| `defaults.network` | Read (raw, no profile fallback) to compute the effective network before any write; written idempotently: an explicit `-n` always writes, the `mutinynet` fallback writes only when the key is unset. |
| `defaults.output` | Output format when neither `-o/--output` nor `BTCR2_OUTPUT` is set. |
| `defaults.profile` | Selects the active profile when `--profile` is absent (affects the keystore path and the doctor probe). |
| `profiles.<name>.identity.keystore` | Keystore path for the active profile; overridden by `--keystore`, falls back to `<home>/keystore.json`. |
| `profiles.<name>.network` | The network a profile declares; a mismatch with the network being recorded surfaces as the doctor report's `coherence` warning. |
| `profiles.<name>.btc.*` (`rest`, `rpcUrl`, `rpcUser`, `rpcPass`, `timeoutMs`, `headers`, `wallet`, `rpcHeaders`, `signalDiscovery`) and `profiles.<name>.cas.*` (`gateway`, `rpcUrl`, `timeoutMs`) | Endpoint configuration consulted by the doctor probe. |

A freshly scaffolded config contains `schemaVersion: 1`, `defaults.output: "text"`, and one empty
profile per supported network; `defaults.network` is added by the network-recording step.

Precedence, highest wins:

- Endpoints and output format: flag, then env var, then config file (profile), then built-in
  default.
- Network: `-n` flag, then the config's `defaults.network`, then the built-in `mutinynet` default.
  There is no network env var.
- Session TTL: `--ttl` flag, then `BTCR2_KEYSTORE_TTL`, then the 1-hour default (24-hour cap on
  all sources).
- Passphrase: `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then the terminal prompt.
- Home: `--home` flag, then `BTCR2_HOME`, then `~/.btcr2` (`%LOCALAPPDATA%\btcr2` on Windows).
- Blank values at any layer defer to the next layer instead of masking it.

Failure modes tied to configuration. The first thing every run does is quietly read the recorded
`defaults.network` from the raw config, in two deliberately forgiving ways: an unreadable or
unparseable file is treated as having no recorded network, while a file written by a newer CLI
(`schemaVersion` above 1) still parses raw, so its recorded `defaults.network` drives the
effective network and the mainnet guard before any config error can surface (a recorded
`bitcoin` without `--allow-mainnet` aborts with `MAINNET_QUICKSTART_REFUSED_ERROR` even though
the file would later be rejected). Past that guard, the config is consulted while resolving the
keystore path, and an unreadable, invalid, or newer-schema file aborts there with
`CONFIG_READ_ERROR`, `CONFIG_PARSE_ERROR`, or `CONFIG_SCHEMA_VERSION_ERROR` before anything is
scaffolded: the home directory is not created, no keystore is established, and no passphrase
prompt appears. Only an explicit `--keystore` bypasses that read; an unreadable or unparseable
file's error then surfaces at the network-recording write, while `CONFIG_SCHEMA_VERSION_ERROR`
surfaces only when the recording step actually writes (an explicit `-n` differing from the
recorded value, or no valid network recorded yet), else at the doctor probe, or not at all with
`--no-doctor`. `--keystore` plus `--force` re-scaffolds the config wholesale before the
recording step, clearing the error rather than reporting it.

## Global options

Shared global flags are documented in the [docs README](./README.md#global-options); `quickstart` notably
interacts with `--home`, `-c/--config`, `--profile`, `--keystore`, `--passphrase-file`,
`-o/--output`, `--quiet`, `--verbose`, and (through the doctor probe) the endpoint overrides
(`--btc-rest`, `--btc-rpc-url`, `--btc-rpc-user`, `--btc-rpc-wallet`,
`--btc-rest-header`, `--btc-rpc-header`, `--btc-signal-discovery`, `--btc-timeout`,
`--cas-gateway`, `--cas-rpc-url`, `--cas-timeout`).

## Examples

```sh
# The default workshop setup: mutinynet, encrypted keystore (prompts for a
# confirmed passphrase), network recorded, endpoints probed.
btcr2 quickstart

# Same, plus cache the passphrase for two hours so the following key and
# signing commands do not re-prompt.
btcr2 quickstart -n mutinynet --unlock --ttl 2h

# Disposable dev setup: unencrypted keystore, no passphrase, no prompts.
btcr2 quickstart --dev

# Unattended (CI) setup on mutinynet with a session, no prompt.
BTCR2_KEYSTORE_PASSPHRASE='correct horse battery staple' btcr2 quickstart --unlock

# Signet, skipping the endpoint probe (e.g. offline).
btcr2 quickstart -n signet --no-doctor

# A sandboxed home for a demo, JSON output for scripting.
BTCR2_HOME=/tmp/btcr2-demo btcr2 quickstart --dev --no-doctor -o json

# Mainnet requires the explicit opt-in; dev keystores are still refused there.
btcr2 quickstart -n bitcoin --allow-mainnet
```

## See also

- `btcr2 init`: the scaffold step alone (home, config, keystore, network recording), without the
  session cache or the probe.
- `btcr2 keystore unlock` / `btcr2 keystore lock` / `btcr2 keystore status`: manage the cached
  session after setup.
- `btcr2 keystore init --force`: the only way to re-establish an existing keystore.
- `btcr2 config doctor`: re-run the endpoint reachability probe on demand.
- `btcr2 key generate --name demo --set-active`: the suggested next step after quickstart.
- [DEMO.md](./DEMO.md): the guided end-to-end walkthrough that starts from `quickstart`.
