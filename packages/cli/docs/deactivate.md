# btcr2 deactivate

Deactivates a did:btcr2 identifier. This is permanent, and there is no undo. The command calls `deactivateDid` of the api. A deactivation is a normal update whose only change is the fixed JSON Patch `[{ "op": "add", "path": "/deactivated", "value": true }]` (ADR 094). The api supplies that patch. The api refuses a document that is deactivated already (ADR 100).

The command resolves the current document from the network, or it takes the source pair that you supply. It signs the update with a key from the keystore. It publishes the artifacts to a writable CAS if you ask for it. Then it broadcasts a beacon signal transaction on the Bitcoin network that the identifier encodes. The command shares the write path of `update` from end to end: the same funded beacon, the same signature and session behavior, and the same `--publish-to-cas`, `--fee-rate`, and `--change-address` flags. Use it only if you are certain that the identifier must reach its final state. `delete` is an alias.

## Synopsis

```
btcr2 deactivate -i <did> [-s <doc-json> --source-version-id <n>] [-m <vm-id>] [-b <beacon-id>]
                 [-r <json> | --resolution-options-path <path>] [--min-conf <n>]
                 [--genesis-document <path>]
                 [--publish-to-cas <auto|always|never>] [--fee-rate <satsPerVByte>]
                 [--change-address <address>]

btcr2 delete ...        # alias, the same behavior
```

There are no subcommands.

## Options

`-i` is required. The other flags are optional. `-s` and `--source-version-id` come together or not at all. The command fails before it reads any key if only one of the two is present.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-i, --identifier <identifier>` | A `did:btcr2:...` identifier. The command reads the network from it. An identifier with an unsupported network fails with `Unsupported network "..." in DID.` | (required) | The identifier to deactivate. It drives the network, the mainnet keystore guard, and the resolution of the current document. A supplied `-s` document must carry this identifier as its `id`. The api refuses a mismatch before it signs. |
| `-s, --source-document <json>` | A JSON object (the current DID document). The command parses it with `JSON.parse` at parse time and refuses invalid JSON (`INVALID_ARGUMENT_ERROR`). It requires `--source-version-id`. | none | The document to deactivate. Omit both `-s` and `--source-version-id`, and the command resolves the current document first. Supply both for an offline source, or if you already hold large sidecar data. |
| `--source-version-id <number>` | Digits only (`/^\d+$/`): a non-negative integer. The command refuses `-1`, `1.5`, or `2a` at parse time (`INVALID_ARGUMENT_ERROR`). It requires `--source-document`. | none | The version id of the source document. The deactivation becomes version `n + 1`. |
| `-m, --verification-method-id <id>` | A verification method id in the `capabilityInvocation` list of the document. The api checks it before it constructs the update. An absolute DID URL (`did:btcr2:...#initialKey`) and a relative DID URL (`#initialKey`) are both valid. The api resolves the id against the source document before the match. | derived | The verification method that signs the deactivation. Its key must be in the keystore. Without the flag, the api selects the one method whose `publicKeyMultibase` is the signing key (ADR 104). The api refuses zero candidates and more than one candidate, and it names them. Pass the flag to select one. |
| `-b, --beacon-id <id>` | A DID URL that names a beacon service `id` in the source document, in the absolute or the relative form. The value is a plain string, not JSON. | derived | The beacon service whose Bitcoin address broadcasts the deactivation signal. Without the flag, the api selects the only beacon of the document, else the one beacon with a spendable UTXO (ADR 104). The api refuses zero funded beacons and more than one funded beacon, and it names them. Pass the flag to select one. |
| `-r, --resolution-options <json>` | Resolution options as a JSON string, with the shape of `btcr2 resolve -r`. The command refuses invalid JSON (`INVALID_ARGUMENT_ERROR`). Not valid with the source pair. | none | Feeds the resolution of the current document. Supply sidecar data here if a prior update of the identifier is not in a CAS. |
| `--resolution-options-path <path>` | The path of a JSON file with resolution options. `-r` wins if both are present. Not valid with the source pair. | none | The file form of `-r`. There is no short form. The flag set mirrors `update`, where `-p` is `--patches`. |
| `--min-conf <n>` | A positive integer (minimum 1). The command refuses another value at parse time (`INVALID_ARGUMENT_ERROR`). Not valid with the source pair. | `6` (the specification value) | The minimum number of block confirmations that a beacon signal needs before the source resolution applies it (ADR 105). The flag overrides a `minConf` inside `-r` or the options file. Pass `1` to build on an update with one confirmation. |
| `--genesis-document <path>` | The path of the JSON genesis document of an external (`x`) identifier. The command refuses an unreadable file or invalid JSON (`INVALID_ARGUMENT_ERROR`). It refuses the flag for a `k` identifier. Not valid with the source pair. | none | Fills `sidecar.genesisDocument` of the resolution options. The flag wins over a value inside `-r` or the options file. Use it if the genesis document is not in a CAS (ADR 108). |
| `--publish-to-cas <mode>` | `auto` \| `always` \| `never`. The command refuses another value at parse time. | `never` | The CAS publication policy for the signed update (and, for a CAS beacon, the announcement), applied before the broadcast. `never`: publish nothing. Distribute the returned artifacts as sidecar data. `auto`: best effort. Publish if a writable CAS (`--cas-rpc-url`) is configured, else skip without a message. It never blocks. `always`: a writable CAS is required. A read-only or absent CAS fails up front, before any signature or spend. |
| `--fee-rate <satsPerVByte>` | A positive finite number of sats/vByte (fractions are valid). The command refuses zero, a negative value, or a non-numeric value (`INVALID_ARGUMENT_ERROR`). | `5` (the SDK default) | The fee rate of the beacon signal transaction. Raise it if the network is busy, so that the transaction confirms. |
| `--change-address <address>` | A Bitcoin address of the network of the identifier. The beacon validates it at broadcast time. | the change returns to the beacon address | Sends the change of the transaction to this address instead of the beacon address, so that the announcements of an identifier are not linked on-chain (ADR 044). |
| `-h, --help` | | | Print the help of the command. |

