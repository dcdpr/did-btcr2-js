# btcr2 identifier

Decodes and validates `did:btcr2` identifiers, and manages the identifier records. The command
group has seven subcommands. `decode` prints the components of an identifier. `validate` checks
that an identifier conforms to the identifier decoding algorithm of the specification and prints
a report. `list`, `show`, `add`, `remove`, and `sidecar` manage the identifier records in the
records file `<home>/dids.json` (ADR 133). All subcommands are offline. They open no Bitcoin
connection, read no CAS, and never ask for a passphrase. `decode` and `validate` read no keystore
and no records file. `add` and `list --key` read the public keys of the keystore only. The CLI
calls `api.did.decode`, `api.did.validate`, and `api.btcr2.getInitialDocument` from
`@did-btcr2/api`.

## Synopsis

```
btcr2 identifier decode [options] <did>
btcr2 identifier validate [options] <did>
btcr2 identifier list [-n <network>] [-k <ref>]          (alias: btcr2 identifier ls)
btcr2 identifier show <ref>
btcr2 identifier add <ref> [--name <name>] [-k <ref>] [--sidecar <path>]
btcr2 identifier remove <ref>                            (alias: btcr2 identifier rm)
btcr2 identifier sidecar <ref> [--out <path>]

btcr2 identifier decode did:btcr2:k1qq...
btcr2 identifier decode did:btcr2:k1qq... --initial-document
btcr2 identifier decode did:btcr2:x1qh... --initial-document --genesis-document ./genesis.json
btcr2 identifier validate did:btcr2:k1qq...
btcr2 identifier validate did:btcr2:k1qq... -b 02cb42...
btcr2 identifier validate did:btcr2:x1qh... -b be0db3...
btcr2 identifier validate did:btcr2:x1qh... --genesis-document ./genesis.json
btcr2 identifier list
btcr2 identifier show alice
btcr2 identifier add did:btcr2:k1qq... --name alice
btcr2 identifier sidecar alice --out ./alice-sidecar.json
```

