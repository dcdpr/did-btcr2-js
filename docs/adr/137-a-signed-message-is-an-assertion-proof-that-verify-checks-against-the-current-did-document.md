# ADR 137: A Signed Message Is an Assertion Proof That Verify Checks Against the Current DID Document

- **Status:** Accepted
- **Date:** 2026-10-06
- **Packages:** `@did-btcr2/api` (PATCH: 2 functions and 5 types); `@did-btcr2/cli` (PATCH: the `message` command group)

## Context

A user wants to sign a text message with a did:btcr2 identifier. Another user wants to verify that the identifier signed the text. The cli had no command for this.

The did:btcr2 specification has no text about message signatures. The decision is a choice of this implementation.

### The key of a message signature has other uses

The key that signs a message also does these things:

1. It signs the updates of the DID. An update proof is a `bip340-jcs-2025` Data Integrity proof with the proof purpose `capabilityInvocation`. The BIP340 signature is over `SHA-256(SHA-256(JCS(proof config)) || SHA-256(JCS(update)))`.
2. For a KEY (`k`) identifier, it controls the singleton beacon addresses. A P2PKH or P2WPKH input signs a 32-byte sighash with ECDSA. A P2TR input signs with the BIP341-tweaked key.

A command that signs bytes that the caller chooses is a signing oracle. A probe made a valid update proof with a raw `api.kms.sign` call over the hash of a malicious update. A "message" can also be a sighash. Thus a message signature must never sign bytes that the caller chooses.

## Decision

### 1. A signed message is a closed JSON object with a Data Integrity proof

```json
{
  "type": "BTCR2Message",
  "message": "I control this DID. 2026-10-06 nonce 7f3a",
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "bip340-jcs-2025",
    "verificationMethod": "did:btcr2:k1q...#initialKey",
    "proofPurpose": "assertionMethod",
    "proofValue": "z..."
  }
}
```

- The object has exactly the members `type`, `message`, and `proof`. `type` is always `BTCR2Message`.
- The proof is a `bip340-jcs-2025` proof with exactly five members. It has no `@context`, `created`, `expires`, `domain`, or `challenge`.
- `proofPurpose` is always `assertionMethod`. The api sets it. The caller cannot change it.
- `verificationMethod` is the absolute DID URL of the method.
- The message is a string with no lone surrogate. JCS (RFC 8785) cannot encode a lone surrogate.

### 2. The signer signs only the hash of this closed format

The signer gets `SHA-256(SHA-256(JCS(cfg)) || SHA-256(JCS(doc)))`. `cfg` is the proof without `proofValue`. `doc` is `{ type, message }`. No message path signs caller bytes, and the scheme is always `bip340` with the untweaked key.

Why a message signature cannot be valid as another signature:

- **Update proof.** The resolver compares `proofPurpose` with `capabilityInvocation`, and the zcap members with their values, before it checks the signature. Equal hashes need equal halves, else a SHA-256 collision occurs. The `cfg` half of a message holds `"proofPurpose":"assertionMethod"`. JCS escapes `"` and `\`, so a message or a method id cannot add a member.
- **P2PKH and P2WPKH.** The message path never uses ECDSA. A 64-byte BIP340 signature is not a DER ECDSA signature.
- **P2TR key path.** The spend signs with the tweaked key Q. A message signature verifies only under the untweaked key P.
- **Other uses of the untweaked key** (the aggregation script path, Nostr events). Each of their hash inputs is longer than 64 bytes. The input of the outer hash of a message is exactly 64 bytes, so equal digests need a SHA-256 collision.
- **Other assertion proofs.** `type: "BTCR2Message"` is in the signed document. Verify refuses each other member. Thus a message proof is not a proof of another document, in either direction.

### 3. The signer is an `assertionMethod` method of the current DID document

`signMessage` uses the one method that is in `assertionMethod`, has the type `Multikey`, has the DID as its `controller`, and publishes the key of the signer. Zero or several matches fail. `verificationMethodId` selects one method.

The specification is silent on the relationship. `assertionMethod` is the relationship for assertions and claims (Controlled Identifiers 1.0, section 2.3.2). `authentication` needs a challenge protocol.

### 4. Verify runs five checks in order and stops at the first failure

| Check | The check passes if |
|---|---|
| `structure` | The object and its proof have exactly the members of section 1, with the fixed values. `proofValue` is `z` and 64 to 88 base58btc characters. |
| `signer` | `proof.verificationMethod` is `<did>#<fragment>`, where `<did>` is the id of the DID document. |
| `active` | The DID document is not deactivated. |
| `assertionMethod` | The method is in `assertionMethod`, its type is `Multikey`, its `controller` is the DID, and its key is a secp256k1 Multikey. |
| `signature` | The BIP340 signature verifies. |

