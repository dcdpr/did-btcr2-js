# btcr2 create

Creates a `did:btcr2` identifier and, with it, the initial DID document. Creation is an offline step: the command opens no Bitcoin or CAS connection, and it broadcasts nothing. Two identifier types exist. A `k` identifier (deterministic, KEY) encodes a 33-byte compressed secp256k1 public key. The initial DID document derives from the identifier. An `x` identifier (EXTERNAL) encodes the 32-byte SHA-256 hash of a genesis document. You supply that document as sidecar data at resolution time.

For `-t k`, the command has three input modes, and only one applies per run: generate a new key in the keystore (the default), use the public key of a stored key (`--signing-key`), or supply the public key as hex (`--bytes`, no keystore). For `-t x`, the command has two input modes: the genesis document file (`--document`), which the api hashes, or the hash as hex (`--bytes`). `btcr2 genesis build` writes the document file.

## Synopsis

```
btcr2 create [options]

btcr2 create                                  # -t k: generate a key, store it, set it active
btcr2 create --signing-key <ref>              # -t k: use the public key of a stored key
btcr2 create -b <66-hex-chars>                # -t k: a 33-byte compressed public key
btcr2 create -t x --document <path>           # -t x: hash the genesis document file
btcr2 create -t x -b <64-hex-chars>           # -t x: the 32-byte genesis document hash
```

There are no subcommands.

## Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-t, --type <type>` | `k` \| `x` | `k` | The identifier type. `k` = a deterministic KEY identifier from a compressed secp256k1 public key. `x` = an external identifier from a genesis document hash. Another value fails with `Invalid type. Must be "k" or "x".` and exit code 1. |
| `-n, --network <network>` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | from the config (see the precedence below), else `regtest` | The Bitcoin network that the identifier encodes. Creation stays offline. The network only fixes the target of the identifier, and of the later resolution and update traffic. An unsupported value fails with `Invalid network. Must be one of "bitcoin", "testnet3", "testnet4", "signet", "mutinynet", or "regtest".` |
| `-b, --bytes <bytes>` | a hex string (case-insensitive, the command trims whitespace) | none | The genesis bytes. For `-t k`: exactly 33 bytes (66 hex characters), a valid compressed secp256k1 public key. For `-t x`: exactly 32 bytes (64 hex characters), the SHA-256 hash of the genesis document. Non-hex input fails with `Invalid bytes: not valid hex. ...`. A wrong length fails with `Invalid bytes length for type="<t>": ...`. The method layer refuses a 33-byte value that is not a point on the curve (`Expected "genesisBytes" to be a valid compressed secp256k1 public key`). |
| `--document <path>` | file path | none | For `-t x` only: the JSON genesis document to hash, for example the file that `btcr2 genesis build` wrote. The api checks the document (the placeholder id `did:btcr2:_`, the two contexts, a placeholder id in each method and service) and hashes it as written. An unreadable path or non-JSON content fails with `Invalid genesis document path. ...`. A document with a wrong shape fails with the reason, for example `The genesis document id must be "did:btcr2:_", ...`. The flag is exclusive with `--bytes` (`Provide at most one of --bytes or --document.`). With `-t k`, the flag fails with `--document applies only to external identifiers (-t x).`. |
| `--signing-key <ref>` (global flag) | a key URN (`urn:kms:secp256k1:<32-hex>`), a unique keystore `name` tag, or a unique fingerprint prefix | none | Selects the stored-key mode for `-t k`: the public key of the referenced key becomes the genesis bytes. The order of the match: an exact URN, then a unique name tag, then a unique fingerprint prefix. An exact name wins over a fingerprint prefix. The command reads public material only, so it never decrypts and never asks for the passphrase. It fails with `No key matches reference "<ref>".`, or with an ambiguity error if more than one key matches. The flag is not valid with `-t x`, and it is exclusive with `--bytes`. |
| `-h, --help` | none | n/a | Print the help of the command and exit. |

The `--help` text describes the `-n` default as "config defaults.network, else regtest". The source has one more step between the two: the network of the active profile (see the precedence below). The source behavior applies.

### Input modes for `-t k`

Exactly one of the three modes runs. The present inputs select the mode. `--bytes` with `--signing-key` fails with `Provide at most one of --bytes or --signing-key.`

