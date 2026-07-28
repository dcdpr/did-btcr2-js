# btcr2 key

Manages keypairs in the encrypted on-disk keystore. All subcommands operate offline: they open no
Bitcoin or CAS connection, take no network flag, and print no faucet or explorer hints. The command
group is backed by the keystore-aware API factory, which wraps a file-backed key manager over
`<home>/keystore.json` (or a configured keystore path); secret keys are sealed per entry with
argon2id + XChaCha20-Poly1305 under one shared passphrase, and only the subcommands that actually
seal or open a secret ever ask for that passphrase. Use `btcr2 key` to create, inspect, import,
export, delete, and select the signing keys that `btcr2 create`, `btcr2 update`, and
`btcr2 deactivate` later use.

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

### Key identifiers and the `<ref>` positional

Every stored key is identified by a URN of the form `urn:kms:secp256k1:<fingerprint>`, where
`<fingerprint>` is the first 16 bytes of SHA-256 over the 33-byte compressed public key, hex-encoded
(32 hex chars). The `<ref>` positional accepted by `show`, `export`, `delete`, and `use` resolves in
this order:

1. Exact URN match (`urn:kms:secp256k1:...`).
2. Unique exact match on a key's `name` tag. An exact name wins over a fingerprint prefix, so a
   hex-looking name such as `cafe` is never shadowed by another key's fingerprint.
3. Unique fingerprint prefix match (case-insensitive; the ref is lowercased before comparison).

A ref matching more than one key by name or by prefix fails with an ambiguity error
(`KEY_REF_AMBIGUOUS_ERROR`); a ref matching nothing fails with `No key matches reference "<ref>".`
(`KEY_NOT_FOUND_ERROR`). Resolution reads only public material and never triggers a passphrase
prompt.

## Subcommands

### generate

Generates a new secp256k1 keypair and stores it. The key identifier is derived from the public key
as described above. When `--name` is given, the name must not already be in use by another key's
`name` tag (error: `A key named "<name>" already exists.`). With `--set-active` the new key becomes
the active key, and the active pointer is persisted in the keystore file so it survives across
invocations.

Sealing the new secret requires the keystore passphrase on an encrypted keystore. On a fresh
encrypted keystore (no passphrase established yet) this command establishes it: an interactive
prompt asks twice and requires both entries to match; a passphrase from the environment variable or
`--passphrase-file` is accepted without confirmation. A dev (plaintext) keystore never prompts.

Prints `{ keyId, publicKey, active }`, where `publicKey` is the 33-byte compressed public key as 66
hex chars.

```
btcr2 key generate --name signing --set-active
```

### list (alias: ls)

Lists stored keys. Never decrypts and never prompts. Prints an array of
`{ keyId, fingerprint, name?, active }`, where `fingerprint` is the hex tail of the URN and `name`
appears only for keys carrying a `name` tag. An absent or empty keystore lists as `[]`.

```
btcr2 key list
```

### show <ref>

Shows a key's public material and tags: `{ keyId, publicKey, tags? }`. Never prints the secret,
never decrypts, never prompts.

```
btcr2 key show signing
```

### import

Imports a key. Exactly one of `--secret-file` or `--public` is required; providing both or neither
fails with `Provide exactly one of --secret-file or --public.`

- `--secret-file <path>`: the file's contents (surrounding whitespace ignored) must be the hex
  encoding of a 32-byte secret key (64 hex chars). Unreadable file, invalid hex, or a wrong length
  each fail with a specific message. The secret is sealed into the keystore, which requires the
  passphrase on an encrypted keystore (and establishes it, with confirmation, on a fresh one).
- `--public <hex>`: a 33-byte compressed secp256k1 public key as 66 hex chars, imported watch-only
  (no secret stored). Watch-only import never prompts for a passphrase.

`--name` and `--set-active` behave as on `generate`. Because the key identifier is derived from the
public key, importing a key whose public key already exists in the store fails with
`Key already exists: <keyId>` - including importing the watch-only form of a key already held with
its secret.

Prints `{ keyId, publicKey, watchOnly, active }`.

```
btcr2 key import --secret-file ./backup.hex --name restored
btcr2 key import --public 0329d6c65220...c505f0 --name cold-watch
```

### export <ref>

Exports a key. Without `--secret`, prints only public material (`{ keyId, publicKey }`) and never
decrypts or prompts; a `--out` given without `--secret` is ignored.

With `--secret`:

- `--out <path>` is required; omitting it fails with
  `Exporting a secret requires --out <file> so it is not written to the terminal.`