Verify does not throw for a bad signed message. A failed check is in the report. The report has the message only if every check passed.

The `structure` check refuses a long `proofValue` before any decode. The time of a base58 decode grows with the square of the length, so a value of 1 MB blocks the process for minutes. A 64-byte signature has 64 to 88 characters, so the check refuses each other length.

### 5. The api gets two functions with no I/O

- `api.btcr2.signMessage(document, message, signer, options?)` returns a `SignedMessage`. It verifies its own result before it returns it.
- `api.btcr2.verifyMessage(document, signedMessage)` returns a `MessageReport`.
- The types are `SignedMessage`, `SignMessageOptions`, `MessageCheckName`, `MessageCheck`, and `MessageReport`. No new runtime value.

The caller resolves the document. A caller that passes an old document gets a check against that old document.

### 6. The cli gets `message sign` and `message verify`

```
btcr2 message sign -i <identifier> <message> [--signing-key <ref>] [-m <id>] [--sidecar <path>] [--min-conf <n>]
btcr2 message verify -i <identifier> <path> [--sidecar <path>] [--min-conf <n>] [--offline]
```

- `-i` takes an identifier or the name of its record (ADR 133). `--signing-key` has the default order of ADR 133.
- Both commands resolve the current DID document. The record sidecar and the `--sidecar` file give the resolution data.
- `--sidecar` takes only data (`genesisDocument`, `updates`, `casUpdates`, `smtProofs`, and a string `@context` that the resolution does not use), as `identifier add --sidecar` does. Only `--min-conf` sets `minConf`. A file from the signer thus cannot pin an old version or hide a key rotation.
- `message verify` is a check command (ADR 130). It prints the full report. `-q` prints `OK` or one line for the failed check. A failed check gives exit code 1.
- The detail of a failed check can hold text of the file. The `-q` line shows each control character as a `\uXXXX` escape, so a file cannot send a terminal sequence. The full report is JSON, and JSON escapes the C0 control characters.
- `message verify` reads the signed message from a file. It also accepts the json envelope that `-o json` makes: an object with exactly the members `action` and `data`. Any other object goes to the `structure` check unchanged, so a file cannot show a member that the checks do not read.

### 7. `--offline` is the escape from resolution

`message verify --offline` checks the message against the initial DID document. The api builds it with no I/O (`getInitialDocument`). The command builds no connection, so a bad connection setting does not stop it. An external (`x`) identifier needs its genesis document from `--sidecar` or from the record. The report has `checkedAgainst: "initial"`, and a warning on stderr says that the check does not see a later key rotation or deactivation.

Without `--offline`, the report has `checkedAgainst: "current"` and the `versionId` of the resolution.

## Alternatives