Behavior that the `--help` text does not show:

- The network is never a flag. The command decodes it from the identifier (`-i`). The supported networks are `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, and `regtest`. Any other encoded network fails with `INVALID_ARGUMENT_ERROR`.
- Source resolution: without the source pair, the command resolves the identifier first, through the same path as `btcr2 resolve`. That resolution needs the sidecar data of each prior update that is not in a CAS. Pass it with `-r` or `--resolution-options-path`. The resolution applies `--min-conf` (default six). An external (`x`) identifier also needs its genesis document. Pass it with `--genesis-document` if it is not in a CAS. The command refuses a half pair before it reads any key: `Provide both --source-document and --source-version-id, or neither.` The command refuses the four resolution flags with the pair: `... apply only when --source-document and --source-version-id are omitted.`
- Mainnet guard (ADR 080): if the network of the identifier is `bitcoin` and the resolved keystore is a dev keystore, the command refuses (`DEV_KEYSTORE_MAINNET_ERROR`) before it touches any key material.
- Derivation (ADR 104): without `-m`, the api selects the one verification method whose `publicKeyMultibase` is the signing key. Without `-b`, the api selects the only beacon, else the one beacon with a spendable UTXO. The api refuses zero candidates and more than one candidate with a message that names them. Pass `-m` or `-b` to select.
- Deactivated source (ADR 100): the api refuses a source document with `deactivated: true`, supplied or resolved, before it signs. The api supplies the deactivation patch itself (ADR 094).
- Funding prerequisite: the beacon address must hold at least one spendable UTXO. An unfunded address fails with `Beacon address <addr> is unfunded. Send BTC to this address before broadcasting the update.` after the signature, but before any coins move.
- The CAS publication (if enabled) happens before the on-chain broadcast. A CAS failure therefore stops the command while the beacon UTXO is intact. Content addressing makes a second run idempotent.

### Output

- Text mode (default): the update result payload as pretty JSON on stdout: `signedUpdate` (the full signed update for sidecar distribution), `txid` (the beacon signal transaction), `announcement` (CAS beacons only), `proof` (SMT beacons only, always sidecar data), and `publishedToCas` (`{ update, announcement }` booleans that record what reached the CAS).
- Text mode also prints a watch hint on stderr on a network with a block explorer (all except regtest): `Watch: <explorer-tx-url>`, for example `https://mutinynet.com/tx/<txid>`. `--quiet` and JSON mode suppress it. This command prints no faucet hint.
- JSON mode (`-o json`): stdout carries `{ "action": "deactivate", "data": { ...the same payload... } }`, and the command writes nothing on stderr on success.
- An error prints its message only (the full object and the stack under `--verbose`) and exits with code 1.