1. **Generate** (neither `--bytes` nor `--signing-key`). The command makes a new secp256k1 key, imports it into the keystore, and sets it as the active key. The seal of the secret key needs the keystore passphrase (see the passphrase section below). On a keystore that does not exist yet, this step creates an encrypted keystore: an interactive prompt asks twice, and the two entries must match (`Passphrases did not match.` otherwise). The command reads an environment variable or a file source once, without a confirmation. On an existing encrypted keystore, the command verifies the passphrase against the verifier of the keystore. On a dev keystore (from `btcr2 keystore init --dev`), the command stores the secret key in plaintext and never asks for a passphrase. Mainnet guard (ADR 080): the command refuses `-n bitcoin` with a dev keystore up front (`DEV_KEYSTORE_MAINNET_ERROR`), so a plaintext keystore never holds a mainnet key.
2. **Stored key** (`--signing-key <ref>`). The command resolves the reference against the keystore and uses the public key of that key as the genesis bytes. It never decrypts and never asks for the passphrase. Only the `--signing-key` flag selects this mode. `create` does not read the `identity.default` key of the active profile. That key applies to the signatures of `update` and `deactivate` only.
3. **Raw bytes** (`--bytes <hex>`). Fully offline, with no keystore. The command does not touch the keystore file, and no passphrase code runs.

### Input modes for `-t x`

Exactly one of the two modes runs. No input fails with `External identifiers (-t x) require --document <path>, the genesis document, or --bytes <hex>, its 32-byte hash. ...`. Both inputs fail with `Provide at most one of --bytes or --document.` `-t x` with `--signing-key` fails with `--signing-key applies only to deterministic identifiers (-t k).`

1. **Document** (`--document <path>`). The api hashes the file as written (JCS canonical form, SHA-256) and encodes the identifier. The result carries the hash as `genesisBytes`. Keep the file: the identifier resolves only with it. On a network with a faucet, a text-mode funding hint names the first beacon of the document.
2. **Raw bytes** (`--bytes <hex>`). The 32-byte genesis document hash, computed elsewhere. The command prints no funding hint, because it does not know the beacons.

### Output

- **Text mode** (default): stdout carries the identifier string only. The source of the key goes to stderr. The generate mode prints `Generated and stored key <urn> (now the active key).` The stored-key mode prints `Using stored key <urn>.`
- **JSON mode** (`-o json`): stdout carries one JSON object. The command prints no stderr notes and no hints. A raw-bytes run prints `{ "action": "create", "data": "<did>" }`. The generate mode and the stored-key mode add `"keyId"` (the key URN) and `"publicKey"` (hex). The `-t x --document` mode adds `"genesisBytes"` (hex, the hash of the document).

### Stderr hints and warnings

- **Funding hint** (ADR 082): after a `-t k` run, or a `-t x --document` run, on a network with a public faucet (`testnet3`, `testnet4`, `signet`, `mutinynet`, never `regtest` or `bitcoin`), the command prints a text-mode hint on stderr. The hint holds the beacon address to fund, the faucet URL, and the explorer URL of the address. For `k`, the address is the initial P2WPKH beacon that derives from the identifier. For `x`, it is the first beacon of the genesis document.

  ```
  Fund the initial beacon to anchor updates:
    Beacon:   <p2wpkh address>
    Faucet:   https://faucet.mutinynet.com/
    Explorer: https://mutinynet.com/address/<p2wpkh address>
  ```

  The `k` beacon address derives from the identifier string alone (the `#initialP2WPKH` service of the resolver). `--quiet` and `-o json` suppress the hint. The hint is never fatal.
- **Profile and network mismatch warning**: if the active profile declares a network that differs from the network of the identifier, the command prints a warning on stderr: `Warning: creating a "<network>" identifier while the active profile "<name>" declares network "<declared>". ...`. The declared network is the `network` field of the profile, else its name if the name is a network. The warning never blocks. Only `--quiet` suppresses it. In JSON mode it still prints, on stderr. A malformed config file skips this warning without a failure.

### Errors

Each error exits with code 1 and prints the message only, unless `--verbose` is set. In addition to the per-flag checks above: `PASSPHRASE_REQUIRED_ERROR` if the generate mode needs a passphrase, no source (environment variable, file, session) has one, and stdin is not a terminal. The message is `No passphrase available. Set BTCR2_KEYSTORE_PASSPHRASE, pass --passphrase-file, or run in a terminal.` The command also refuses an empty or whitespace-only passphrase. A malformed `config.json`, or one with a `schemaVersion` newer than the CLI supports, fails the command if the command must read the config. The command reads the config for the default network (no `-n`) and for the keystore path (the generate mode and the stored-key mode). A raw-bytes run with an explicit `-n` does not read the config.

## Environment and configuration

The command reads these environment variables:

| Variable | Role |
|----------|------|
| `BTCR2_HOME` | The home directory that holds `config.json`, `keystore.json`, and `session.json`. `--home` wins. The platform default: `~/.btcr2` on Linux and macOS. On Windows: `%LOCALAPPDATA%\btcr2`, else `%APPDATA%\btcr2`, else the user profile. |
| `BTCR2_OUTPUT` | The output format (`json` or `text`) if `-o/--output` is absent. |
| `BTCR2_KEYSTORE_PASSPHRASE` | The keystore passphrase for unattended use. Generate mode only. This is the passphrase source with the highest precedence. The CLI trims at most one trailing newline. |