- The secret is decrypted, which requires the passphrase on an encrypted keystore.
- A watch-only key fails with `Key <keyId> is watch-only and has no secret to export.`
- The warning `warning: writing an unencrypted secret key to disk. Protect this file and delete it
  when done.` is written to stderr.
- The file is created exclusively (`O_CREAT|O_EXCL`, mode `0600`): an existing file at `--out` is
  refused (`Refusing to overwrite existing file <path>. Choose a new --out path.`), and a
  pre-placed symlink is not followed. The file contains the secret as 64 hex chars with no trailing
  newline, the exact format `import --secret-file` reads back.

Prints `{ keyId, secretWrittenTo }` on the secret path.

```
btcr2 key export signing
btcr2 key export signing --secret --out ./backup.hex
```

### delete <ref> (alias: rm)

Deletes a key from the keystore. Deleting the active key without `--force` fails with
`Cannot remove active key (use "force": true or switch active key)`; with `--force` the key is
removed and the persisted active pointer is cleared. Never decrypts, never prompts. Prints
`{ keyId, deleted: true }`.

```
btcr2 key delete old-key
btcr2 key delete signing --force
```

### use <ref>

Sets the active key and persists the pointer in the keystore file, so "the active key" survives
across CLI invocations. The active key is what `--signing-key`-less signing commands fall back to
when the active profile sets no `identity.default` (precedence: `--signing-key` flag, then
`profiles.<name>.identity.default`, then the active key), and what no-ref key resolution falls
back to. Never decrypts, never prompts. Prints `{ keyId, active: true }`.

```
btcr2 key use signing
```

## Options

