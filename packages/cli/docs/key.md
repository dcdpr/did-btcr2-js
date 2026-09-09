# btcr2 key

Manages the keys in the keystore. Each subcommand is offline: it opens no Bitcoin or CAS connection, takes no network flag, and prints no faucet or explorer hint. The command group uses the api factory with a keystore. That factory wraps a file-backed key manager over `<home>/keystore.json` (or a configured keystore path). The keystore seals each secret key with argon2id and XChaCha20-Poly1305 under one shared passphrase. Only a subcommand that seals or opens a secret key asks for that passphrase. Use `btcr2 key` to create, inspect, import, export, delete, and select the signing keys that `btcr2 create`, `btcr2 update`, and `btcr2 deactivate` use.

## Synopsis

```
btcr2 key generate [--name <name>] [--set-active]
btcr2 key list|ls
btcr2 key show <ref>
btcr2 key import (--secret-file <path> | --public <hex>) [--name <name>] [--set-active]
btcr2 key export [--secret --out <path>] <ref>
btcr2 key delete|rm [--force] <ref>
btcr2 key use <ref>
btcr2 key help [command]
```

### Key ids and the `<ref>` argument

A URN of the form `urn:kms:secp256k1:<fingerprint>` identifies each stored key. The `<fingerprint>` is the first 16 bytes of the SHA-256 hash of the 33-byte compressed public key, as hex (32 hex characters). The `<ref>` argument of `show`, `export`, `delete`, and `use` resolves in this order:

1. An exact URN match (`urn:kms:secp256k1:...`).
2. A unique exact match on the `name` tag of a key. An exact name wins over a fingerprint prefix, so the fingerprint of another key never hides a hex-like name such as `cafe`.
3. A unique fingerprint prefix match (case-insensitive: the CLI lowercases the reference before the comparison).

A reference that matches more than one key by name or by prefix fails with an ambiguity error (`KEY_REF_AMBIGUOUS_ERROR`). A reference that matches nothing fails with `No key matches reference "<ref>".` (`KEY_NOT_FOUND_ERROR`). The resolution reads public material only, and it never asks for the passphrase.

## Subcommands

### generate

Generates a new secp256k1 key and stores it. The key id derives from the public key as described above. With `--name`, the name must not be in use as the `name` tag of another key (error: `A key named "<name>" already exists.`). With `--set-active`, the new key becomes the active key. The keystore file stores the active pointer, so the active key survives across invocations.

The seal of the new secret key needs the keystore passphrase on an encrypted keystore. On a fresh encrypted keystore (no passphrase yet), this command sets the passphrase: an interactive prompt asks twice, and the two entries must match. The command takes a passphrase from the environment variable or `--passphrase-file` without a confirmation. A dev (plaintext) keystore never asks for a passphrase.

Prints `{ keyId, publicKey, active }`. `publicKey` is the 33-byte compressed public key as 66 hex characters.

```
btcr2 key generate --name signing --set-active
```

### list (alias: ls)

Lists the stored keys. The command never decrypts and never asks for the passphrase. It prints an array of `{ keyId, fingerprint, name?, active }`. `fingerprint` is the hex tail of the URN. `name` appears only for a key with a `name` tag. An absent or empty keystore lists as `[]`.

```
btcr2 key list
```

### show <ref>

Shows the public material and the tags of a key: `{ keyId, publicKey, tags? }`. The command never prints the secret key, never decrypts, and never asks for the passphrase.

```
btcr2 key show signing
```

### import

Imports a key. Exactly one of `--secret-file` or `--public` is required. Both flags, or neither flag, fail with `Provide exactly one of --secret-file or --public.`

- `--secret-file <path>`: the file content (the CLI ignores whitespace around it) must be the hex form of a 32-byte secret key (64 hex characters). An unreadable file, invalid hex, or a wrong length each fail with a specific message. The command seals the secret key into the keystore. On an encrypted keystore, the seal needs the passphrase. On a fresh keystore, the command sets the passphrase with a confirmation.
- `--public <hex>`: a 33-byte compressed secp256k1 public key as 66 hex characters. The command imports it watch-only (no secret key stored). A watch-only import never asks for the passphrase.

`--name` and `--set-active` work as on `generate`. The key id derives from the public key. So an import of a key whose public key is in the keystore already fails with `Key already exists: <keyId>`. This includes the watch-only import of a key that the keystore holds with its secret key.

Prints `{ keyId, publicKey, watchOnly, active }`.

```
btcr2 key import --secret-file ./backup.hex --name restored
btcr2 key import --public 0329d6c65220...c505f0 --name cold-watch
```

### export <ref>

