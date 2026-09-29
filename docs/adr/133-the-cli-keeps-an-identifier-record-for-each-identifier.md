# ADR 133: The CLI Keeps an Identifier Record for Each Identifier

- **Status:** Accepted
- **Date:** 2026-09-29
- **Packages:** `@did-btcr2/cli` (MINOR, breaking: the default signing key of `update` and `deactivate`)

## Context

The CLI keeps state in its home (ADR 079): the config file, the keystore, and the session. It keeps no state about the identifiers that it makes or updates.

1. `create` prints the identifier, the key URN, and the public key. Then it forgets them. The keystore holds keys, with a `name` tag. No key names an identifier.
2. To find the key of a `k` identifier, a user decodes the identifier and compares the genesis bytes with each public key of the keystore. An `x` identifier and a key that an update adds have no such link.
3. `update` and `deactivate` print the signed update, the CAS announcement, and the SMT proof. The user must keep them. The next resolution needs them as sidecar data if no CAS holds them. The user writes the resolution options file by hand.
4. No command lists the identifiers of a user.

Other tools keep this state. Veramo keeps a record for each managed identifier (the DID, an alias, the keys, the services) in a local store, and `veramo did list` prints them. A Bitcoin Core wallet keeps its own transactions.

## Decision

**The CLI keeps one identifier record for each identifier in `<home>/dids.json`.** The file sits next to `config.json` and `keystore.json`.

```json
{
  "v": 1,
  "identifiers": {
    "did:btcr2:k1q...": {
      "name": "alice",
      "added": "2026-09-29T18:00:00.000Z",
      "keys": [ "urn:kms:secp256k1:05c5..." ],
      "signingKey": "urn:kms:secp256k1:05c5...",
      "txids": [ "396e..." ],
      "sidecar": { "updates": [ ] }
    }
  }
}
```

| Field | Meaning |
|-------|---------|
| `name` | Optional. A unique name. A command accepts the name in place of the identifier. |
| `added` | The time of the first record. |
| `keys` | The URNs of the keys that the CLI used for the identifier, in the order of first use. |
| `signingKey` | The key that signs the next update if `--signing-key` is not given. One of `keys`. |
| `txids` | The beacon signal transactions of the updates that the CLI broadcast. |
| `deactivated` | Present and `true` after `deactivate`. |
| `sidecar` | The sidecar data of the identifier: the same object as `resolutionOptions.sidecar`. |

- The path derives from the home only, like the session file. No flag and no profile key moves it.
- A write takes a file lock, reads the file again, applies the change, and writes the file atomically with mode `0600`. The lock and the atomic write are the keystore helpers.
- The record holds no key material. The network and the type of an identifier are not in the file: the commands decode them from the identifier.
- A version other than `1`, or a file that is not JSON, fails each command that reads the file. No command writes over such a file.

**The CLI records an identifier automatically.**

| Command | What the record gets |
|---------|---------------------|
| `create` | The identifier and the `--name`. For a stored key or a generated key: the key, as the signing key. For `-t x --document`: the genesis document, in the sidecar data. |
| `update` | The signing key (it becomes the signing key of the record), the txid, the signed update, the CAS announcement, the SMT proof, and the sidecar data of the source resolution. |
| `deactivate` | The same as `update`, and `deactivated: true`. |
| `identifier add` | The name, the key of `--key`, and the sidecar data of `--sidecar`. |

- The record keeps the sidecar data of the source resolution because the resolution used it. The next resolution then needs no flag.
- A name that another identifier has is refused before any work: before a key generation, a signature, or a broadcast.
- The write of a record comes after the work. If the write fails, the command prints `Warning: the CLI could not write the record of <identifier> to <path>: <reason>`. The exit code does not change, because the broadcast is done. The warning ignores `-q`, because the record is then incomplete.
- `resolve` never writes the file.

**The commands use the record.**

- `resolve`, `update`, and `deactivate` accept the name of a record in `-i`. A reference that starts with `did:` is an identifier. Any other reference is a name.
- The sidecar data of the record joins the resolution options of `resolve`, and of the source resolution of `update` and `deactivate`. The sidecar data of the flags wins. The genesis document of the flags wins. The arrays merge, and an entry with the canonical hash of an earlier entry is dropped. The resolver keys each entry by its hash, so an entry that no beacon signal names has no effect.
- A supplied source pair (`-s` and `--source-version-id`) skips the resolution (ADR 101). Then the record sidecar data does not apply.

**The signing key order of `update` and `deactivate` changes** (ADR 127 gave the old order):

| Layer | Source |
|-------|--------|
| Flag | `--signing-key <ref>` |
| Identifier record | The `signingKey` of the record |
| Active profile | `identity.default` |
| Keystore | The active key |

