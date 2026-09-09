# btcr2 keystore

Creates, inspects, re-keys, and unlocks the keystore that holds the signing keys of the CLI. The subcommands work on the keystore file (default `<home>/keystore.json`) and on the session file (`<home>/session.json`) directly. They open no Bitcoin connection and construct no key manager. No subcommand decrypts a key, except `change-passphrase`, which seals each key again under a new passphrase.

Use `btcr2 keystore init` once to create the keystore (or let `btcr2 init` or `btcr2 quickstart` do it). Use `btcr2 keystore status` to inspect it safely. Use `btcr2 keystore change-passphrase` to change the passphrase. Use `btcr2 keystore unlock` and `btcr2 keystore lock` to manage the session, so that a later signing command does not ask for the passphrase.

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

Creates a fresh keystore file. By default the keystore is encrypted. The command asks for a passphrase on the terminal (no echo, on stderr) and asks a second time as a confirmation. Then it writes a keystore whose passphrase verifier is sealed with argon2id and XChaCha20-Poly1305. For a script, the passphrase can come from `BTCR2_KEYSTORE_PASSPHRASE` or `--passphrase-file`. The confirmation step does nothing for those sources. The command writes the file atomically with mode `0600` in a `0700` home directory.

Behavior details, from the source:

- If a keystore exists at the resolved path, `init` fails with `A keystore already exists at <path>. Use --force to re-establish it (this discards its keys).`, unless `--force` is present.
- With `--force` over an existing keystore with one or more keys, the command prints a warning on stderr with the number of keys that it discards (`--quiet` suppresses it).
- With `--dev`, the command writes an unencrypted dev keystore: plaintext keys, no passphrase, no prompt. It prints a stderr warning (`--quiet` suppresses it). The other commands of the CLI refuse a dev keystore for a mainnet (`bitcoin`) operation.
- After each successful `init`, the command deletes the cached session at `<home>/session.json`. A new keystore gets a new verifier (or none, with `--dev`), so a cached passphrase of the old keystore must not stay on disk.
- The command refuses an empty or whitespace-only passphrase. Ctrl-C at the prompt stops the command.
- A malformed config file fails the command with a message. The `identity.keystore` of the active profile can move the keystore path, so `init` does not guess.

Prints the data payload in text mode, and the full envelope in JSON mode:

```json
{ "action": "keystore-init", "data": { "path": "<keystore path>", "protection": "encrypted" } }
```

`protection` is `'encrypted'` or `'dev'`.

Examples:

```sh
btcr2 keystore init                       # asks for a passphrase, twice
btcr2 keystore init --dev                 # a plaintext dev keystore, test networks only
btcr2 keystore init --force               # discard the existing keystore and its keys
BTCR2_KEYSTORE_PASSPHRASE='s3cret' btcr2 keystore init   # unattended
```

### status

Shows the resolved keystore path, the protection mode, whether a passphrase is set, the key count, the active key id (if one is set), and the session state. The command never decrypts, never asks for the passphrase, and never fails on a broken config file. It resolves the keystore path in a lenient way: a malformed config file falls back to the home default `<home>/keystore.json` instead of a failure. An unreadable or unknown keystore file reports `absent`.

For a dev keystore, the command prints a stderr warning (`warning: this is an UNENCRYPTED dev keystore; keys are stored in plaintext.`), unless `--quiet` is present or the output mode is `json`.

The data payload:

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
- `established`: for an encrypted keystore, whether the passphrase verifier exists yet (`keystore init` or the first key seal writes it). Always `true` for `dev`. `false` for `absent`.
- `active`: absent if no active key is set.
- `session`: `{ "active": false }` if no live session matches this keystore. A live session adds `expiresAt` (epoch milliseconds), `secondsRemaining`, and `allowMainnet`. The command is read-only: it reports an expired or stale session as inactive, but it does not remove the session.

### change-passphrase

Alias: `passwd`. Changes the keystore passphrase. The command decrypts each sealed key (and the verifier) and seals them again under the new passphrase. Encrypted keystores only.