- **Raw BIP340 over the caller bytes, or over SHA-256 of the message.** An update-proof oracle. A probe made a valid update proof. Rejected.
- **A BIP340 tagged hash with a new tag.** Safe, but a new format. It binds no DID unless it adds more fields. Rejected.
- **BIP-322.** It binds an address, not a DID. It signs P2TR with the real spend key. It needs a virtual transaction on top of `@scure/btc-signer`, and Bitcoin Core does not support it. Rejected.
- **BIP-137 (`signmessage` of Bitcoin Core).** P2PKH only. It uses the ECDSA spend algorithm. Rejected.
- **JWS with `ES256K`.** ECDSA with the identity key. JOSE has no registered BIP340 algorithm. Rejected.
- **`proofPurpose: authentication`.** It needs a challenge protocol. Rejected.
- **A `created` member.** The signer sets it, so it invites a check at a false time. Rejected.
- **A detached signature.** A changed newline breaks it, and the signature alone does not show the text. Rejected.
- **Verify offline by default.** It accepts a rotated (leaked) key forever, and it cannot see a deactivation. Kept as the explicit `--offline` escape.
- **The `-r` / `-p` flags of `resolve` on verify.** A resolution options file from the signer can pin `versionId` or raise `minConf`, and hide a key rotation. Rejected.
- **A record only, with no `--sidecar` flag.** The verifier must write a record of a foreign DID before each check. Rejected.
- **`--message <text>` in place of the argument.** The message is the object of `message sign`, as the key is the object of `key show <ref>`. Precedents: `bitcoin-cli signmessage <address> <message>`, `cast wallet sign <MESSAGE>`, `solana sign-offchain-message <MESSAGE>`. Rejected.
- **Top-level `sign` and `verify`.** In a DID cli, a bare `verify` does not say what it verifies. Group and verb, as in `cast wallet sign`, `step crypto jws sign`, and `ssh-keygen -Y sign`. Rejected.
- **A specification issue.** The format stays a choice of this implementation. No issue now.

## Consequences

**Positive.**

- A user signs a text with an identifier, and any user verifies it with the cli or with JCS, SHA-256, and BIP340.
- No message signature can be an update proof or a transaction signature.
- A rotated key or a deactivated DID fails verify.

**Negative.**

- The format has no replay protection. Any holder can show the message again. The documentation tells the user to put the date, a nonce, and the audience in the text.
- `message sign` needs a resolution, so it needs a network.
- An honest old message fails verify after a key rotation.
- The message is in argv, so `ps` and the shell history show it.
- `api.kms.sign` still signs raw bytes for an SDK caller. The cli does not expose it.

**Later.** `--challenge` and `--domain`, a message from a file or stdin, an escape of bidi and zero-width characters in the output, BIP-322 for beacon addresses.

## Implementation

- `packages/api/src/message.ts` (new): the format, `signMessage`, `verifyMessage`, and the types.
- `packages/api/src/method.ts`: `DidMethodApi.signMessage` and `DidMethodApi.verifyMessage`.
- `packages/api/src/index.ts`, `packages/api/tests/index-exports.spec.ts`: the 5 types.
- `packages/api/tests/did-method-api-message.spec.ts` (new).
- `packages/cli/src/commands/message.ts` (new), `packages/cli/src/sidecar-file.ts` (new, shared with `identifier add`), `packages/cli/src/commands/write.ts` (exports `resolveSigningKey`), `packages/cli/src/cli.ts`, `packages/cli/src/types.ts`.
- `packages/cli/tests/message-commands.spec.ts` (new).
- `packages/cli/docs/message.md` (new), `packages/cli/docs/README.md`, `packages/cli/README.md`, `packages/api/README.md`.
- The command lists in `packages/cli/docs/`: `completion.md`, `config-file.md`, `config.md`, `create.md`, `identifier.md`, `key.md`, `keystore.md`, and `profile.md`.

## References

- [Data Integrity BIP340 Cryptosuites](https://dcdpr.github.io/data-integrity-schnorr-secp256k1/): `bip340-jcs-2025`.
- [Controlled Identifiers 1.0](https://www.w3.org/TR/cid-1.0/): the verification relationships.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785): JCS.
- [ADR 127](127-key-flags-of-create-update-and-deactivate.md): the key flags.
- [ADR 130](130-create-prints-only-the-identifier-and-validate-has-a-quiet-form.md): the output of a check command.
- [ADR 132](132-the-api-exports-only-its-facade-and-a-sub-facade-function-does-each-crud-step.md): the api surface.
- [ADR 133](133-the-cli-keeps-an-identifier-record-for-each-identifier.md): the identifier records.