The identifier, or the reference to a record, is an argument. There is no `-i` flag on this
command group. A reference `<ref>` is an identifier or the name of an identifier record (see
[References and names](#references-and-names)).

## decode

Prints the components of the identifier: the identifier type, the Bech32m `hrp`, the version,
the network, and the genesis bytes as hex.

### Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<did>` (the argument) | A `did:btcr2` identifier | none (required) | The identifier to decode. An invalid identifier fails before any other step with `Invalid identifier (<check> check): <detail>` (`INVALID_ARGUMENT_ERROR`), where `<check>` is the first failed check of `validate`. |
| `--initial-document` | boolean | `false` | Add the initial DID document to the output. For a `k` identifier the CLI derives the document from the public key with no I/O. For an `x` identifier the CLI needs `--genesis-document`. Without it, the command fails with `An external identifier (x) needs --genesis-document <path> for --initial-document.` (`INVALID_ARGUMENT_ERROR`). |
| `--genesis-document <path>` | file path | none | Path to the JSON genesis document of an `x` identifier. The CLI replaces the placeholder id `did:btcr2:_` with the identifier and prints the result as `initialDocument`. The flag requires `--initial-document`. Without it, the command fails with `--genesis-document requires --initial-document.`. For a `k` identifier the command fails with `--genesis-document applies only to external identifiers (x).`. A document whose canonical SHA-256 hash is not the genesis bytes fails with `Initial document mismatch: genesisBytes !== genesisDocumentHash`. |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

The validation order: the command checks the flag pair first, then the identifier, then the flag
against the identifier type. Then it reads the file.

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
what failed, and the exit code is `1`. With `-q/--quiet`, the command prints only `OK`, or the
failed check.

### Checks

| Check | What it confirms | Example failure detail |
|-------|------------------|------------------------|
| `prefix` | The value is a string of the form `did:btcr2:<method-specific-id>` with a non-empty id. | `The identifier must be "did:btcr2:" followed by the method-specific id.` |
| `lowercase` | The method-specific id is lowercase, as the specification requires. | `The method-specific id must be lowercase.` |
| `bech32m` | The id decodes as Bech32m, the hrp is `k` or `x`, and the data bytes are not empty. | `The hrp must be "k" or "x", got "z".` |
| `version` | `btcr2_version` (the high nibble of the first data byte) is `0`. | `btcr2_version must be 0, got 1.` |
| `network` | `network_value` (the low nibble of the first data byte) names a network (`0` to `5`). A reserved value (`6` to `11`) fails. A custom value (`12` to `15`) fails, because this implementation supports no custom network. | `network_value 12 is a custom network, not supported by this implementation.` |
| `genesisBytes` | The remaining bytes are a 33-byte SEC compressed secp256k1 public key (`k`) or a 32-byte SHA-256 hash (`x`). | `Expected a 32-byte SHA-256 hash, got 31 bytes.` |
| `roundTrip` | The encoding of the decoded components reproduces the identifier. | `Re-encoding produced "did:btcr2:k1...".` |
| `genesisBytesMatch` | Only with `-b, --bytes`. The supplied bytes equal the genesis bytes of the identifier: the public key of a `k` identifier, the genesis document hash of an `x` identifier. | `Expected 33 genesis bytes for a KEY identifier, got 32.` |
| `genesisDocument` | Only with `--genesis-document`, `x` only. The document id is `did:btcr2:_`, the document is a valid Genesis Document, and its canonical SHA-256 hash equals the genesis bytes. | `The genesis document hash <hex> does not equal the genesis bytes <hex>.` |

### Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<did>` (the argument) | any string | none (required) | The identifier to validate. |
| `-b, --bytes <hex>` | hex string | none | The genesis bytes that the identifier must encode, the same value as `create -b`: the 33-byte compressed public key of a `k` identifier, or the 32-byte SHA-256 hash of the genesis document of an `x` identifier. Adds the `genesisBytesMatch` check. A value that is not hex fails with `Invalid bytes: not valid hex.` (`INVALID_ARGUMENT_ERROR`). A wrong length is a failed check in the report, not an argument error. |
| `--genesis-document <path>` | file path | none | Path to the JSON genesis document of an `x` identifier. Adds the `genesisDocument` check. For a valid `k` identifier the command fails with `--genesis-document applies only to external identifiers (x).` before it reads the file. An unreadable path or a file that is not JSON fails with `Invalid genesis document path. Must be a valid path to a JSON file.`. A JSON value that is not an object fails with `Invalid genesis document. The file must contain a JSON object.`. |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

### Output

Text mode (default) prints the report as 2-space-indented JSON. JSON mode (`-o json`) wraps it in
`{ "action": "identifier-validate", "data": { ... } }`. Text mode with `-q/--quiet` prints `OK`
if the identifier is valid. If a check fails, it prints one line:
`Invalid identifier (<check> check): <detail>` (ADR 130). The table shows the fields of the report.

| Field | Type | Meaning |
|-------|------|---------|
| `did` | string | The identifier, as given. |
| `valid` | boolean | `true` if every check passed. |
| `idType` | `KEY` \| `EXTERNAL` | Present after the `bech32m` check passed. |
| `network` | string | Present after the `network` check passed. |
| `checks` | array | The checks that ran, in run order. Each entry is `{ name, ok, detail? }`. A failed report ends with its failed check. |

Example, an uppercase id. With `-q`, text mode prints:

```
Invalid identifier (lowercase check): The method-specific id must be lowercase.
```

Without `-q`, text mode prints the report:

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

Exit codes: `0` if the identifier is valid. `1` if the identifier is not valid (the output is on
stdout, stderr is empty) and on any error (the message is on stderr).

## Identifier records

An identifier record holds what the CLI knows about one identifier: a name, the keys that the CLI
used for it, the beacon signal transactions, and the sidecar data (ADR 133). With the record, you
do not need to remember the key of an identifier, or keep the sidecar data files yourself.

### The records file

The records file is `<home>/dids.json`. The home is `--home`, else `BTCR2_HOME`, else the platform
default. No other flag and no profile key moves the file. `-c/--config` and `--keystore` do not
move it.

These commands write the records file:

- `create` records each identifier that it makes (see [create.md](./create.md)).
- `update` and `deactivate` record the signing key, the transaction, and the sidecar data after
  the broadcast (see [update.md](./update.md) and [deactivate.md](./deactivate.md)).
- `identifier add` and `identifier remove` change one record.

`resolve`, `update`, and `deactivate` read the record of the identifier. `identifier list`,
`show`, and `sidecar` read the file. `decode` and `validate` never read it.

An absent file holds no records. The first write makes the file with mode `0600`, and makes the
home with mode `0700` if it does not exist. Each write takes the lock file
`<home>/dids.json.lock`, reads the file again, applies the change, and writes the file atomically.
Two CLI processes therefore never lose a change of the other process.

The format of the file:

```json
{
  "v": 1,
  "identifiers": {
    "did:btcr2:k1qgp36s79kzxf56355k5njfyusx8hw34tgd3z0zqgxz3ku28lj27d2xgh97hx6": {
      "name": "alice",
      "added": "2026-09-29T18:05:00.693Z",
      "keys": [ "urn:kms:secp256k1:05c5236951ee7c0eeb2ca64d2159e366" ],
      "signingKey": "urn:kms:secp256k1:05c5236951ee7c0eeb2ca64d2159e366",
      "txids": [ "396ecd5ade939d49e089e24c78fd24ab975ffcbeb3b97d7b0fb608875530adf7" ],
      "sidecar": { "updates": [ { "...": "the signed update" } ] }
    }
  }
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `v` | `1` | The format version of the file. |
| `identifiers` | object | One record for each identifier, in the order of the first record. The key is the identifier. |
| `name` | string, optional | A unique name. `resolve -i`, `update -i`, `deactivate -i`, and the record subcommands accept it in place of the identifier. |
| `added` | ISO 8601 string | The time of the first record. |
| `keys` | array of key URNs | The keys that the CLI used for the identifier, in the order of first use. A record holds key URNs only, never key material. |
| `signingKey` | key URN, optional | The key that signs the next update if `--signing-key` is absent. It is always one of `keys`. |
| `txids` | array of strings | The beacon signal transactions of the updates that the CLI broadcast, in order. |
| `deactivated` | `true`, optional | Present after a `deactivate`. |
| `sidecar` | object | The sidecar data of the identifier: `genesisDocument`, `updates`, `casUpdates`, and `smtProofs`. It is the object that the `sidecar` field of the resolution options holds. |

The CLI writes the fields of a record in the order of this table. Each array holds an entry once:
two entries with the same canonical hash are one entry.

A malformed records file stops the command that reads it, and the CLI never writes over it. The
messages:

- `Could not read the identifier records file <path>: <reason>`
- `The identifier records file <path> is not valid JSON.`
- `The identifier records file <path> is not a version 1 records file.`

`resolve`, `update`, `deactivate`, and the record subcommands refuse to continue. `create` makes
the identifier and prints the warning of a failed record write (see [create.md](./create.md)).

### References and names

A reference `<ref>` names one identifier. A value that starts with `did:` is an identifier, with
or without a record. Any other value is the name of an identifier record. If no record has the
name, the command fails with `No identifier record has the name "<ref>". An identifier starts with "did:btcr2:".` The `-i` flag of
`resolve`, `update`, and `deactivate` accepts the same references.

The rules for a name:

- A name is unique in the records file. A name of another identifier fails with
  `The name "<name>" belongs to the identifier <identifier>.`
- A name must not be empty (`--name must not be empty.`).
- A name must not start with `did:` (`A name must not start with "did:".`).
- A name of an identifier record is not a key name. A key and an identifier record can have the
  same name.
- `--name` on an identifier that has a record replaces the name of the record.

### Privacy

The records file links your keys to your identifiers. It also holds the sidecar data of your
updates. If an update is not in a CAS, its sidecar data is the only way to resolve it. A reader of
the records file can then resolve that update. The CLI writes the file with mode `0600`. Do not
give the file to another party. Give a resolver the output of `identifier sidecar` for one
identifier only.

## list

Prints a summary of each identifier record, in the order of the first record. The summary holds
no transactions and no sidecar data. Use `show` for the full record. `ls` is an alias.

### Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-n, --network <network>` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | none (all networks) | Print only the identifiers of this network. Another value fails with `Invalid network "<value>". Must be one of bitcoin, testnet3, testnet4, signet, mutinynet, regtest.` |
| `-k, --key <ref>` | a key reference: a key URN, a unique key `name` tag, or a unique fingerprint prefix | none (all keys) | Print only the identifiers whose record holds this key in `keys`. The command reads the public keys of the keystore to resolve the reference. It never asks for the passphrase. No match fails with `No key matches reference "<ref>".` An empty value fails with `--key must not be empty.` |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

### Output

Text mode prints an array as 2-space-indented JSON. JSON mode wraps it in
`{ "action": "identifier-list", "data": [ ... ] }`. With no records, the array is empty.

| Field | Type | Meaning |
|-------|------|---------|
| `identifier` | string | The identifier. |
| `name` | string | Present if the record has a name. |
| `network` | string | The network that the identifier encodes. |
| `type` | `k` \| `x` | The hrp of the identifier: `k` for a KEY identifier, `x` for an EXTERNAL identifier. |
| `keys` | array of key URNs | The keys of the record. |
| `signingKey` | key URN | Present if the record has a signing key. |
| `updates` | number | The number of signed updates in the sidecar data of the record. |
| `deactivated` | `true` | Present after a `deactivate`. |

Example, text mode:

```json
[
  {
    "identifier": "did:btcr2:k1qgp5hn9e0ccthv9fqf7rerva29altvf9twe7kf6nwnfxjkggtkvkajsjfdeg6",
    "name": "alice",
    "network": "regtest",
    "type": "k",
    "keys": [ "urn:kms:secp256k1:05c5236951ee7c0eeb2ca64d2159e366" ],
    "signingKey": "urn:kms:secp256k1:05c5236951ee7c0eeb2ca64d2159e366",
    "updates": 0
  }
]
```

## show

Prints the full identifier record of one identifier. The reference is the identifier or the name
of its record.

| Argument or flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<ref>` (the argument) | an identifier or a record name | none (required) | The identifier record to print. An identifier with no record fails with `No identifier record for <identifier>. Use "btcr2 identifier add <identifier>" to add one.` |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

Text mode prints the record as 2-space-indented JSON. JSON mode wraps it in
`{ "action": "identifier-show", "data": { ... } }`. The fields, in this order: `identifier`,
`name` (if present), `network`, `type`, `added`, `keys`, `signingKey` (if present), `txids`,
`deactivated` (if present), and `sidecar`. The [records file](#the-records-file) table explains
each field.

## add

Adds an identifier to the records file, or adds data to its identifier record. The reference is an
identifier, or the name of an identifier record. Use `add` for an identifier that you made before
the records file existed, or with another tool. Use it also to keep the sidecar data that another
party gives you. Then `resolve -i <name>` resolves the identifier with that data and no flags.

The command checks the inputs in this order, before it writes: the reference, the identifier, the
name, the sidecar data file, and the key. An invalid identifier fails with
`Invalid identifier (<check> check): <detail>`, where `<check>` is the first failed check of
`validate`.

### Options

| Argument or flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<ref>` (the argument) | an identifier or a record name | none (required) | The identifier to add, or to add data to. |
| `--name <name>` | a name (see [References and names](#references-and-names)) | none | Set the name of the record. The name replaces a name that the record has. |
| `-k, --key <ref>` | a key reference: a key URN, a unique key `name` tag, or a unique fingerprint prefix | see below | A stored key that signs the next update of the identifier. The key joins `keys` and becomes the `signingKey` of the record. The keystore must hold the key. The command reads public keys only and never asks for the passphrase. No match fails with `No key matches reference "<ref>".` An empty value fails with `--key must not be empty.` |
| `--sidecar <path>` | path of a JSON file with sidecar data | none | Add the sidecar data of the file to the record. See "The sidecar data file" below. |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

Without `-k`, the command looks for the genesis key of a `k` identifier. It does this only if the
record is new, or if the record has no keys. The genesis key is the stored key whose public key is
the genesis bytes of the identifier. If the keystore holds it, the key joins `keys` and becomes the
`signingKey`. An `x` identifier has no genesis key. A record that has keys keeps its signing key.

### The sidecar data file

The file holds one JSON object, the same object that `identifier sidecar` prints. The fields:

| Field | JSON type |
|-------|-----------|
| `@context` | string. The command accepts it and does not keep it. |
| `genesisDocument` | object |
| `updates` | array |
| `casUpdates` | array |
| `smtProofs` | array |

The command merges the file into the record. The genesis document of the record wins over the
genesis document of the file. Each array keeps the entries of the record, then each entry of the
file with a new canonical hash. A second `add` with the same file therefore changes nothing. The
command does not check the entries. The resolver uses an entry only if a beacon signal names its
hash.

The command refuses a file with these messages:

- `Could not read the sidecar data file <path>: <reason>`
- `The sidecar data file <path> must hold a JSON object.`
- `The sidecar data file <path> has the unknown field "<field>".` A resolution options file has
  the field `sidecar`. For it, the message adds
  `The file holds resolution options: use the object in its "sidecar" field.`
- `The field "<field>" of the sidecar data file <path> must be a JSON <type>.`

### Output

The full record, as `show` prints it. JSON mode wraps it in
`{ "action": "identifier-add", "data": { ... } }`.

## remove

Removes the identifier record of one identifier. The keys stay in the keystore. The sidecar data of
the record goes with the record. If an update is not in a CAS, keep a copy with
`identifier sidecar --out` first. `rm` is an alias.

| Argument or flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<ref>` (the argument) | an identifier or a record name | none (required) | The identifier record to remove. An identifier with no record fails with `No identifier record for <identifier>.` |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

Text mode prints `{ "identifier": "<identifier>", "removed": true }`. JSON mode wraps it in
`{ "action": "identifier-remove", "data": { ... } }`.

## sidecar

Prints the sidecar data of one identifier record. The output is the object that the `sidecar`
field of the resolution options holds. It is also the file format of `identifier add --sidecar`.
Give it to a party that must resolve an update that is not in a CAS. A record with no sidecar data
prints `{}`.

| Argument or flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<ref>` (the argument) | an identifier or a record name | none (required) | The identifier record to read. An identifier with no record fails with `No identifier record for <identifier>.` |
| `--out <path>` | file path | none (stdout) | Write the sidecar data to a new file with mode `0600`, and print `{ "identifier", "path" }`. The command never writes over a file: a file at the path fails with `The file <path> exists. Choose a new --out path.` |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

Text mode prints the sidecar data as 2-space-indented JSON. JSON mode wraps it in
`{ "action": "identifier-sidecar", "data": { ... } }`. Use `--out` for a file that holds only the
sidecar data, also in JSON mode.

## Environment and configuration

`decode` and `validate` read no environment variable and no config file, except the output
format. The record subcommands read these values:

| Variable | Role |
|----------|------|
| `BTCR2_HOME` | The home that holds the records file `dids.json`. `--home` wins. |
| `BTCR2_OUTPUT` | The output format (`json` or `text`) if `-o/--output` is absent. |

`add` and `list --key` read the keystore at this path: the `--keystore` flag, else the
`identity.keystore` of the active profile, else `<home>/keystore.json`. They read public keys only,
so the passphrase sources and the session have no effect.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. The command group
uses `-o, --output` (text or the JSON envelope), `-q, --quiet` (the short result of `validate` in
text mode), and `--verbose` (the full structured error). The record subcommands use `--home` (the
home of the records file). `add` and `list --key` also use `--keystore`, `-c/--config`, and
`--profile` (the keystore path). The connection overrides and `--passphrase-file` have no effect:
the command group reads no endpoint and decrypts no key.

## Examples

```sh
# Print the components of a KEY identifier
btcr2 identifier decode did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj

# Print the components and the initial DID document (no chain read)
btcr2 identifier decode did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj --initial-document

# Print the initial DID document of an EXTERNAL identifier from its genesis document
btcr2 identifier decode did:btcr2:x1qh... --initial-document --genesis-document ./genesis.json

# Validate an identifier. The exit code is 1 if it does not conform
btcr2 identifier validate did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj

# Confirm that a KEY identifier encodes this public key (the same bytes as create -b)
btcr2 identifier validate did:btcr2:k1q5pvksjk8vfxpp0pl6jzwvc4sw7knmv8q4l2j5j2vgsjwfrfer2vqqqcx5ksj -b 02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000

# Confirm that an EXTERNAL identifier encodes this genesis document hash
btcr2 identifier validate did:btcr2:x1qh... -b be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1

# Validate an EXTERNAL identifier together with its genesis document
btcr2 identifier validate did:btcr2:x1qh... --genesis-document ./genesis.json

# Print only OK, or the failed check
btcr2 identifier validate did:btcr2:k1qq... -q

# JSON envelope output
btcr2 -o json identifier validate did:btcr2:k1qq...

# List the identifier records, then only the mutinynet identifiers of one key
btcr2 identifier list
btcr2 identifier ls -n mutinynet -k alice-key

# Show the record of an identifier by its name: the keys, the transactions, the sidecar data
btcr2 identifier show alice

# Add an identifier that you made before the records file existed. For a KEY
# identifier, the command links the stored key of the genesis bytes
btcr2 identifier add did:btcr2:k1qq... --name alice

# Select the key that signs the next update of the identifier
btcr2 identifier add alice -k 3fa2

# Give the sidecar data to another party. The party adds it to its own records
# and resolves the identifier with no flags
btcr2 identifier sidecar alice --out ./alice-sidecar.json
btcr2 identifier add did:btcr2:k1qq... --name alice --sidecar ./alice-sidecar.json
btcr2 resolve -i alice

# Pass the sidecar data to a resolution without a record
btcr2 resolve -i did:btcr2:k1qq... -r "$(jq -c '{sidecar: .}' ./alice-sidecar.json)"

# Remove the record. The keys stay in the keystore
btcr2 identifier rm alice
```

## See also

- `btcr2 create`: create the identifier that `identifier decode` reads back. `create -b` takes the
  genesis bytes that `identifier validate -b` confirms. `create` also records the identifier, and
  `create --name` names the record.
- `btcr2 update` and `btcr2 deactivate`: sign with the signing key of the record, and add the
  transaction and the sidecar data to the record.
- `btcr2 resolve`: resolve the DID document. `resolve` reads the network from the identifier in
  the same way as `identifier decode`. It uses the sidecar data of the record.
- `btcr2 key`: list the keys that `identifier add -k` and `identifier list -k` name.
- `btcr2 genesis build`: write the genesis document that `identifier validate --genesis-document`
  checks.
- [README](./README.md): the global flags, the config file reference, and the profile rules.
