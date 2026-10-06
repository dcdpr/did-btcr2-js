# btcr2 message

Signs a text message with a `did:btcr2` identifier, and verifies a signed message (ADR 137). `message sign` prints a signed message: the text and a `bip340-jcs-2025` Data Integrity proof with the proof purpose `assertionMethod`. `message verify` checks a signed message against the current DID document of an identifier.

Both commands resolve the identifier, as `resolve` does. The resolution data comes from the identifier record (ADR 133) and from `--sidecar`. `message verify --offline` checks against the initial DID document with no resolution.

## Synopsis

```
btcr2 message sign [options] -i <identifier> <message>
btcr2 message verify [options] -i <identifier> <path>

btcr2 message sign -i alice "I control this DID. 2026-10-06 nonce 7f3a" > message.json
btcr2 message verify -i alice message.json
btcr2 message verify -q -i did:btcr2:k1q... message.json
btcr2 message verify -i did:btcr2:k1q... --sidecar alice-sidecar.json message.json
btcr2 message verify --offline -i did:btcr2:k1q... message.json
```

## What the key signs

The signed message is a JSON object with exactly three members. The proof has exactly five members.

```json
{
  "type": "BTCR2Message",
  "message": "I control this DID. 2026-10-06 nonce 7f3a",
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "bip340-jcs-2025",
    "verificationMethod": "did:btcr2:k1q5pq0yfml8qslpg2q4w68lnprqmx9lkz36jq4kkn4g0x870l545hl9ct92gfw#initialKey",
    "proofPurpose": "assertionMethod",
    "proofValue": "z5RUEUJnNbvSHaRYkvJdQf4G3uPRDfCaHvyRUgkDxvbQ3cETpgEuYzuRdBjfwDv91gUWyzaqnLtb8Mw8obR17o2G"
  }
}
```

The key signs this 32-byte hash with BIP340 (Schnorr, the untweaked key):

```
cfg      = proof without proofValue
doc      = { "type": "BTCR2Message", "message": <message> }
hashData = SHA-256( SHA-256(UTF-8(JCS(cfg))) || SHA-256(UTF-8(JCS(doc))) )
```

`proofPurpose` is always `assertionMethod`, and it is inside `hashData`. The key also signs the updates of the identifier (`capabilityInvocation`), and for a `k` identifier it controls the beacon addresses. The command never signs bytes that you choose. Thus no message signature is valid as an update proof or as a transaction signature (ADR 137).

### Verify outside btcr2

