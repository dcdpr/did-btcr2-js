# btcr2 create

Creates a `did:btcr2` identifier and, implicitly, its initial DID document. Creation is a pure,
offline encoding step: no Bitcoin or CAS connection is opened, and nothing is broadcast. Two
identifier types exist: `k` (deterministic KEY, encoded from a 33-byte compressed secp256k1 public
key; the initial document is derived deterministically from the identifier) and `x` (EXTERNAL,
encoded from the 32-byte SHA-256 hash of a genesis DID document that you must supply as sidecar
data at resolution time). For `-t k` the command has three mutually exclusive input modes: generate
a fresh key into the keystore (the default), reuse a stored key's public key (`--signing-key`), or
supply raw public-key bytes (`--bytes`, keystore-free). For `-t x` only raw bytes are accepted.

## Synopsis

```
btcr2 create [options]

btcr2 create                                  # -t k: generate a key, store it, set it active
btcr2 create --signing-key <ref>              # -t k: reuse a stored key's public key
btcr2 create -b <66-hex-chars>                # -t k: raw 33-byte compressed public key
btcr2 create -t x -b <64-hex-chars>           # -t x: raw 32-byte genesis document hash
```

There are no subcommands.

## Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-t, --type <type>` | `k` \| `x` | `k` | Identifier type. `k` = deterministic KEY identifier from a compressed secp256k1 public key. `x` = external identifier from a genesis-document hash. Any other value fails with `Invalid type. Must be "k" or "x".` and exit code 1. |
| `-n, --network <network>` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | resolved from config (see below), else `regtest` | The Bitcoin network encoded into the identifier. Creation stays offline; this only fixes which network the identifier (and later resolution/update traffic) targets. An unsupported value fails with `Invalid network. Must be one of "bitcoin", "testnet3", "testnet4", "signet", "mutinynet", or "regtest".` |
| `-b, --bytes <bytes>` | hex string (case-insensitive; surrounding whitespace trimmed) | none | Genesis bytes. For `-t k`: exactly 33 bytes (66 hex chars), a valid compressed secp256k1 public key. For `-t x`: exactly 32 bytes (64 hex chars), the SHA-256 hash of the genesis DID document. Non-hex input fails with `Invalid bytes: not valid hex. ...`; a wrong length fails with `Invalid bytes length for type="<t>": ...`. A 33-byte value that is not a point on the curve is rejected by the method layer (`Expected "genesisBytes" to be a valid compressed secp256k1 public key`). |
| `--signing-key <ref>` (global flag) | key URN (`urn:kms:secp256k1:<32-hex>`), unique keystore `name` tag, or unique fingerprint prefix | none | Selects the existing-key mode for `-t k`: the referenced key's public key becomes the genesis bytes. Resolution order: exact URN match, then unique name-tag match, then unique fingerprint-prefix match (an exact name wins over a fingerprint prefix). Reads public material only, so it never decrypts and never prompts. Fails with `No key matches reference "<ref>".` or an ambiguity error when several keys match. Not valid with `-t x`, and mutually exclusive with `--bytes`. |
| `-h, --help` | none | n/a | Print usage for the command and exit. |

Help-text discrepancy: `--help` describes the `-n` default as "config defaults.network, else
regtest". The source inserts one more step between those two: the active profile's network (see
precedence below). Source behavior wins.

### Input modes for `-t k`

Exactly one of the three modes runs, selected by which inputs are present. `--bytes` together with
`--signing-key` fails with `Provide at most one of --bytes or --signing-key.`

1. **Generate** (neither `--bytes` nor `--signing-key`). Mints a fresh secp256k1 keypair, imports
   it into the keystore, and sets it as the active key. Sealing the secret requires the keystore
   passphrase (see the passphrase section below). On a fresh (absent) keystore this establishes an
   encrypted keystore: an interactive prompt asks twice and requires the entries to match
   (`Passphrases did not match.` otherwise); an env-var or file source is read once without
   confirmation. On an existing encrypted keystore the passphrase is verified against the store's
   verifier. On an unencrypted dev keystore (created by `btcr2 keystore init --dev`) the secret is
   stored in plaintext and no passphrase is ever requested. Mainnet guard (ADR 080): `-n bitcoin`
   with a dev keystore is refused up front (`DEV_KEYSTORE_MAINNET_ERROR`) so a plaintext keystore
   can never hold a mainnet key.
