# btcr2 identifier

Decodes and validates `did:btcr2` identifiers. The command group has two subcommands. `decode`
prints the components of an identifier. `validate` checks that an identifier conforms to the
identifier decoding algorithm of the specification and prints a report. Both subcommands are
offline and keystore-free: they open no Bitcoin connection, read no CAS, read no keystore, and
never prompt for a passphrase. The CLI calls `api.did.decode`, `api.did.validate`, and
`api.btcr2.getInitialDocument` from `@did-btcr2/api`.

## Synopsis

```
btcr2 identifier decode [options] <did>
btcr2 identifier validate [options] <did>

btcr2 identifier decode did:btcr2:k1qq...
btcr2 identifier decode did:btcr2:k1qq... --initial-document
btcr2 identifier decode did:btcr2:x1qh... --initial-document --genesis-document ./genesis.json
btcr2 identifier validate did:btcr2:k1qq...
btcr2 identifier validate did:btcr2:k1qq... -b 02cb42...
btcr2 identifier validate did:btcr2:x1qh... -b be0db3...
btcr2 identifier validate did:btcr2:x1qh... --genesis-document ./genesis.json
```

The identifier is a positional argument. There is no `-i` flag on this command group.

## decode

Prints the components of the identifier: the identifier type, the Bech32m `hrp`, the version,
the network, and the genesis bytes as hex.

### Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<did>` (positional) | A `did:btcr2` identifier | none (required) | The identifier to decode. An invalid identifier fails before any other step with `Invalid identifier (<check> check): <detail>` (`INVALID_ARGUMENT_ERROR`), where `<check>` is the first failed check of `validate`. |
| `--initial-document` | boolean | `false` | Add the initial DID document to the output. For a `k` identifier the CLI derives the document from the public key with no I/O. For an `x` identifier the CLI needs `--genesis-document`. Without it, the command fails with `An external identifier (x) needs --genesis-document <path> for --initial-document.` (`INVALID_ARGUMENT_ERROR`). |
| `--genesis-document <path>` | file path | none | Path to the JSON genesis document of an `x` identifier. The CLI replaces the placeholder id `did:btcr2:_` with the identifier and prints the result as `initialDocument`. Requires `--initial-document`; without it the command fails with `--genesis-document requires --initial-document.`. For a `k` identifier the command fails with `--genesis-document applies only to external identifiers (x).`. A document whose canonical SHA-256 hash is not the genesis bytes fails with `Initial document mismatch: genesisBytes !== genesisDocumentHash`. |
| `-h, --help` | none | n/a | Print usage for the subcommand and exit. |

Validation order: the flag pair is checked first, then the identifier, then the flag against the
identifier type, then the file is read.

### Output

Text mode (default) prints the data object as 2-space-indented JSON. JSON mode (`-o json`) wraps it
in the CLI result envelope `{ "action": "identifier-decode", "data": { ... } }`.

| Field | Type | Meaning |
|-------|------|---------|
| `did` | string | The identifier, as given. |
| `idType` | `KEY` \| `EXTERNAL` | The identifier type. `KEY` for hrp `k`, `EXTERNAL` for hrp `x`. |
| `hrp` | `k` \| `x` | The Bech32m human-readable part. |
| `version` | number | The did:btcr2 version number. Always `1`. |
| `network` | string | The network name: `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, or `regtest`. |
| `genesisBytes` | hex string | The 33-byte compressed secp256k1 public key (`k`) or the 32-byte SHA-256 hash of the genesis document (`x`). |
| `initialDocument` | object | Only with `--initial-document`: the DID document that the identifier resolves to before any update. |

Example, text mode:

```json
{
  "did": "did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj",
  "idType": "KEY",
  "hrp": "k",
  "version": 1,
  "network": "mutinynet",
  "genesisBytes": "02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000"
}
```

Exit codes: `0` on success, `1` on any error. Errors go to stderr as one message line. `--verbose`
prints the full structured error.

## validate

Runs the checks of the identifier decoding algorithm in order and prints a report. The run stops
at the first failed check. The command never throws on an invalid identifier: the report says
what failed, and the exit code is `1`.

### Checks

| Check | What it confirms | Example failure detail |
|-------|------------------|------------------------|
| `prefix` | The value is a string of the form `did:btcr2:<method-specific-id>` with a non-empty id. | `The identifier must be "did:btcr2:" followed by the method-specific id.` |
| `lowercase` | The method-specific id is lowercase, as the specification requires. | `The method-specific id must be lowercase.` |
| `bech32m` | The id decodes as Bech32m, the hrp is `k` or `x`, and the data bytes are not empty. | `The hrp must be "k" or "x", got "z".` |
| `version` | `btcr2_version` (the high nibble of the first data byte) is `0`. | `btcr2_version must be 0, got 1.` |
| `network` | `network_value` (the low nibble of the first data byte) names a network (`0` to `5`). A reserved value (`6` to `11`) fails. A custom value (`12` to `15`) fails, because this implementation supports no custom network. | `network_value 12 is a custom network, not supported by this implementation.` |
| `genesisBytes` | The remaining bytes are a 33-byte SEC compressed secp256k1 public key (`k`) or a 32-byte SHA-256 hash (`x`). | `Expected a 32-byte SHA-256 hash, got 31 bytes.` |
| `roundTrip` | Encoding the decoded components reproduces the identifier. | `Re-encoding produced "did:btcr2:k1...".` |
| `genesisBytesMatch` | Only with `-b, --bytes`. The supplied bytes equal the genesis bytes of the identifier: the public key of a `k` identifier, the genesis document hash of an `x` identifier. | `Expected 33 genesis bytes for a KEY identifier, got 32.` |
| `genesisDocument` | Only with `--genesis-document`, `x` only. The document id is `did:btcr2:_`, the document is a valid Genesis Document, and its canonical SHA-256 hash equals the genesis bytes. | `The genesis document hash <hex> does not equal the genesis bytes <hex>.` |

### Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<did>` (positional) | any string | none (required) | The identifier to validate. |
| `-b, --bytes <hex>` | hex string | none | The genesis bytes that the identifier must encode, the same value as `create -b`: the 33-byte compressed public key of a `k` identifier, or the 32-byte SHA-256 hash of the genesis document of an `x` identifier. Adds the `genesisBytesMatch` check. A value that is not hex fails with `Invalid bytes: not valid hex.` (`INVALID_ARGUMENT_ERROR`). A wrong length is a failed check in the report, not an argument error. |
| `--genesis-document <path>` | file path | none | Path to the JSON genesis document of an `x` identifier. Adds the `genesisDocument` check. For a valid `k` identifier the command fails with `--genesis-document applies only to external identifiers (x).` before it reads the file. An unreadable path or a file that is not JSON fails with `Invalid genesis document path. Must be a valid path to a JSON file.`. A JSON value that is not an object fails with `Invalid genesis document. The file must contain a JSON object.`. |
| `-h, --help` | none | n/a | Print usage for the subcommand and exit. |