Exports a key. Without `--secret`, the command prints public material only (`{ keyId, publicKey }`). It never decrypts and never asks for the passphrase. The command ignores `--out` without `--secret`.

With `--secret`:

- `--out <path>` is required. Without it, the command fails with `Exporting a secret requires --out <file> so it is not written to the terminal.`
- The command decrypts the secret key. On an encrypted keystore, this needs the passphrase.
- A watch-only key fails with `Key <keyId> is watch-only and has no secret to export.`
- The command prints the warning `warning: writing an unencrypted secret key to disk. Protect this file and delete it when done.` on stderr.
- The command creates the file exclusively (`O_CREAT|O_EXCL`, mode `0600`). It refuses an existing file at `--out` (`Refusing to overwrite existing file <path>. Choose a new --out path.`), and it does not follow a symlink that is in place. The file holds the secret key as 64 hex characters without a trailing newline: the exact format that `import --secret-file` reads.

Prints `{ keyId, secretWrittenTo }` on the secret path.

```
btcr2 key export signing
btcr2 key export signing --secret --out ./backup.hex
```

### delete <ref> (alias: rm)

Deletes a key from the keystore. A delete of the active key without `--force` fails with `Cannot remove active key (use "force": true or switch active key)`. With `--force`, the command removes the key and clears the stored active pointer. The command never decrypts and never asks for the passphrase. It prints `{ keyId, deleted: true }`.

```
btcr2 key delete old-key
btcr2 key delete signing --force
```

### use <ref>

Sets the active key and stores the pointer in the keystore file, so that the active key survives across invocations. A signing command without `--signing-key` falls back to the active key if the active profile sets no `identity.default`. The precedence is: the `--signing-key` flag, then `profiles.<name>.identity.default`, then the active key. A key resolution without a reference also falls back to the active key. The command never decrypts and never asks for the passphrase. It prints `{ keyId, active: true }`.

```
btcr2 key use signing
```

## Options