A verifier with no btcr2 code can do the five checks of [`message verify`](#checks). If a step fails, the message does not verify.

1. Resolve the DID document of the identifier.
2. Make sure that the signed message has exactly `type`, `message`, and `proof`, and that `type` is `BTCR2Message`.
3. Make sure that the proof has exactly the five members of the example. `type`, `cryptosuite`, and `proofPurpose` must have the values of the example.
4. Make sure that `proof.verificationMethod` starts with `<identifier>#`, and that the document has no `deactivated: true`.
5. Find the entry of `assertionMethod` for `proof.verificationMethod`. An entry is a method id or an embedded method. A relative id (`#key-1`) is relative to `<identifier>`. If the entry is an id, find the method with that id in `verificationMethod`. The method must have the type `Multikey` and the controller `<identifier>`.
6. Read the key of the method from `publicKeyMultibase`: remove the prefix `z`, decode base58btc, and remove the 2 bytes `0xe7 0x01`. The result is the 33-byte compressed key. Its last 32 bytes are the x-only key.
7. Compute `hashData` as above. JCS is RFC 8785.
8. Decode `proofValue`: remove the prefix `z`, and decode base58btc. The result is the 64-byte signature. A 64-byte value has 64 to 88 characters after `z`. Refuse each other length before the decode.
9. Verify the BIP340 signature over `hashData` with the x-only key.

## What a signed message proves

- **The current document.** A message verifies only if its key is in the `assertionMethod` of the current DID document. After a key rotation, a message of the old key fails. After a deactivation, every message fails.
- **No time.** The format has no creation time. The proof shows that the key signed, not when.
- **No replay protection.** Any holder can show the message again. Put the date, a nonce, and the audience in the text.
- **A wait for new updates.** The resolution applies a beacon signal only after `--min-conf` confirmations (default 6). A key that a new update removes verifies until that update has the confirmations.

## message sign

Signs `<message>` with a key of the keystore. The command resolves the current DID document. It finds the one `assertionMethod` method that publishes the signing key. Then it signs, verifies its own result, and prints the signed message.

The key reference and the resolution read public data only. The passphrase prompt comes after the resolution, at the signature. A resolution failure therefore asks for no passphrase.

### Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<message>` (the argument) | any string | none (required) | The text to sign. A shell argument shows in `ps` and in the shell history: do not sign a secret text. |
| `-i, --identifier <identifier>` | identifier or record name | none (required) | The identifier that signs, or the name of its identifier record. |
| `--signing-key <ref>` | URN, fingerprint prefix, or name | the signing key of the identifier record, else the profile `identity.default`, else the active key | The key that signs. A record key that the keystore does not hold fails with `The record of <identifier> names the signing key <key>, but the keystore does not hold it. ...` (`INVALID_ARGUMENT_ERROR`). |
| `-m, --verification-method-id <id>` | DID URL, absolute or relative (`#initialKey`) | the one `assertionMethod` method that publishes the signing key | The verification method that signs. Use it if two methods publish the key. |
| `--sidecar <path>` | file path | none | Sidecar data for the resolution, as [`identifier sidecar`](./identifier.md#sidecar) prints it: `genesisDocument`, `updates`, `casUpdates`, `smtProofs`. The data wins over the data of the record. The command also accepts a string `@context`. The resolution does not use it. Each other field fails, for example `versionId` or `minConf`. A resolution options file fails with a hint to use the object in its `sidecar` field. |
| `--min-conf <n>` | positive integer | `6` | The minimum number of block confirmations that a beacon signal needs before resolution applies it. |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

### Output

Text mode prints the signed message as 2-space-indented JSON, so `> message.json` writes a file for `message verify`. JSON mode (`-o json`) prints `{ "action": "message-sign", "data": <signed message> }`. `message verify` also accepts this envelope.

### Errors

| Condition | Message (start) |
|-----------|-----------------|
| The resolution fails | `Could not resolve <identifier>: <cause>` |
| No `assertionMethod` method publishes the signing key | `No assertionMethod method of <identifier> publishes the key of the signer.` (`VERIFICATION_METHOD_ERROR`) |
| Two methods publish the signing key | `2 assertionMethod methods of <identifier> publish the key of the signer: ... Pass verificationMethodId to choose one.` |
| `-m` names no usable `assertionMethod` method | `<id> is not a usable assertionMethod method of <identifier>.` |
| `-m` names a method with another key | `The verification method <id> does not publish the key of the signer.` |
| The DID document is deactivated | `The DID document of <identifier> is deactivated. A deactivated DID signs no message.` (`PROOF_GENERATION_ERROR`) |
| A mainnet identifier with a dev keystore | `Refusing a mainnet (bitcoin) operation with the unencrypted dev keystore at <path>. ...` (ADR 080) |

## message verify

Reads the signed message from `<path>`, resolves the current DID document of `-i`, and runs five checks in order. The run stops at the first failed check. A failed check is a result, not an error: the command prints the report and exits with code `1`. With `-q/--quiet`, the command prints only `OK`, or the failed check (ADR 130). The `-q` line shows each control character of the file as a `\uXXXX` escape, so the terminal does not run it.

`message verify` reads no keystore and never asks for a passphrase. It reads the file before any network request.

### Checks

| Check | The check passes if | Example failure detail |
|-------|---------------------|------------------------|
| `structure` | The object has exactly `type`, `message`, and `proof`, `type` is `BTCR2Message`, and the proof has exactly the five members with the fixed values. `proofValue` is `z` and 64 to 88 base58btc characters. | `The proof purpose must be assertionMethod.` |
| `signer` | `proof.verificationMethod` is a method of the identifier of `-i`. | `The proof names the method did:btcr2:k1q...#initialKey, which is not a method of did:btcr2:k1q....` |
| `active` | The DID document is not deactivated. | `The DID document of did:btcr2:k1q... is deactivated.` |
| `assertionMethod` | The method is in `assertionMethod`, its type is `Multikey`, its `controller` is the identifier, and its key is a secp256k1 Multikey. | `did:btcr2:k1q...#initialKey is not in the assertionMethod of the DID document.` |
| `signature` | The BIP340 signature verifies. | `The signature does not match the message and the key of the method.` |

### Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `<path>` (the argument) | file path | none (required) | The signed message file: the text output of `message sign`, or its `-o json` envelope. The command unwraps only an object with exactly the members `action` and `data`. An unreadable file or a file that is not JSON fails with `Could not read the signed message file <path>: <cause>` (`INVALID_ARGUMENT_ERROR`). |
| `-i, --identifier <identifier>` | identifier or record name | none (required) | The identifier that must have signed, or the name of its identifier record. |
| `--sidecar <path>` | file path | none | Sidecar data for the resolution, as on `message sign`. Use it for an identifier with no record here and with updates that are not in a CAS. Ask the signer for the file of `btcr2 identifier sidecar <identifier> --out <path>`. The file carries data only, so it cannot pin an old version of the document. |
| `--min-conf <n>` | positive integer | `6` | The minimum number of block confirmations that a beacon signal needs before resolution applies it. Only this flag sets `minConf`. |
| `--offline` | boolean | `false` | Check against the initial DID document, with no resolution. A `k` identifier needs no data. An `x` identifier needs its genesis document from `--sidecar` or from the record. The check does not see a later key rotation or deactivation, and a warning on stderr says so (not under `-q`). `--offline` with `--min-conf` fails. `--offline` with `--sidecar` on a `k` identifier fails. |
| `-h, --help` | none | n/a | Print the help of the subcommand and exit. |

### Output

Text mode prints the report as 2-space-indented JSON. JSON mode (`-o json`) wraps it in `{ "action": "message-verify", "data": { ... } }`. Text mode with `-q/--quiet` prints `OK` if the message verifies. If a check fails, it prints one line: `Message not verified (<check> check): <detail>`.

| Field | Type | Meaning |
|-------|------|---------|
| `did` | string | The identifier that must have signed. |
| `verified` | boolean | `true` if every check passed. |
| `verificationMethod` | string | The method that the proof names. Present after the `structure` check passed. |
| `message` | string | The message. Present only if `verified` is `true`. |
| `checks` | array | The checks that ran, in run order. Each entry is `{ name, ok, detail? }`. A failed report ends with its failed check. |
| `checkedAgainst` | `current` \| `initial` | `current` after a resolution. `initial` under `--offline`. |
| `versionId` | string | The version of the DID document that the resolution returned. Absent under `--offline`. |

Example, a verified message:

```json
{
  "did": "did:btcr2:k1q5pq0yfml8qslpg2q4w68lnprqmx9lkz36jq4kkn4g0x870l545hl9ct92gfw",
  "verified": true,
  "verificationMethod": "did:btcr2:k1q5pq0yfml8qslpg2q4w68lnprqmx9lkz36jq4kkn4g0x870l545hl9ct92gfw#initialKey",
  "message": "I control this DID. 2026-10-06 nonce 7f3a",
  "checks": [
    { "name": "structure", "ok": true },
    { "name": "signer", "ok": true },
    { "name": "active", "ok": true },
    { "name": "assertionMethod", "ok": true },
    { "name": "signature", "ok": true }
  ],
  "checkedAgainst": "current",
  "versionId": "1"
}
```

Example, a changed message, with `-q`:

```
Message not verified (signature check): The signature does not match the message and the key of the method.
```

Exit codes: `0` if the message verifies. `1` if a check fails, and on any error. If a check fails, the report is on stdout, and stderr has only the warnings (none under `-q`). On an error, the message is on stderr.

## Environment and configuration

Both commands read the endpoints of the network of the identifier, as `resolve` does (see [resolve.md](./resolve.md#environment-and-configuration)). `message verify --offline` reads no endpoint and no other connection setting. Thus a bad connection setting in a flag, an environment variable, or the config file does not stop it.

`message sign` reads the keystore at this path: the `--keystore` flag, else the `identity.keystore` of the active profile, else `<home>/keystore.json`. The passphrase comes from `BTCR2_KEYSTORE_PASSPHRASE`, else `--passphrase-file`, else the session, else a prompt on a terminal.

Both commands read the identifier records in `<home>/dids.json` and never write them.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. The command group uses these global flags:

- `-o, --output`: text or the JSON envelope.
- `-q, --quiet`: the short result of `message verify` in text mode, and no warnings.
- `--verbose`: the full structured error.
- `--home`, `-c, --config`, and `--profile`: the files and the profile that the commands read.
- The connection overrides: the endpoints of the resolution. `message verify --offline` uses no connection override.
- `--keystore` and `--passphrase-file`: `message sign` only.

## Examples

```sh
# Sign a message as the identifier of the record "alice", and keep the signed message in a file
btcr2 message sign -i alice "I control this DID. 2026-10-06 nonce 7f3a" > message.json

# Sign with a key that is not the default key
btcr2 message sign -i alice --signing-key backup "Hello"

# Verify a signed message. The exit code is 1 if it does not verify
btcr2 message verify -i did:btcr2:k1q5pq0yfml8qslpg2q4w68lnprqmx9lkz36jq4kkn4g0x870l545hl9ct92gfw message.json

# Print only OK, or the failed check
btcr2 message verify -q -i alice message.json

# Verify the message of an identifier with off-chain updates and no record here
btcr2 message verify -i did:btcr2:k1q... --sidecar alice-sidecar.json message.json

# Verify against the initial DID document, with no network
btcr2 message verify --offline -i did:btcr2:k1q... message.json
```