Keep the printed `signedUpdate` (and the `announcement` or `proof` if present). A resolver needs it as sidecar data to see the deactivated state, unless you published it to a CAS.

## Environment and configuration

The general precedence for each value: flag, then environment variable, then the active profile in `config.json`, then the built-in default. The exceptions follow below.

### Environment variables

| Variable | Feeds | Flag |
|----------|-------|------|
| `BTCR2_HOME` | The home directory that holds `config.json`, `keystore.json`, `session.json` | `--home` (the flag wins) |
| `BTCR2_OUTPUT` | The output format (`json` or `text`) | `-o, --output` |
| `BTCR2_KEYSTORE_PASSPHRASE` | The keystore passphrase (see the passphrase order below) | none (never a flag value) |
| `BTCR2_FEE_RATE` | The fee rate in sats/vByte | `--fee-rate` |
| `BTCR2_BTC_REST` | The Bitcoin REST (Esplora) endpoint | `--btc-rest` |
| `BTCR2_BTC_RPC_URL` | The Bitcoin Core RPC endpoint | `--btc-rpc-url` |
| `BTCR2_BTC_RPC_USER` | The Bitcoin Core RPC username | `--btc-rpc-user` |
| `BTCR2_BTC_RPC_PASS` | The Bitcoin Core RPC password (an `env:<VAR>` or `file:<path>` reference is valid) | none (a password on argv is visible through `ps` and the shell history) |
| `BTCR2_BTC_RPC_PASS_FILE` | The path of a file with the RPC password (the fallback if no layer supplies one) | none |
| `BTCR2_BTC_TIMEOUT` | The Bitcoin REST and RPC timeout in ms (1 or more) | `--btc-timeout` |
| `BTCR2_BTC_SIGNAL_DISCOVERY` | The source of the beacon signals (`indexer` \| `fullnode`). An invalid value fails the command. `fullnode` without a connection with RPC fails the command too. | `--btc-signal-discovery` |
| `BTCR2_CAS_GATEWAY` | The read-only IPFS gateway for CAS reads | `--cas-gateway` |
| `BTCR2_CAS_RPC_URL` | The writable IPFS RPC endpoint (necessary for `--publish-to-cas auto` and `always`) | `--cas-rpc-url` |
| `BTCR2_CAS_TIMEOUT` | The CAS timeout in ms (`0` disables it) | `--cas-timeout` |

### The config.json and profile keys that feed this command

The config file is at `<home>/config.json` (override it with `-c/--config`). The active profile is the `--profile` flag, else `defaults.profile`. If neither names a profile, the connection resolution uses the profile with the name of the network of the identifier (a mutinynet identifier reads `profiles.mutinynet`).

| Key | Feeds |
|-----|-------|
| `defaults.output` | The output format fallback (`json` \| `text`) |
| `defaults.profile` | The active profile selection |
| `defaults.network` | Not read. The identifier fixes the network. |
| `profiles.<name>.network` | The network of a profile whose name is not a network (for the active profile resolution) |
| `profiles.<name>.btc.rest`, `.rpcUrl`, `.rpcUser`, `.rpcPass` | The Bitcoin endpoints and credentials |
| `profiles.<name>.btc.feeRate` | The fee rate (a number, sats/vByte) |
| `profiles.<name>.btc.changeAddress` | The change address (no environment variable for this value: flag, then profile) |
| `profiles.<name>.btc.timeoutMs`, `.headers`, `.wallet`, `.rpcHeaders` | The timeout, the extra REST headers, the RPC wallet, the extra RPC headers |
| `profiles.<name>.btc.signalDiscovery` | The source of the beacon signals (`"indexer"` \| `"fullnode"`) |
| `profiles.<name>.cas.gateway`, `.rpcUrl`, `.timeoutMs` | The CAS endpoints and timeout |
| `profiles.<name>.identity.keystore` | The keystore path (below the `--keystore` flag, above `<home>/keystore.json`) |
| `profiles.<name>.identity.default` | The default signing key reference (below the `--signing-key` flag, above the active key of the keystore) |