The `btcr2 key` group itself has no flag except `-h, --help`. The subcommand flags:

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<ref>` (the argument of `show`, `export`, `delete`, `use`) | an exact URN `urn:kms:secp256k1:<32 hex>`, a unique `name` tag, or a unique case-insensitive fingerprint prefix | none (required) | The key to operate on. The resolution order: an exact URN, then an exact unique name, then a unique fingerprint prefix. |
| `--name <name>` | a string, unique among the `name` tags of the stored keys | none | (`generate`, `import`) A name for a person, stored as the `name` tag. It is a valid key reference. |
| `--set-active` | boolean | `false` | (`generate`, `import`) Make the new key the active key. The keystore file stores the pointer. |
| `--secret-file <path>` | the path of a file with 64 hex characters (a 32-byte secret key). The CLI ignores whitespace around them. | none | (`import`) Import a signing key from a hex file. Exclusive with `--public`. Exactly one of the two is required. |
| `--public <hex>` | 66 hex characters (a 33-byte compressed secp256k1 public key) | none | (`import`) Import a public key watch-only. Exclusive with `--secret-file`. |
| `--secret` | boolean | `false` | (`export`) Export the secret key instead of the public material. It requires `--out`. |
| `--out <path>` | the path of a file that does not exist yet | none | (`export`) The destination of the exported secret key. The command creates it exclusively with mode `0600`. The flag has an effect only with `--secret`. |
| `--force` | boolean | `false` | (`delete`) Delete the key also if it is the active key. This also clears the stored active pointer. |
| `-h, --help` | | n/a | (all) Print the help of the command. |

## Environment and configuration

The `key` subcommands are offline (they pass no network to the api factory). So the command group does not read the Bitcoin and CAS endpoint flags, the endpoint environment variables, and the profile `btc` and `cas` blocks. The command group reads these values:

**Environment variables**

| Variable | Effect |
|----------|--------|
| `BTCR2_HOME` | The CLI home directory that holds `config.json`, `keystore.json`, and `session.json`. `--home` wins. |
| `BTCR2_KEYSTORE_PASSPHRASE` | The keystore passphrase for unattended use. The CLI reads it before `--passphrase-file`. The CLI trims at most one trailing newline. The CLI ignores a set but empty value (the resolution falls through to the next source). It refuses a whitespace-only value with `PASSPHRASE_REQUIRED_ERROR`. |
| `BTCR2_OUTPUT` | The default output format (`json` or `text`) below the `-o/--output` flag. |

**The config.json and profile keys**

| Key | Effect |
|-----|--------|
| `defaults.profile` | The active profile if `--profile` is absent. |
| `profiles.<name>.identity.keystore` | The keystore file path if that profile is active. |
| `defaults.output` | The output format below the flag and `BTCR2_OUTPUT`. |

The `key` subcommands do not read `profiles.<name>.identity.default` (the default signing key reference). It feeds `create`, `update`, and `deactivate`.

**Precedence**

- Home directory: the `--home` flag, then `$BTCR2_HOME`, then the platform default. The platform default is `~/.btcr2` on Linux and macOS. On Windows it is `%LOCALAPPDATA%\btcr2`, else `%APPDATA%\btcr2`, else the user profile. A blank value at one layer defers to the next layer.
- Config file: the `-c/--config` flag, then `<home>/config.json`.
- Keystore file: the `--keystore` flag, then the `identity.keystore` of the active profile, then `<home>/keystore.json`. The flag applies before any config read. A config file that exists but does not parse fails a key command with a message (no silent fallback). So a command that changes the keystore never reads or writes the wrong keystore.
- Output format: the `-o/--output` flag, then `BTCR2_OUTPUT`, then `defaults.output`, then `text`.
- Passphrase (here the environment variable outranks the flag): `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file <path>`, then a live session (`<home>/session.json`, from `btcr2 keystore unlock`), then a hidden interactive prompt on stderr. With no source and stdin not a TTY, the command fails with `PASSPHRASE_REQUIRED_ERROR`.

**Passphrase and session**

Only an operation that seals or opens a secret key gets the passphrase, and only on an encrypted keystore: `generate`, `import --secret-file`, and `export --secret`. `list`, `show`, `use`, `delete`, `export` (public), and `import --public` never decrypt and never ask for the passphrase. A dev (plaintext) keystore never asks for a passphrase.

The command reads a cached session only on the path that does not set the passphrase. The session must be live (not expired), bound to the resolved keystore path, and bound to the current passphrase verifier fingerprint of the keystore (so a changed passphrase invalidates it). The CLI removes an expired, stale, future-dated, or malformed session when it reads it. The `key` subcommands pass no network, so a session that you unlocked without `--allow-mainnet` still serves them. The mainnet gate applies at the read of the session to a `bitcoin` identifier operation, not to the key management. The step that sets the passphrase of a fresh keystore never reads the session, and it always confirms an interactive entry twice.

On a fresh home, each `key` subcommand (also a read-only one) creates `<home>` with mode `0700`. The first subcommand that changes the keystore also writes `keystore.json` with mode `0600`.

**Output modes**

In `json` mode, the command prints the full result envelope: `{ "action": "key-<subcommand>", "data": { ... } }`. In `text` mode (the default), it prints the `data` payload only, as pretty JSON (2-space indentation). The subcommand sections above give the payload shape of each subcommand. An error prints its message alone on stderr with exit code 1. `--verbose` prints the full error object and the stack.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. The `key` subcommands use `--home`, `-c/--config`, `--profile`, `--keystore`, `--passphrase-file`, `-o/--output`, and `--verbose`. The connection flags (`--btc-*`, `--cas-*`) and `--signing-key` have no effect on the `key` subcommands.

## Examples

```sh
# Generate a named signing key and make it active
btcr2 key generate --name workshop --set-active

# List the keys (JSON mode)
btcr2 key list -o json

# Show a key by name, by URN, or by fingerprint prefix
btcr2 key show workshop
btcr2 key show urn:kms:secp256k1:1fccacfc2b360548a3e40cba04b3c3fe
btcr2 key show 1fcc

# Unattended generation (a script): the passphrase from a file
btcr2 --passphrase-file ~/.btcr2-pass key generate --name ci-key

# Back up a secret key to a new 0600 file, then restore it in another home
btcr2 key export workshop --secret --out ./workshop.hex
btcr2 --home /tmp/other-home key import --secret-file ./workshop.hex --name workshop

# Import a public key watch-only
btcr2 key import --public 0329d6c652204d8050c57d746794396f7764f1f77834621877fb3739bcb3c505f0 \
  --name cold-watch

# Change the active key, then delete the old one
btcr2 key use workshop
btcr2 key delete old-key

# A stored key as the source of a mutinynet identifier
btcr2 key generate --name mutinynet-demo --set-active
btcr2 create -n mutinynet --signing-key mutinynet-demo
```

## See also

- `btcr2 keystore` (init, status, change-passphrase, unlock, lock): the keystore lifecycle and the session that the key commands use.
- `btcr2 create`, `btcr2 update`, `btcr2 deactivate`: the commands that use the active key or `--signing-key <ref>`.
- `btcr2 config` and `btcr2 profile`: manage `defaults.profile` and `profiles.<name>.identity.keystore`.
- [DEMO.md](./DEMO.md): the CLI walkthrough, with the key setup.
