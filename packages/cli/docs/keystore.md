# btcr2 keystore

Establish, inspect, re-key, and unlock the on-disk keystore that holds the CLI's signing keys.
The subcommands operate on the keystore file (default `<home>/keystore.json`) and the session file
(`<home>/session.json`) directly: no Bitcoin connection is opened and no KeyManager is constructed.
Nothing here decrypts a key except `change-passphrase`, which re-seals every key under a new
passphrase. Use `btcr2 keystore init` once to establish the store (or let `btcr2 init` / `btcr2
quickstart` do it), `btcr2 keystore status` to inspect it safely, `btcr2 keystore
change-passphrase` to rotate the passphrase, and `btcr2 keystore unlock` / `btcr2 keystore lock`
to manage the session unlock agent that lets later signing commands run without re-prompting.

## Synopsis

```
btcr2 keystore [command]

btcr2 keystore init [--dev] [--force]
btcr2 keystore status
btcr2 keystore change-passphrase        (alias: passwd)
btcr2 keystore unlock [--ttl <duration>] [--allow-mainnet]
btcr2 keystore lock
btcr2 keystore help [command]
```

## Subcommands

### init

Establishes a fresh keystore file. By default the keystore is encrypted: the command prompts for a
passphrase on the terminal (non-echoing, on stderr) and prompts a second time to confirm it, then
writes a keystore whose passphrase verifier is sealed with argon2id + XChaCha20-Poly1305. The
passphrase can instead come from `BTCR2_KEYSTORE_PASSPHRASE` or `--passphrase-file` for scripted
setup (the confirm step is a no-op for those sources). The file is written atomically with mode
`0600` in a `0700` home directory.

Behavior details, from source:

- If a keystore already exists at the resolved path, `init` fails with
  `A keystore already exists at <path>. Use --force to re-establish it (this discards its keys).`
  unless `--force` is given.
- With `--force` over an existing keystore that holds one or more keys, a warning is printed to
  stderr naming the number of keys that will be permanently discarded (suppressed by `--quiet`).
- With `--dev`, an unencrypted dev keystore is written: plaintext keys, no passphrase, no prompt.
  A stderr warning is printed (suppressed by `--quiet`). Dev keystores are hard-refused for
  mainnet (`bitcoin`) operations elsewhere in the CLI.
- After any successful `init`, the cached session at `<home>/session.json` is deleted: a
  re-established keystore mints a new verifier (or none, for `--dev`), so a cached passphrase for
  the old keystore must not linger on disk.