The RPC credentials resolve as one unit (ADR 074): the URL, the user, and the password come together from the highest layer (flag, environment, profile) that supplies a URL. A host from one layer never gets the credentials of another layer.

### Signing key resolution

The signing key reference is, in this order: `--signing-key <ref>`, else the `identity.default` of the active profile, else the active key of the keystore (set with `btcr2 key use`). A reference is a full URN (`urn:kms:secp256k1:<fingerprint>`), a unique key name, or a unique fingerprint prefix. An exact name match wins over a fingerprint prefix. No match, an ambiguous match, or no reference with no active key fails the command before any signature.

### Passphrase and session

A signature with an encrypted keystore needs the passphrase. The command gets it in this order (the environment variable sits above the file that the flag names):

1. The `BTCR2_KEYSTORE_PASSPHRASE` environment variable.
2. `--passphrase-file <path>` (the file content, the CLI trims one trailing newline).
3. A live session that `btcr2 keystore unlock` cached in `<home>/session.json` (ADR 081). The command uses a session only if it is not expired, if it is bound to the resolved keystore, and if it matches the current passphrase verifier. For a mainnet (`bitcoin`) identifier, the command uses the session only if you unlocked it with `--allow-mainnet`. Otherwise the command falls through to a per-use prompt.
4. An interactive terminal prompt with no echo. If stdin is not a TTY and none of the sources above supplied a passphrase, the command fails with `PASSPHRASE_REQUIRED_ERROR`.

A dev (plaintext) keystore needs no passphrase, but the command refuses it for a mainnet identifier.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. `deactivate` uses: `--signing-key`, `--keystore`, `--passphrase-file`, `--home`, `-c/--config`, `--profile`, `-o/--output`, `--quiet`, `--verbose`, the Bitcoin connection overrides (`--btc-rest`, `--btc-rpc-url`, `--btc-rpc-user`, `--btc-rpc-wallet`, `--btc-rest-header`, `--btc-rpc-header`, `--btc-signal-discovery`, `--btc-timeout`), and the CAS overrides (`--cas-gateway`, `--cas-rpc-url`, `--cas-timeout`). A writable `--cas-rpc-url` is what `--publish-to-cas auto` and `always` need.

## Examples

Deactivate a mutinynet identifier with the key named `demo`. The version 2 update of the identifier is sidecar data only, so the source resolution needs it. `--min-conf 1` lets a signal with one confirmation count. The api derives the verification method and the beacon, and supplies the deactivation patch:

```bash
DID='did:btcr2:k1qqp...'
btcr2 --signing-key demo deactivate \
  -i "$DID" \
  --min-conf 1 \
  -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)"
```

An external (`x`) identifier whose genesis document is not in a CAS. The file that `btcr2 genesis build` wrote fills the sidecar data:

```bash
btcr2 --signing-key alice deactivate \
  -i did:btcr2:x1q... \
  --genesis-document ./alice.json
```

An offline source: the current document (version 2) is in `doc-v2.json`. The pair skips the resolution, so the resolution flags are not valid here. The api still derives the verification method and the beacon:

```bash
btcr2 --signing-key demo deactivate \
  -i "$DID" \
  -s "$(cat doc-v2.json)" \
  --source-version-id 2
```

The first example with a higher fee rate on a busy network, and the change sent to a fresh unlinked address:

```bash
btcr2 --signing-key demo deactivate \
  -i "$DID" \
  --min-conf 1 \
  -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)" \
  --fee-rate 12 \
  --change-address tb1q...
```

Unattended use (CI or a script, no TTY): supply the passphrase from a file, or unlock a session first:

```bash
btcr2 --passphrase-file /run/secrets/btcr2-pass --signing-key demo deactivate \
  -i "$DID" \
  --min-conf 1 \
  -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)"

# or, in a terminal before the run:
btcr2 keystore unlock --ttl 1h
```

## See also

- `btcr2 update`: the general write path that this command specializes (a deactivation is an update with a fixed patch).
- `btcr2 resolve`: make sure of the final state afterwards. With the deactivation as sidecar data, `didDocumentMetadata.deactivated` is `true`.
- `btcr2 key`, `btcr2 keystore`: manage the signing key, the passphrase, and the session that this command uses.
- [DEMO.md](./DEMO.md): the full lifecycle walkthrough, with a deactivate step on mutinynet.