Only a command that opens a connection reads the endpoint variables (`BTCR2_BTC_REST`, `BTCR2_BTC_RPC_*`, `BTCR2_CAS_*`, `BTCR2_BTC_TIMEOUT`, `BTCR2_CAS_TIMEOUT`, `BTCR2_FEE_RATE`, `BTCR2_BTC_SIGNAL_DISCOVERY`). `create` builds its api without a network, so they have no effect here. The same applies to the global endpoint flags.

The config file keys (`<home>/config.json`, or the file that `-c/--config` names) that `create` reads:

| Key | Role |
|-----|------|
| `defaults.network` | The default for `-n` if the flag is absent. |
| `defaults.profile` | The active profile if `--profile` is absent. |
| `defaults.output` | The default output format below `BTCR2_OUTPUT`. |
| `profiles.<name>.network` | The network that the profile declares. It feeds the default network fallback and the mismatch warning. |
| `profiles.<name>.identity.keystore` | The keystore path for the generate mode and the stored-key mode, below the `--keystore` flag. |

`create` does not read `profiles.<name>.identity.default`. Only `update` and `deactivate` read it.

Precedence (the highest wins, and a blank value at one layer defers to the next layer):

- Network: the `-n` flag, then config `defaults.network`, then the network of the active profile, then `regtest`. The network of a profile is its `network` field, else its name if the name is a network. There is no environment variable for the network.
- Output format: the `-o` flag, then `BTCR2_OUTPUT`, then config `defaults.output`, then `text`.
- Home: the `--home` flag, then `BTCR2_HOME`, then the platform default.
- Config path: the `-c/--config` flag, then `<home>/config.json`.
- Keystore path: the `--keystore` flag, then the `identity.keystore` of the active profile, then `<home>/keystore.json`.
- Passphrase (generate mode): `BTCR2_KEYSTORE_PASSPHRASE`, then `--passphrase-file`, then a live session (see below), then an interactive prompt with no echo.

Session (ADR 081): a session that `btcr2 keystore unlock` cached in `<home>/session.json` supplies the passphrase of the generate mode instead of a prompt, until it expires or `btcr2 keystore lock` revokes it. The session is bound to the verifier of the keystore, so a changed passphrase invalidates it. The command never reads the session for the first passphrase of a new keystore. You always type a first passphrase twice. The mainnet gate of the session (`unlock --allow-mainnet`) keys on the network that the keystore factory receives. `create` calls the factory without a network, like the `key` commands. A live session therefore supplies the passphrase of `create` on each network, also with `-n bitcoin`. The dev keystore mainnet refusal above is independent of the session and always applies.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. `create` uses: `--signing-key` (selects the stored-key mode), `--keystore`, `--passphrase-file`, `--home`, `-c/--config`, `--profile`, `-o/--output`, `--quiet` (suppresses the funding hint and the mismatch warning), and `--verbose` (full error objects). The command accepts the `--btc-*` and `--cas-*` endpoint flags, but they have no effect. `create` never opens a connection.

## Examples

```sh
# Generate a key in the keystore and create a mutinynet identifier
# (asks for the keystore passphrase, twice on a new keystore)
btcr2 create -n mutinynet

# The same with JSON output: adds keyId and publicKey, no stderr hints
btcr2 create -n mutinynet -o json

# Use a stored key by name, by fingerprint prefix, or by full URN (no prompt)
btcr2 create -n mutinynet --signing-key alice
btcr2 create -n mutinynet --signing-key 3fa2
btcr2 create -n mutinynet --signing-key urn:kms:secp256k1:3fa2e1c09b7d54a6880f13cd21e60b47

# Offline, no keystore: your own 33-byte compressed public key
btcr2 create -n mutinynet -b 0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798

# An external identifier from a genesis document file (see: btcr2 genesis build)
btcr2 create -t x -n mutinynet --document ./genesis.json

# An external identifier from the SHA-256 hash of a genesis document
btcr2 create -t x -n mutinynet \
  -b 8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4

# Unattended generate (CI): the passphrase from a file, no hints
btcr2 create -n mutinynet --passphrase-file /run/secrets/btcr2-pass --quiet

# Cache the passphrase once, then create without a prompt
btcr2 keystore unlock
btcr2 create -n mutinynet
```

## See also

- `btcr2 genesis build`: build the genesis document that `-t x --document` hashes.
- `btcr2 identifier`: decode and validate the identifier offline.
- `btcr2 resolve`: resolve the DID document of the identifier.
- `btcr2 update` and `btcr2 deactivate`: anchor a change through the funded beacon.
- `btcr2 key`: list, show, import, and activate the keys (`--signing-key` references).
- `btcr2 keystore`: create, inspect, unlock, and lock the keystore.
- `btcr2 quickstart` and `btcr2 init`: set up the home, the config file, and the keystore in one step.
- [DEMO.md](./DEMO.md): the full create, fund, resolve, update, and deactivate walkthrough.