If the record names a key that the keystore does not hold, the command refuses: `The record of <identifier> names the signing key <urn>, but the keystore does not hold it. Use --signing-key <ref> to select a key. Use "btcr2 identifier add <identifier> -k <ref>" to change the key of the record.` A fall back to the next layer would sign with a key that the DID document does not name, and the api would then fail with a less clear error (ADR 104).

**The `identifier` command group gets five subcommands.** All five are offline.

| Subcommand | Action |
|------------|--------|
| `list` (`ls`) | Prints a summary of each record: the identifier, the name, the network, the type, the keys, the signing key, the number of updates, and `deactivated`. `-n, --network` and `-k, --key <ref>` filter the list. |
| `show <ref>` | Prints the full record. |
| `add <ref>` | Adds an identifier to the records, or adds data to its record: `--name`, `-k, --key <ref>`, `--sidecar <path>`. For a new record of a `k` identifier with no `--key`, it links the stored key whose public key is the genesis bytes. |
| `remove <ref>` (`rm`) | Removes the record. The keys stay in the keystore. |
| `sidecar <ref>` | Prints the sidecar data of the record. `--out <path>` writes it to a new file (`0600`). |

- The `--sidecar` file of `add` is the object that `identifier sidecar` prints: `genesisDocument`, `updates`, `casUpdates`, `smtProofs`, and an optional `@context`. The command refuses an unknown field. For the field `sidecar`, the error says that the file holds resolution options.
- A peer that gets the sidecar data file runs `identifier add <identifier> --sidecar <file>`, then `resolve -i <identifier>`.
- `add` and `list --key` read the public keys of the keystore. They never ask for the passphrase. ADR 107 made the group keystore-free. That remains true for `decode` and `validate`.

**`config path` also prints `dids`**, the path of the records file.

**The cli test suite runs each test in a new, empty home.** A mocha root hook sets `BTCR2_HOME` to a temporary directory named `btcr2` before each test. Without it, a test of `create` writes a record into the real home of the user.

## Alternatives

- **A directory for each identifier** (`<home>/dids/<identifier>/record.json` and `sidecar.json`). A user can copy one sidecar file from it. But it gives many files, no single format version, and a lock for each directory. `identifier sidecar --out` gives the same file on request.
- **A `did` tag on each key of the keystore.** A tag is a string. It cannot hold sidecar data, and a key can serve more than one identifier (one `k` identifier for each network, and any number of `x` identifiers). It also puts public state into the file that holds the secrets.
- **Records only with a `--track` flag.** A user must then remember the flag for each command. The CLI already keeps state, and the user asked for automatic records.
- **Keep the old signing key order.** The record then only shows the key, and the user types it for each update. The problem of item 2 in the context stays for the signing step.
- **Use the stored sidecar data only through `identifier sidecar`.** The user then still passes `-p` for each resolution of an own identifier.
- **Check the file permissions on read, as the keystore does.** The records file holds no secret. The config file, which can hold an RPC password, has no such check either. The file is written `0600`.

## Consequences

**Positive.** `btcr2 identifier list` prints the identifiers of the user and their keys. `update -i alice` signs with the right key and resolves the source with the stored sidecar data, with no flag. `resolve -i alice` needs no resolution options file for an own identifier. A user can give the sidecar data of an identifier to a peer as one file, and the peer can import it.

**Negative.**

- The signing key order of `update` and `deactivate` changes. An identifier with a record now signs with the key of the record, not with `identity.default` or the active key. This is a breaking change of the cli (MINOR at 0.x).
- The records file links keys to identifiers, and it holds sidecar data. With the sidecar data of an update that no CAS holds, a reader of the file can resolve that update. The file mode is `0600`, and the home directory mode is `0700`.
- The records file can become stale: `key delete` does not change a record, and an update that another tool broadcast is not in it. `identifier add --sidecar` adds the missing data. A record key that the keystore does not hold refuses the next update with a clear error.
- A malformed records file fails `resolve`, `update`, `deactivate`, the `identifier` record subcommands, and `create --name`.

**Tests.** The cli tests cover:

- the records module: an absent file, the 0600 write, the field order, the key and txid rules, the name rules, `remove`, a malformed file, the sidecar merge, and the warning of a failed write,
- the record of each `create` mode, and the refusal of a name before a key generation,
- `identifier list` with its filters, `show`, `add` (with the genesis key link, `--key`, `--sidecar`, a name reference, and the refusals), `remove`, and `sidecar --out`,
- the signing key of the record, `--signing-key` over the record, and the refusal of a record key that the keystore does not hold,
- the record of `update` and `deactivate`, the stored sidecar data in the next resolution, the source pair that skips it, and a name in `-i`,
- `resolve` with a name and the stored sidecar data, and `config path`.
