# btcr2 genesis

Builds the genesis document of an external (`x`) `did:btcr2` identifier. The command group has
one subcommand, `build`. It builds the document from your keys, beacons, and services, writes the
document to a file, and prints the identifier that encodes the hash of that file. The command is
offline: it derives the beacon addresses from the keys and opens no Bitcoin connection. It reads
public keys from the keystore and never asks for the passphrase. The CLI calls
`api.btcr2.buildGenesisDocument`, `api.btcr2.createExternalFromDocument`, and
`api.btcr2.getBeacons` from `@did-btcr2/api`.

Keep the written file. An external identifier resolves only with its genesis document. Pass the
file with `--genesis-document <path>` to `resolve`, `update`, and `deactivate`, or publish it to a
CAS.

## Synopsis

```
btcr2 genesis build [options]

btcr2 genesis build                              # asks questions on the terminal
btcr2 genesis build -n mutinynet --out ./alice.json
btcr2 genesis build --spec ./spec.json           # no questions
btcr2 genesis build --spec ./spec.json --out ./alice.json --force
```

## build

### Two modes

- **Wizard** (no `--spec`). The command asks for the verification methods, their relationships,
  the beacons, and the services. It needs a terminal. Without one it fails with
  `No terminal is attached. Pass --spec <path> to build the genesis document without prompts.`
- **Spec file** (`--spec <path>`). The command reads the same content from a JSON file and asks
  nothing. Use it in scripts and in CI.

### Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-n, --network <network>` | `bitcoin` \| `testnet3` \| `testnet4` \| `signet` \| `mutinynet` \| `regtest` | config `defaults.network`, then the network of the active profile, then `regtest` | The network of the beacon addresses and of the identifier. The same precedence as `create -n`. An unsupported value fails with `Invalid network. ...`. |
| `--spec <path>` | file path | none | A JSON spec file (see below). The command asks nothing. An unreadable path or a file that is not JSON fails with `Invalid genesis spec path. Must be a valid path to a JSON file.`. A file with the wrong shape fails with `Invalid genesis spec: ...`. |
| `--out <path>` | file path | `genesis.json` | Where the command writes the genesis document. The printed `path` is the absolute path. |
| `--force` | boolean | `false` | Overwrite an existing `--out` file. Without it, an existing file fails with `The file <path> exists. Pass --force to overwrite it, or --out <path> for another file.` before any question. |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

### The wizard

The wizard prints the keys of the keystore, then asks these questions. A blank answer takes the
default in brackets.

1. `Verification method 1: key reference or public key hex [<active key>]`. A key reference is a
   URN, a name, or a fingerprint prefix. A 33-byte compressed public key as hex (66 characters)
   needs no keystore. An unknown reference prints the error and asks again.
2. `Relationships of method 1 (comma-separated: authentication, assertionMethod,
   capabilityInvocation, capabilityDelegation) [all]`. An unknown name asks again.
3. `Add another verification method? [y/N]`. Yes repeats steps 1 and 2 with no default key.
4. `Beacon 1 type (SingletonBeacon, CASBeacon, SMTBeacon) [SingletonBeacon]`.
5. `Beacon 1 address (blank: derive the address from the key of method 1)`. Type the Bitcoin
   address of an aggregation cohort here for a CAS or SMT beacon. Blank derives the address from
   the first key and asks `Beacon 1 address type (p2pkh, p2wpkh, p2tr) [p2wpkh]`.
6. `Add another beacon? [y/N]`.
7. `Add a service? [y/N]`. Yes asks for the id fragment (blank for `service-<position>`), the type,
   and the endpoint, then asks again.

The questions go to stderr, so `-o json` output on stdout stays clean.

### The spec file

The file that `--spec` reads, and the answers that the wizard collects, have this shape. The
network is not in the file. It comes from `-n` or from the config.

```json
{
  "verificationMethods": [
    { "key": "alice", "relationships": ["authentication", "capabilityInvocation"] },
    { "publicKey": "02cb42...c000", "relationships": ["assertionMethod"], "fragment": "assert" }
  ],
  "beacons": [
    { "type": "SingletonBeacon", "key": "alice", "addressType": "p2wpkh" },
    { "type": "SMTBeacon", "address": "tb1p..." }
  ],
  "services": [
    { "id": "#website", "type": "LinkedDomains", "serviceEndpoint": "https://example.com" }
  ]
}
```