The `btcr2 key` group itself has no options besides `-h, --help`. Subcommand flags:

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<ref>` (positional on `show`, `export`, `delete`, `use`) | exact URN `urn:kms:secp256k1:<32 hex>`, a unique `name` tag, or a unique case-insensitive fingerprint prefix | none (required) | The key to operate on. Resolution order: exact URN, then exact unique name, then unique fingerprint prefix. |
| `--name <name>` | free-form string; must be unique among stored keys' `name` tags | none | (`generate`, `import`) Human-friendly name stored as the `name` tag and usable as a key reference. |
| `--set-active` | boolean switch | `false` | (`generate`, `import`) Make the new key the active key; the pointer is persisted in the keystore file. |
| `--secret-file <path>` | path to a file whose contents are 64 hex chars (a 32-byte secret key); surrounding whitespace ignored | none | (`import`) Import a signing key from a hex file. Mutually exclusive with `--public`; exactly one of the two is required. |
| `--public <hex>` | 66 hex chars (a 33-byte compressed secp256k1 public key) | none | (`import`) Import a public key watch-only. Mutually exclusive with `--secret-file`. |
| `--secret` | boolean switch | `false` | (`export`) Export the secret key instead of public material. Requires `--out`. |
| `--out <path>` | path to a file that must not already exist | none | (`export`) Destination for the exported secret, created exclusively with mode `0600`. Only meaningful with `--secret`. |
| `--force` | boolean switch | `false` | (`delete`) Delete even if the key is the active key (also clears the persisted active pointer). |
| `-h, --help` | switch | n/a | (all) Display help for the command. |

## Environment & configuration

Because `key` subcommands are offline (no network is passed to the API factory), the Bitcoin/CAS
endpoint flags, environment variables, and profile `btc`/`cas` blocks are not consulted. What does
feed this command:

**Environment variables**

| Variable | Effect |
|----------|--------|
| `BTCR2_HOME` | The CLI home directory holding `config.json`, `keystore.json`, and `session.json`. Overridden by `--home`. |
| `BTCR2_KEYSTORE_PASSPHRASE` | Supplies the keystore passphrase for unattended use. Consulted before `--passphrase-file`. At most one trailing newline is trimmed. A set-but-empty value is ignored (resolution falls through to the next source); a whitespace-only value is rejected with `PASSPHRASE_REQUIRED_ERROR`. |
| `BTCR2_OUTPUT` | Default output format (`json` or `text`) below the `-o/--output` flag. |

**config.json / profile keys**

| Key | Effect |
|-----|--------|
| `defaults.profile` | Names the active profile when no `--profile` flag is given. |
| `profiles.<name>.identity.keystore` | Keystore file path used when that profile is active. |
| `defaults.output` | Output format below the flag and `BTCR2_OUTPUT`. |

`profiles.<name>.identity.default` (the default signing-key ref) is not consulted by `key`
subcommands; it feeds `create`/`update`/`deactivate`.

**Precedence**

- Home directory: `--home` flag, then `$BTCR2_HOME`, then the platform default (`~/.btcr2` on
  Linux/macOS; `%LOCALAPPDATA%\btcr2` on Windows, falling back to `%APPDATA%\btcr2`, then the user
  profile). A blank value at any layer defers to the next.
- Config file: `-c/--config` flag, then `<home>/config.json`.
- Keystore file: `--keystore` flag, then the active profile's `identity.keystore`, then
  `<home>/keystore.json`. The flag short-circuits before any config read. A config file that exists
  but cannot be parsed aborts key commands loudly (no silent fallback), so a keystore-mutating
  command never reads or writes the wrong store.
- Output format: `-o/--output` flag, then `BTCR2_OUTPUT`, then `defaults.output`, then `text`.
- Passphrase (note: here the environment variable outranks the flag):
  `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file <path>`, then a live session
  (`<home>/session.json`, created by `btcr2 keystore unlock`), then a hidden interactive prompt on
  stderr. With no source available and stdin not a TTY, the command fails with
  `PASSPHRASE_REQUIRED_ERROR`.

**Passphrase and session interaction**

Only operations that seal or open a secret acquire the passphrase, and only on an encrypted
keystore: `generate`, `import --secret-file`, and `export --secret`. `list`, `show`, `use`,
`delete`, `export` (public), and `import --public` never decrypt and never prompt. A dev
(plaintext) keystore never prompts at all.

A cached session is consumed only on the non-establishing path: it must be live (not expired), bound
to the resolved keystore path, and bound to the keystore's current passphrase-verifier fingerprint
(so a rotated passphrase invalidates it). Expired, stale, future-dated, or malformed sessions are
pruned on read. Because `key` subcommands pass no network, a session unlocked without
`--allow-mainnet` still serves them; the mainnet gate applies at consumption time to `bitcoin`
DID operations, not to key management. Establishing a fresh keystore's passphrase never consults the
session and always confirms an interactive entry twice.

On a fresh home, the first mutating `key` command creates `<home>` with mode `0700` and writes
`keystore.json` with mode `0600`.

**Output modes**

In `json` mode the full result envelope is printed:
`{ "action": "key-<subcommand>", "data": { ... } }`. In `text` mode (the default) only the `data`
payload is printed, pretty-printed as JSON (2-space indent). The payload shapes per subcommand are
given in each subcommand section above. Errors print their message alone to stderr with exit code 1;
`--verbose` prints the full error object and stack.

## Global options

Shared global flags are documented in the [docs README](./README.md#global-options). Globals this command
notably interacts with: `--home`, `-c/--config`, `--profile`, `--keystore`, `--passphrase-file`,
`-o/--output`, and `--verbose`. The connection globals (`--btc-*`, `--cas-*`) and `--signing-key`
have no effect on `key` subcommands.

## Examples

```sh
# Generate a named signing key and make it active
btcr2 key generate --name workshop --set-active

# Inspect the inventory (json mode)
btcr2 key list -o json

# Show a key by name, URN, or fingerprint prefix
btcr2 key show workshop
btcr2 key show urn:kms:secp256k1:1fccacfc2b360548a3e40cba04b3c3fe
btcr2 key show 1fcc

# Unattended generation (scripted): passphrase from a file
btcr2 --passphrase-file ~/.btcr2-pass key generate --name ci-key

# Back up a secret to a new 0600 file, then restore it elsewhere
btcr2 key export workshop --secret --out ./workshop.hex
btcr2 --home /tmp/other-home key import --secret-file ./workshop.hex --name workshop

# Import a public key watch-only
btcr2 key import --public 0329d6c652204d8050c57d746794396f7764f1f77834621877fb3739bcb3c505f0 \
  --name cold-watch

# Switch the active key, then delete the old one
btcr2 key use workshop
btcr2 key delete old-key

# Typical flow before minting a DID on mutinynet: the active key signs the create
btcr2 key generate --name mutinynet-demo --set-active
btcr2 create -n mutinynet
```

## See also

- `btcr2 keystore` (init, status, change-passphrase, unlock, lock): keystore lifecycle and the
  session unlock agent that key commands consume.
- `btcr2 create`, `btcr2 update`, `btcr2 deactivate`: the signing commands that use the active key
  or `--signing-key <ref>`.
- `btcr2 config` and `btcr2 profile`: manage `defaults.profile` and
  `profiles.<name>.identity.keystore`.
- [DEMO.md](./DEMO.md): the end-to-end CLI walkthrough, including key setup.