2. **Existing key** (`--signing-key <ref>`). Resolves the reference against the keystore and uses
   that key's public key as genesis bytes. Never decrypts, never prompts. Note: only the explicit
   `--signing-key` flag selects this mode; the active profile's `identity.default` key is not
   consulted by `create` (it applies to `update`/`deactivate` signing only).
3. **Raw bytes** (`--bytes <hex>`). Fully offline and keystore-free; the keystore file is not
   touched and no passphrase machinery runs.

### `-t x` (external)

Raw-bytes only: `--bytes` is required and must be the 32-byte genesis document hash. Omitting it
fails with `External identifiers (-t x) require --bytes <hex>, ...`. Combining `-t x` with
`--signing-key` fails with `--signing-key applies only to deterministic identifiers (-t k).`
No funding hint is printed for external identifiers.

### Output

- **Text mode** (default): stdout carries exactly the DID string. Provenance goes to stderr: the
  generate mode prints `Generated and stored key <urn> (now the active key).`, the existing-key
  mode prints `Using stored key <urn>.`
- **JSON mode** (`-o json`): stdout carries a single JSON object; stderr notes and hints are
  suppressed. Raw-bytes and `-t x` runs print `{ "action": "create", "data": "<did>" }`; the
  generate and existing-key modes add `"keyId"` (the key URN) and `"publicKey"` (hex).

### Stderr hints and warnings

- **Funding hint** (ADR 082): after a `-t k` create on a network with a public faucet (`testnet3`,
  `testnet4`, `signet`, `mutinynet`; never `regtest` or `bitcoin`), a text-mode hint is printed to
  stderr with the DID's derived initial P2WPKH beacon address, the faucet URL, and the explorer
  address URL:

  ```
  Fund the initial beacon to anchor updates:
    Beacon:   <p2wpkh address>
    Faucet:   https://faucet.mutinynet.com/
    Explorer: https://mutinynet.com/address/<p2wpkh address>
  ```

  The beacon address is derived from the DID string alone (the resolver's `#initialP2WPKH`
  service). Suppressed under `--quiet` and under `-o json`; never fatal.
- **Profile/network mismatch warning**: when the active profile declares a network (its `network`
  field, else its own name when that names a network) that differs from the network being encoded,
  a warning is written to stderr (`Warning: creating a "<network>" identifier while the active
  profile "<name>" declares network "<declared>". ...`). It warns, never blocks. Suppressed only by
  `--quiet` (it still prints in JSON mode, on stderr). A malformed config file silently skips this
  warning rather than failing the command.

### Errors

All errors exit with code 1 and print only the message unless `--verbose` is set. Beyond the
per-flag validation above: `PASSPHRASE_REQUIRED_ERROR` when the generate mode needs a passphrase,
none is available from the env var, file, or session, and stdin is not a terminal (message: `No
passphrase available. Set BTCR2_KEYSTORE_PASSPHRASE, pass --passphrase-file, or run in a
terminal.`); an empty or whitespace-only passphrase is also refused. A malformed (unparseable)
`config.json`, or one with a `schemaVersion` newer than the CLI supports, aborts the command
whenever the config must actually be read: default-network resolution (no explicit `-n`) and
keystore-path resolution (generate and existing-key modes). A raw-bytes run with an explicit `-n`
does not depend on a readable config.

## Environment & configuration

Environment variables consulted:

| Variable | Role |
|----------|------|
| `BTCR2_HOME` | Home directory holding `config.json`, `keystore.json`, and `session.json`. Overridden by `--home`. Platform default: `~/.btcr2` on Linux/macOS; `%LOCALAPPDATA%\btcr2` on Windows (falling back to `%APPDATA%\btcr2`, then the user profile). |
| `BTCR2_OUTPUT` | Output format (`json` or `text`) when `-o/--output` is not given. |
| `BTCR2_KEYSTORE_PASSPHRASE` | Keystore passphrase for unattended use. Generate mode only; the highest-precedence passphrase source. At most one trailing newline is trimmed. |

The Bitcoin/CAS endpoint variables (`BTCR2_BTC_REST`, `BTCR2_BTC_RPC_*`, `BTCR2_CAS_*`,
`BTCR2_BTC_TIMEOUT`, `BTCR2_CAS_TIMEOUT`, `BTCR2_FEE_RATE`) are read only by commands that open a
connection; `create` builds its API without a network, so they have no effect here. The same goes
for the corresponding global endpoint flags.