- An empty or whitespace-only passphrase is rejected. Ctrl-C during the prompt aborts.
- A malformed config file aborts the command loudly (the keystore path may be redirected by the
  active profile's `identity.keystore`, so `init` refuses to guess).

Prints (text mode) the data payload; (json mode) the full envelope:

```json
{ "action": "keystore-init", "data": { "path": "<keystore path>", "protection": "encrypted" } }
```

`protection` is `'encrypted'` or `'dev'`.

Example:

```sh
btcr2 keystore init                       # prompts for a passphrase, twice
btcr2 keystore init --dev                 # plaintext dev keystore, testnet/regtest only
btcr2 keystore init --force               # discard the existing keystore and its keys
BTCR2_KEYSTORE_PASSPHRASE='s3cret' btcr2 keystore init   # unattended
```

### status

Shows the resolved keystore path, protection mode, whether a passphrase has been established, the
key count, the active-key id (when one is set), and the session state. Never decrypts, never
prompts, and never fails on a broken config: the keystore path is resolved leniently (a malformed
config falls back to the home default `<home>/keystore.json` instead of crashing), and an
unreadable or foreign keystore file simply reports `absent`.

For a dev keystore, a stderr warning (`warning: this is an UNENCRYPTED dev keystore; keys are
stored in plaintext.`) is printed unless `--quiet` is set or the output mode is `json`.

Data payload:

```json
{
  "path": "/home/user/.btcr2/keystore.json",
  "protection": "encrypted",
  "established": true,
  "keyCount": 2,
  "active": "urn:kms:secp256k1:...",
  "session": {
    "active": true,
    "expiresAt": 1785176470229,
    "secondsRemaining": 2700,
    "allowMainnet": false
  }
}
```

- `protection`: `'encrypted'`, `'dev'`, or `'absent'`.
- `established`: for an encrypted keystore, whether the passphrase verifier exists yet (written by
  `keystore init` or the first key seal); always `true` for `dev`; `false` for `absent`.
- `active` is omitted when no active key is set.
- `session`: `{ "active": false }` when no live session matches this keystore; a live session adds
  `expiresAt` (ms epoch), `secondsRemaining`, and `allowMainnet`. Read-only: an expired or stale
  session is reported inactive but not pruned by `status`.

### change-passphrase

Alias: `passwd`. Changes the keystore passphrase, decrypting and re-sealing every sealed key (and
the verifier) under the new one. Encrypted keystores only.

- Fails with `No keystore at <path>. Run "btcr2 keystore init" first.` when the keystore is
  absent, and with a dedicated message when it is a dev keystore (no passphrase to change).
- The current passphrase is acquired through the normal chain (`BTCR2_KEYSTORE_PASSPHRASE`, then
  `--passphrase-file`, then a terminal prompt), so unattended rotation of the current passphrase
  is possible.
- The new passphrase is always entered fresh at the terminal (prompted twice, entries must
  match). The env var and passphrase file are deliberately skipped for the new passphrase so the
  same source cannot silently satisfy both and make the change a no-op. Consequence: this
  subcommand requires a TTY for the new passphrase; with no TTY it fails with
  `No passphrase available. Set BTCR2_KEYSTORE_PASSPHRASE, pass --passphrase-file, or run in a
  terminal.`
- A wrong current passphrase fails against the verifier before any re-seal work.
- If the keystore changes concurrently while re-sealing, the command aborts with a
  `KEYSTORE_CONCURRENT_CHANGE_ERROR` rather than leaving keys under mixed passphrases.
- After a successful change, the cached session file is deleted: the rotated verifier already
  invalidates it by fingerprint, but the file still holds the old passphrase in plaintext
  (base64url-encoded), so it is removed outright.

Data payload: `{ "path": "<keystore path>", "rekeyed": <number of secrets re-sealed> }`.

### unlock

Caches the verified keystore passphrase in `<home>/session.json` so later signing commands (`key
generate`, `key export`, `update`, `deactivate`, `create` with a generated key) read it from the
session instead of prompting again, until the session expires or `keystore lock` revokes it.

Refusals, in order, before anything is cached:

- Absent keystore: `No keystore at <path>. Run "btcr2 init" or "btcr2 keystore init" first.`
- Dev keystore: it has no passphrase to cache, so no unlock is needed.
- Encrypted keystore with no established passphrase (no verifier yet): establish one with
  `btcr2 keystore init` or the first `btcr2 key generate`.
- Mainnet gate: when the resolved default network is `bitcoin` and `--allow-mainnet` is not
  passed, unlock is refused (`MAINNET_UNLOCK_REFUSED_ERROR`), because a cached passphrase
  suspends per-use authentication for the whole session. The network checked here is the
  configured default (config `defaults.network`, else the active profile's network, else
  `regtest`); the authoritative check happens again at consumption, where a `bitcoin` operation
  (network derived from the DID) is withheld from a session that lacks `allowMainnet`.

The passphrase is acquired directly (`BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then a
terminal prompt; an existing session is never consulted) and verified against the keystore's
verifier before caching. A wrong passphrase fails with `Incorrect passphrase for the keystore at
<path>; no session was created.` (`DECRYPT_ERROR`) and writes no session file.

The session file is written atomically at mode `0600`. It records the resolved keystore path, a
fingerprint of the keystore's passphrase verifier (so `change-passphrase` or `init --force`
invalidates it), the base64url-encoded passphrase (an encoding, not encryption: its only
protection at rest is the file mode), the `allowMainnet` flag, and the created/expiry timestamps.

TTL resolution: the `--ttl` flag, else `$BTCR2_KEYSTORE_TTL`, else the one-hour default. The value
is a bare integer (seconds) or an integer with an `s`, `m`, or `h` suffix, e.g. `3600`, `45m`,
`2h`. Zero, negative, malformed, and over-24h values are rejected with an error that names the
actual source (`--ttl` or `$BTCR2_KEYSTORE_TTL`). A blank flag defers to the env var.

Data payload: `{ "keystore": "<keystore path>", "expiresAt": <ms epoch>, "ttlSeconds": <n> }`.

### lock

Revokes the cached session: deletes `<home>/session.json` and sweeps any crash-orphaned atomic-
write temp files next to it (each of which would hold a plaintext passphrase). Idempotent; needs
no passphrase; works even under a malformed config, because the session path is derived from the
home directory alone (never from `--config`, `--keystore`, or the config file). Unlink removes the
file name; it does not securely erase the bytes.

Data payload: `{ "path": "<session path>", "cleared": <boolean> }`. `cleared` is `true` when a
session file was present and removed, `false` when there was none (or removal failed).

## Options

All subcommand-specific flags. Every subcommand also accepts `-h, --help`.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `--dev` (`init`) | boolean | `false` | Create an UNENCRYPTED dev keystore: plaintext keys, no passphrase, never prompts. For disposable testnet/regtest material only; mainnet (`bitcoin`) operations with a dev keystore are refused elsewhere in the CLI. |
| `--force` (`init`) | boolean | `false` | Re-establish even if a keystore already exists, permanently discarding its keys. Warns on stderr with the key count when keys would be lost (suppressed by `--quiet`). |
| `--ttl <duration>` (`unlock`) | bare integer seconds, or an integer with an `s`, `m`, or `h` suffix; must be > 0 and <= 24h (e.g. `3600`, `45m`, `2h`) | `1h` (via `$BTCR2_KEYSTORE_TTL` when set) | Session lifetime for the cached passphrase. |
| `--allow-mainnet` (`unlock`) | boolean | `false` | Permit unlocking when the resolved default network is mainnet (`bitcoin`), and record the allowance in the session so mainnet operations may consume it. Without it, mainnet operations keep per-use passphrase authentication even while a session is live. |
| `-h, --help` | - | - | Display help for the command or subcommand. |

`status`, `change-passphrase`, and `lock` take no flags of their own.

## Environment & configuration

General precedence is flag > env var > profile config > built-in default, with the exceptions
noted per item (the passphrase chain puts the env var above the flag-named file).

Environment variables consulted:

| Variable | Used by | Meaning |
|----------|---------|---------|
| `BTCR2_HOME` | all subcommands | Home directory holding `config.json`, `keystore.json`, and `session.json`. Overridden by `--home`; falls back to `~/.btcr2` (Linux/macOS) or `%LOCALAPPDATA%\btcr2` (Windows, then `%APPDATA%\btcr2`, then the user profile). A blank value defers to the next layer. |
| `BTCR2_KEYSTORE_PASSPHRASE` | `init`, `change-passphrase` (current passphrase only), `unlock` | Supplies the keystore passphrase for unattended use. Checked BEFORE `--passphrase-file`; a trailing newline is trimmed. Never used for the NEW passphrase in `change-passphrase`. |
| `BTCR2_KEYSTORE_TTL` | `unlock` | Default session TTL, below the `--ttl` flag. Same value domain as `--ttl`. |
| `BTCR2_OUTPUT` | all subcommands | Output format (`json` or `text`), below the `-o/--output` flag and above the config file's `defaults.output`. |

Config file (`<home>/config.json`, or the file named by `-c/--config`) keys that feed this
command:

| Key | Used by | Effect |
|-----|---------|--------|
| `defaults.profile` | all subcommands | Selects the active profile when `--profile` is not given. |
| `profiles.<name>.identity.keystore` | all except `lock` | Keystore path for the active profile. Precedence: `--keystore` flag > this key > `<home>/keystore.json`. Only consulted when a profile is active (via `--profile` or `defaults.profile`). |
| `defaults.network` | `unlock` | The resolved default network drives the mainnet unlock gate: `bitcoin` here refuses `unlock` without `--allow-mainnet`. |
| `profiles.<name>.network` (or a profile named after a network) | `unlock` | Fallback network for the mainnet gate when `defaults.network` is unset; the final fallback is `regtest`. |
| `defaults.output` | all subcommands | Output format when neither `-o/--output` nor `BTCR2_OUTPUT` is set. |

Malformed-config behavior differs by subcommand: `init`, `change-passphrase`, and `unlock` abort
loudly on an unparseable config (the profile could redirect the keystore path, so they refuse to
guess); `status` falls back to the home-default keystore path so it can still report; `lock` never
reads the config at all.

Session interaction summary: the session file is `<home>/session.json` (mode `0600`), written only
by `unlock` (and `quickstart --unlock`), deleted by `lock`, `init`, and `change-passphrase`. Other
CLI commands consume it when acquiring a passphrase, in this order: `BTCR2_KEYSTORE_PASSPHRASE`,
then `--passphrase-file`, then a live session, then the interactive prompt. A session that is
expired, stale (passphrase rotated), future-dated, or malformed is pruned on read; a live session
bound to a different keystore is left in place. A `bitcoin` operation never consumes a session
that was not unlocked with `--allow-mainnet`. The passphrase-establishing path (a fresh keystore's
first seal) never consults the session.

## Global options

Shared global flags are documented in the [docs README](./README.md#global-options). Globals this command notably
interacts with: `--home <dir>`, `-c, --config <path>`, `--profile <name>`, `--keystore <path>`,
`--passphrase-file <path>`, `-o, --output <json|text>`, `--quiet` (suppresses the stderr
warnings), and `--verbose` (full error objects). The Bitcoin/CAS connection flags are ignored
here: these subcommands open no network connection.

## Examples

```sh
# Establish an encrypted keystore (prompts twice for the passphrase)
btcr2 keystore init

# Inspect it: path, protection, key count, session state. Safe anywhere.
btcr2 keystore status
btcr2 -o json keystore status

# Unattended establishment in a sandboxed home
BTCR2_HOME=/tmp/btcr2-demo BTCR2_KEYSTORE_PASSPHRASE='demo-pass' btcr2 keystore init

# Working against mutinynet: record the default network, then unlock for 2 hours
btcr2 config set defaults.network mutinynet
btcr2 keystore unlock --ttl 2h
btcr2 update ...        # signs without re-prompting until the session expires

# Revoke the session when done
btcr2 keystore lock

# Rotate the passphrase (current may come from env/file; the new one is always
# entered fresh at the terminal, twice)
btcr2 keystore passwd

# Dev keystore for throwaway regtest keys (plaintext; refused for mainnet)
btcr2 keystore init --dev

# Mainnet default network: unlock is refused unless explicitly allowed
btcr2 keystore unlock --allow-mainnet
```

## See also

- `btcr2 init`: one-command home setup that also establishes the keystore.
- `btcr2 quickstart`: onboarding that composes `btcr2 init`, `btcr2 keystore unlock` (via
  `--unlock`), and `btcr2 config doctor`.
- `btcr2 key`: manage keypairs inside the keystore (generate, import, export, use, delete).
- `btcr2 update` / `btcr2 deactivate`: the signing commands that consume the keystore and session.
- `btcr2 config path`: print the resolved home, config, and keystore paths.
- [DEMO.md](./DEMO.md): full walkthrough including keystore establishment and session unlock.