- If the keystore is absent, the command fails with `No keystore at <path>. Run "btcr2 keystore init" first.`. For a dev keystore, it fails with a dedicated message (no passphrase to change).
- The command gets the current passphrase through the normal chain (`BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then a terminal prompt). So an unattended run can supply the current passphrase.
- You always type the new passphrase at the terminal (twice, and the two entries must match). The command skips the environment variable and the passphrase file for the new passphrase on purpose. Otherwise the same source would satisfy both passphrases, and the change would do nothing. As a result, this subcommand needs a TTY for the new passphrase. With no TTY, it fails with `No passphrase available. Set BTCR2_KEYSTORE_PASSPHRASE, pass --passphrase-file, or run in a terminal.`
- A wrong current passphrase fails against the verifier before any re-seal work.
- If the keystore changes during the re-seal, the command stops with `KEYSTORE_CONCURRENT_CHANGE_ERROR`. It does not leave keys under two passphrases.
- After a successful change, the command deletes the cached session file. The new verifier already invalidates the session by fingerprint, but the file still holds the old passphrase in plaintext (base64url-encoded), so the command removes it.

The data payload: `{ "path": "<keystore path>", "rekeyed": <number of secrets sealed again> }`.

### unlock

Caches the verified keystore passphrase in `<home>/session.json`. A later signing command (`key generate`, `key export`, `update`, `deactivate`, `create` with a generated key) reads it from the session instead of a prompt, until the session expires or `keystore lock` revokes it.

The refusals, in this order, before any cache:

- An absent keystore: `No keystore at <path>. Run "btcr2 init" or "btcr2 keystore init" first.`
- A dev keystore: it has no passphrase to cache, so no unlock is necessary.
- An encrypted keystore with no passphrase yet (no verifier): set one with `btcr2 keystore init` or with the first `btcr2 key generate`.
- The mainnet gate: if the resolved default network is `bitcoin` and `--allow-mainnet` is absent, the command refuses (`MAINNET_UNLOCK_REFUSED_ERROR`). A cached passphrase suspends the per-use authentication for the whole session. The network here is the configured default: config `defaults.network`, else the network of the active profile, else `regtest`. The authoritative check happens again at the read of the session: a `bitcoin` operation (the network comes from the identifier) does not use a session without `allowMainnet`.

The command gets the passphrase directly (`BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then a terminal prompt). It never reads an existing session. It verifies the passphrase against the keystore verifier before the cache. A wrong passphrase fails with `Incorrect passphrase for the keystore at <path>; no session was created.` (`DECRYPT_ERROR`) and writes no session file.

The command writes the session file atomically with mode `0600`. The file records the resolved keystore path, a fingerprint of the passphrase verifier of the keystore (so `change-passphrase` or `init --force` invalidates it), the base64url-encoded passphrase (an encoding, not encryption: the file mode is its only protection at rest), the `allowMainnet` flag, and the creation and expiry timestamps.

The TTL comes from the `--ttl` flag, else `$BTCR2_KEYSTORE_TTL`, else the one-hour default. The value is a bare integer (seconds) or an integer with an `s`, `m`, or `h` suffix, for example `3600`, `45m`, `2h`. The command refuses zero, a negative value, a malformed value, and a value over 24 hours with an error that names the source (`--ttl` or `$BTCR2_KEYSTORE_TTL`). A blank flag defers to the environment variable.

The data payload: `{ "keystore": "<keystore path>", "expiresAt": <epoch milliseconds>, "ttlSeconds": <n> }`.

### lock

Revokes the cached session. The command deletes `<home>/session.json` and removes the temporary files of an atomic write that a crash left next to it (each of them would hold a plaintext passphrase). The command is idempotent and needs no passphrase. It works also with a malformed config file, because the session path comes from the home directory alone (never from `--config`, `--keystore`, or the config file). The unlink removes the file name. It does not erase the bytes in a secure way.

The data payload: `{ "path": "<session path>", "cleared": <boolean> }`. `cleared` is `true` if a session file was present and the command removed it. It is `false` if there was none (or if the removal failed).

## Options

The subcommand flags. Each subcommand also accepts `-h, --help`.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `--dev` (`init`) | boolean | `false` | Create an UNENCRYPTED dev keystore: plaintext keys, no passphrase, no prompt. For throwaway test-network keys only. The other commands of the CLI refuse a mainnet (`bitcoin`) operation with a dev keystore. |
| `--force` (`init`) | boolean | `false` | Create the keystore again, also if one exists. This discards its keys for good. The command prints a stderr warning with the key count if keys are lost (`--quiet` suppresses it). |
| `--ttl <duration>` (`unlock`) | a bare integer in seconds, or an integer with an `s`, `m`, or `h` suffix. It must be more than 0 and at most 24h (for example `3600`, `45m`, `2h`). | `1h` (or `$BTCR2_KEYSTORE_TTL` if set) | The session lifetime of the cached passphrase. |
| `--allow-mainnet` (`unlock`) | boolean | `false` | Permit the unlock if the resolved default network is mainnet (`bitcoin`), and record the permission in the session, so that a mainnet operation can use it. Without it, a mainnet operation keeps the per-use passphrase authentication, also while a session is live. |
| `-h, --help` | | | Print the help of the command or the subcommand. |

`status`, `change-passphrase`, and `lock` take no flag of their own.

## Environment and configuration

The general precedence is: flag, then environment variable, then the profile in the config file, then the built-in default. The exceptions follow per item (the passphrase chain puts the environment variable above the file that the flag names).

The environment variables that the command group reads:

| Variable | Used by | Meaning |
|----------|---------|---------|
| `BTCR2_HOME` | all subcommands | The home directory that holds `config.json`, `keystore.json`, and `session.json`. `--home` wins. The fallback is `~/.btcr2` (Linux and macOS) or `%LOCALAPPDATA%\btcr2` (Windows, then `%APPDATA%\btcr2`, then the user profile). A blank value defers to the next layer. |
| `BTCR2_KEYSTORE_PASSPHRASE` | `init`, `change-passphrase` (the current passphrase only), `unlock` | The keystore passphrase for unattended use. The CLI reads it BEFORE `--passphrase-file`, and it trims a trailing newline. The CLI never uses it for the NEW passphrase in `change-passphrase`. |
| `BTCR2_KEYSTORE_TTL` | `unlock` | The default session TTL, below the `--ttl` flag. The same value format as `--ttl`. |
| `BTCR2_OUTPUT` | all subcommands | The output format (`json` or `text`), below the `-o/--output` flag and above `defaults.output` of the config file. |

The config file keys (`<home>/config.json`, or the file that `-c/--config` names) that feed the command group:

| Key | Used by | Effect |
|-----|---------|--------|
| `defaults.profile` | all subcommands | The active profile if `--profile` is absent. |
| `profiles.<name>.identity.keystore` | all except `lock` | The keystore path of the active profile. The precedence: the `--keystore` flag, then this key, then `<home>/keystore.json`. The CLI reads the key only if a profile is active (through `--profile` or `defaults.profile`). |
| `defaults.network` | `unlock` | The resolved default network drives the mainnet unlock gate: `bitcoin` here refuses `unlock` without `--allow-mainnet`. |
| `profiles.<name>.network` (or a profile with a network name) | `unlock` | The fallback network of the mainnet gate if `defaults.network` is unset. The last fallback is `regtest`. |
| `defaults.output` | all subcommands | The output format if neither `-o/--output` nor `BTCR2_OUTPUT` is set. |

The behavior with a malformed config file differs per subcommand. `init`, `change-passphrase`, and `unlock` fail with a message on an unparseable config file (the profile could move the keystore path, so they do not guess). `status` falls back to the home default keystore path, so that it can still report. `lock` never reads the config file.

The session in short: the session file is `<home>/session.json` (mode `0600`). Only `unlock` (and `quickstart --unlock`) writes it. `lock`, `init`, and `change-passphrase` delete it. The other CLI commands read it when they get a passphrase, in this order: `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then a live session, then the interactive prompt. The CLI removes an expired, stale (passphrase changed), future-dated, or malformed session when it reads it. It leaves a live session of another keystore in place. A `bitcoin` operation never uses a session that you unlocked without `--allow-mainnet`. The step that sets the passphrase (the first seal of a fresh keystore) never reads the session.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. The `keystore` subcommands use `--home <dir>`, `-c, --config <path>`, `--profile <name>`, `--keystore <path>`, `--passphrase-file <path>`, `-o, --output <json|text>`, `--quiet` (suppresses the stderr warnings), and `--verbose` (full error objects). The command group ignores the Bitcoin and CAS connection flags: the subcommands open no network connection.

## Examples

```sh
# Create an encrypted keystore (asks for the passphrase twice)
btcr2 keystore init

# Inspect it: path, protection, key count, session state. Safe at any time.
btcr2 keystore status
btcr2 -o json keystore status

# An unattended creation in a sandbox home
BTCR2_HOME=/tmp/btcr2-demo BTCR2_KEYSTORE_PASSPHRASE='demo-pass' btcr2 keystore init

# Work on mutinynet: record the default network, then unlock for 2 hours
btcr2 config set defaults.network mutinynet
btcr2 keystore unlock --ttl 2h
btcr2 update ...        # signs without a prompt until the session expires

# Revoke the session at the end
btcr2 keystore lock

# Change the passphrase (the current one can come from the environment or a file,
# you always type the new one at the terminal, twice)
btcr2 keystore passwd

# A dev keystore for throwaway regtest keys (plaintext, refused for mainnet)
btcr2 keystore init --dev

# A mainnet default network: the command refuses the unlock without the permission
btcr2 keystore unlock --allow-mainnet
```

## See also

- `btcr2 init`: the home setup in one command, which also creates the keystore.
- `btcr2 quickstart`: the setup that composes `btcr2 init`, `btcr2 keystore unlock` (through `--unlock`), and `btcr2 config doctor`.
- `btcr2 key`: manage the keys in the keystore (generate, import, export, use, delete).
- `btcr2 update` and `btcr2 deactivate`: the signing commands that use the keystore and the session.
- `btcr2 config path`: print the resolved home, config, and keystore paths.
- [DEMO.md](./DEMO.md): the full walkthrough, with the keystore creation and the session unlock.