Config-file keys (`<home>/config.json`, or the file named by `-c/--config`) that feed `create`:

| Key | Role |
|-----|------|
| `defaults.network` | Default for `-n` when the flag is absent. |
| `defaults.profile` | Active profile name when `--profile` is absent. |
| `defaults.output` | Default output format below `BTCR2_OUTPUT`. |
| `profiles.<name>.network` | The network the profile declares. Feeds the default-network fallback and the mismatch warning. |
| `profiles.<name>.identity.keystore` | Keystore path for the generate and existing-key modes, below the `--keystore` flag. |

`profiles.<name>.identity.default` is not consulted by `create` (only by `update`/`deactivate`).

Precedence (highest wins; a blank value at any layer defers to the next):

- Network: `-n` flag, then config `defaults.network`, then the active profile's network (its
  explicit `network` field, else the profile name itself when it names a network), then `regtest`.
  There is no environment variable for the network.
- Output format: `-o` flag, then `BTCR2_OUTPUT`, then config `defaults.output`, then `text`.
- Home: `--home` flag, then `BTCR2_HOME`, then the platform default.
- Config path: `-c/--config` flag, then `<home>/config.json`.
- Keystore path: `--keystore` flag, then the active profile's `identity.keystore`, then
  `<home>/keystore.json`.
- Passphrase (generate mode): `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then a live
  session (see below), then an interactive non-echoing prompt.

Session interaction (ADR 081): a session cached by `btcr2 keystore unlock` at `<home>/session.json`
satisfies the passphrase for the generate mode instead of prompting, until it expires or
`btcr2 keystore lock` revokes it. The session is bound to the keystore's verifier, so a rotated
passphrase invalidates it. It is never consulted while establishing a brand-new keystore's
passphrase (a first passphrase is always entered fresh, twice). Note that the session's mainnet
gate (`unlock --allow-mainnet`) is keyed on the network passed to the keystore factory, and
`create` invokes the factory without a network (like the `key` commands); a live session therefore
satisfies `create`'s passphrase on any network, including `-n bitcoin`. The dev-keystore mainnet
refusal above is independent of this and always applies.

## Global options

See the [docs README](./README.md#global-options) for the shared global flags. Globals `create` notably interacts
with: `--signing-key` (selects the existing-key mode), `--keystore`, `--passphrase-file`, `--home`,
`-c/--config`, `--profile`, `-o/--output`, `--quiet` (suppresses the funding hint and the mismatch
warning), and `--verbose` (full error objects). The `--btc-*` and `--cas-*` endpoint flags are
accepted but have no effect on `create`, which never opens a connection.

## Examples

```sh
# Generate a key into the keystore and mint a mutinynet DID
# (prompts for the keystore passphrase; twice on a brand-new keystore)
btcr2 create -n mutinynet

# Same, JSON output: includes keyId and publicKey; stderr hints suppressed
btcr2 create -n mutinynet -o json

# Reuse a stored key by name, fingerprint prefix, or full URN (no prompt)
btcr2 create -n mutinynet --signing-key alice
btcr2 create -n mutinynet --signing-key 3fa2
btcr2 create -n mutinynet --signing-key urn:kms:secp256k1:3fa2e1c09b7d54a6880f13cd21e60b47

# Offline and keystore-free: bring your own 33-byte compressed public key
btcr2 create -n mutinynet -b 0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798

# External identifier from the SHA-256 hash of a genesis DID document
btcr2 create -t x -n mutinynet \
  -b 8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4

# Unattended generate (CI): passphrase from a file, hints suppressed
btcr2 create -n mutinynet --passphrase-file /run/secrets/btcr2-pass --quiet

# Cache the passphrase once, then create without prompting
btcr2 keystore unlock
btcr2 create -n mutinynet
```

## See also

- `btcr2 resolve`: resolve the DID document the identifier produces.
- `btcr2 update` / `btcr2 deactivate`: anchor changes via the funded beacon.
- `btcr2 key`: list, show, import, and activate keystore keys (`--signing-key` references).
- `btcr2 keystore`: establish, inspect, unlock, and lock the keystore.
- `btcr2 quickstart` / `btcr2 init`: set up the home, config, and keystore in one step.
- [DEMO.md](./DEMO.md): full create/fund/resolve/update/deactivate walkthrough.