### Output

Text mode (default) prints the report as 2-space-indented JSON. JSON mode (`-o json`) wraps it in
`{ "action": "identifier-validate", "data": { ... } }`.

| Field | Type | Meaning |
|-------|------|---------|
| `did` | string | The identifier, as given. |
| `valid` | boolean | `true` if every check passed. |
| `idType` | `KEY` \| `EXTERNAL` | Present after the `bech32m` check passed. |
| `network` | string | Present after the `network` check passed. |
| `checks` | array | The checks that ran, in run order. Each entry is `{ name, ok, detail? }`. A failed report ends with its failed check. |

Example, an uppercase id:

```json
{
  "did": "did:btcr2:K1Q5PVKSJK8VFXPP0PL6JZWVC4SW7KNMV8Q4L2J5J2VGSJWFRFER2VQQQCX5KSJ",
  "valid": false,
  "checks": [
    { "name": "prefix", "ok": true },
    { "name": "lowercase", "ok": false, "detail": "The method-specific id must be lowercase." }
  ]
}
```

Exit codes: `0` if the identifier is valid. `1` if the identifier is not valid (the report is on
stdout, stderr is empty) and on any error (the message is on stderr).

## Global options

Shared global flags are documented in the [docs README](./README.md#global-options). The
command group uses `-o, --output` (text vs json envelope) and `--verbose` (full structured
error output). The connection overrides, the state-location flags, `--quiet`, `--keystore`,
`--passphrase-file`, and `--signing-key` are accepted but have no effect: the command group
reads no configuration, no keystore, and no endpoint.

## Examples

```sh
# Print the components of a KEY identifier
btcr2 identifier decode did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj

# Print the components and the initial DID document (no chain read)
btcr2 identifier decode did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj --initial-document

# Print the initial DID document of an EXTERNAL identifier from its genesis document
btcr2 identifier decode did:btcr2:x1qh... --initial-document --genesis-document ./genesis.json

# Validate an identifier; the exit code is 1 if it does not conform
btcr2 identifier validate did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj

# Confirm that a KEY identifier encodes this public key (the same bytes as create -b)
btcr2 identifier validate did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj -b 02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000

# Confirm that an EXTERNAL identifier encodes this genesis document hash
btcr2 identifier validate did:btcr2:x1qh... -b be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1

# Validate an EXTERNAL identifier together with its genesis document
btcr2 identifier validate did:btcr2:x1qh... --genesis-document ./genesis.json

# JSON envelope output
btcr2 -o json identifier validate did:btcr2:k1qq...
```

## See also

- `btcr2 create`: mint the identifier that `identifier decode` reads back. `create -b` takes the
  genesis bytes that `identifier validate -b` confirms.
- `btcr2 resolve`: resolve the DID document. `resolve` derives the network from the identifier in
  the same way as `identifier decode`.
- [README](./README.md): global flags, config file reference, and profile semantics.