| Field | Required | Meaning |
|-------|----------|---------|
| `verificationMethods[]` | yes, at least one | One entry per key. Exactly one of `key` (a keystore reference: URN, name, or fingerprint prefix) or `publicKey` (a 33-byte compressed public key as hex). `relationships` is a subset of the four names. If absent, all four apply. `fragment` is the id fragment without `#`. If absent, it is `key-<index>`. |
| `beacons[]` | no | One entry per beacon. `type` is `SingletonBeacon`, `CASBeacon`, or `SMTBeacon`. Give `key` or `publicKey` to derive the address from a key, with `addressType` `p2pkh`, `p2wpkh` (default), or `p2tr`. Or give `address`, a Bitcoin address of the network, for the address of an aggregation cohort. `fragment` defaults to `service-<index>`. If `beacons` is absent, the document has one Singleton beacon with the P2WPKH address of the first key. |
| `services[]` | no | Other services, after the beacons. `id` is a fragment (`#name`) or a full id that contains `did:btcr2:_`. If absent, it is `service-<position>`. `type` and `serviceEndpoint` are required. The api refuses a beacon type here: declare a beacon under `beacons`. |

The api refuses a spec that cannot produce an updatable identifier: no verification method with
`capabilityInvocation`, or no beacon. It refuses an address that is not a P2PKH, P2WPKH, or P2TR
address of the network, an unknown relationship, an unknown beacon type, and two entries with one
id. The command prints the reason and writes no file.

### The document

The command writes the genesis document as pretty JSON, and it hashes the parsed form of that
file. The document has the placeholder id `did:btcr2:_` in every id and controller, the two
required contexts, one `Multikey` verification method per key, the relationships that the keys
name, one beacon service per beacon with a `bitcoin:<address>` endpoint, and the other services.

```json
{
  "id": "did:btcr2:_",
  "@context": ["https://www.w3.org/ns/did/v1.1", "https://btcr2.dev/context/v1"],
  "verificationMethod": [
    {
      "id": "did:btcr2:_#key-0",
      "type": "Multikey",
      "controller": "did:btcr2:_",
      "publicKeyMultibase": "zQ3s..."
    }
  ],
  "authentication": ["did:btcr2:_#key-0"],
  "assertionMethod": ["did:btcr2:_#key-0"],
  "capabilityInvocation": ["did:btcr2:_#key-0"],
  "capabilityDelegation": ["did:btcr2:_#key-0"],
  "service": [
    { "id": "did:btcr2:_#service-0", "type": "SingletonBeacon", "serviceEndpoint": "bitcoin:tb1q..." }
  ]
}
```

### Output

Text mode (default) prints the data object as 2-space-indented JSON, then a hint on stderr that
names the file and, on a network with a faucet, the first beacon address with the faucet and
explorer links. `--quiet` removes the hint. JSON mode (`-o json`) wraps the data in
`{ "action": "genesis-build", "data": { ... } }` and prints no hint.

| Field | Type | Meaning |
|-------|------|---------|
| `did` | string | The external identifier. |
| `network` | string | The network of the identifier. |
| `genesisBytes` | hex string | The SHA-256 hash of the canonical genesis document: the genesis bytes of `did`. |
| `path` | string | The absolute path of the written document. |
| `beacons` | array | One `{ id, type, address }` per beacon service of the initial DID document. Fund `address` before the first update. |

Exit codes: `0` on success, `1` on any error. Errors go to stderr as one message line. `--verbose`
prints the full structured error.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. The command uses
`-o, --output`, `--quiet`, `--verbose`, the state location flags (`--home`, `-c, --config`,
`--profile`), and the keystore flags (`--keystore`, `--passphrase-file`). The keystore opens only
for a key reference or for the wizard, and only for public reads. The command accepts the
connection overrides (`--btc-*`, `--cas-*`) and `--signing-key`, but they have no effect.

## Examples

```sh
# Ask the questions on the terminal; write genesis.json in the working directory
btcr2 genesis build -n mutinynet

# Build from a spec file, no questions, into a named file
btcr2 genesis build -n mutinynet --spec ./spec.json --out ./alice.json

# Confirm that the identifier and the file match
btcr2 identifier validate did:btcr2:x1q... --genesis-document ./alice.json

# Create the same identifier again from the file
btcr2 create -t x -n mutinynet --document ./alice.json

# Resolve with the file as sidecar data
btcr2 resolve -i did:btcr2:x1q... --genesis-document ./alice.json

# JSON envelope output
btcr2 -o json genesis build -n mutinynet --spec ./spec.json
```

## See also

- `btcr2 create`: `create -t x --document <path>` creates the identifier from a genesis document.
- `btcr2 identifier validate`: confirms that an identifier encodes the hash of a genesis document.
- `btcr2 resolve`, `btcr2 update`, `btcr2 deactivate`: take the document with
  `--genesis-document <path>`.
- `btcr2 key`: generate and name the keys that the spec references.
- [README](./README.md): the global flags, the config file reference, and the profile rules.
