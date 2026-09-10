# btcr2 update

Updates a did:btcr2 document. The command signs a JSON Patch against the current document and broadcasts a beacon signal on-chain. It reads the network from the identifier (`-i`). It resolves the current document from the network, or it takes the source pair that you supply. It resolves a signing key from the keystore and signs the update: a BIP-340 proof and the input signature of the beacon transaction. It spends a UTXO at the beacon address and broadcasts a transaction. The `OP_RETURN` output of the transaction carries the update hash.

Use the command if a published DID document must change: add or remove a service, a verification method, or any other field that an RFC 6902 JSON Patch can express. The signed update stays off-chain. Keep the returned artifacts as sidecar data for the resolvers, or publish them to a CAS with `--publish-to-cas`.

## Synopsis

```
btcr2 [global flags] update -i <did> -p <json>
                            [-s <json> --source-version-id <number>] [-m <id>] [-b <id>]
                            [-r <json> | --resolution-options-path <path>] [--min-conf <n>]
                            [--genesis-document <path>]
                            [--publish-to-cas <auto|always|never>]
                            [--fee-rate <satsPerVByte>]
                            [--change-address <address>]

btcr2 update --help
```

There are no subcommands. A global flag (`-o`, `--signing-key`, an endpoint override, and so on) goes before the `update` word.

## Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-i, --identifier <identifier>` | A `did:btcr2:...` identifier. The command reads the network from it. An identifier with an unsupported network fails with `Unsupported network "..." in DID.` | none (required) | The identifier to update. It drives the network, the mainnet keystore guard, and the resolution of the current document. A supplied `-s` document must carry this identifier as its `id`. The api refuses a mismatch before it signs. |
| `-s, --source-document <json>` | A complete DID document as a JSON string. It must parse as JSON, or the command fails at parse time. It requires `--source-version-id`. | none | The document that the patch applies to. Omit both `-s` and `--source-version-id`, and the command resolves the current document first. Supply both for an offline source, or if you already hold large sidecar data. |
| `--source-version-id <number>` | A non-negative base-10 integer string (digits only, `1` for the first update). The command refuses a negative, decimal, or non-numeric value at parse time with `--source-version-id must be a non-negative integer.` It requires `--source-document`. | none | The version of the source document that the patch applies to. |
| `-p, --patches <json>` | A JSON string with an array of RFC 6902 JSON Patch operations (`op`, `path`, `value`, ...). It must parse as JSON, or the command fails at parse time. | none (required) | The changes to apply to the source document. |
| `-m, --verification-method-id <id>` | A DID URL with a fragment, for example `did:btcr2:...#initialKey`. A relative DID URL (`#initialKey`) is also valid. The api resolves it against the source document, so it matches the spelling of that document. An entry of the `capabilityInvocation` list of the document must identify the method, as a reference or as an embedded method (ADR 112). The method must be a `Multikey` verification method, and its `publicKeyMultibase` must start with `zQ3s`. | derived | The verification method whose key signs the update. Without the flag, the api selects the one method whose `publicKeyMultibase` is the signing key (ADR 104). The api refuses zero candidates and more than one candidate, and it names them. Pass the flag to select one. |
| `-b, --beacon-id <id>` | A DID URL that names a beacon service `id` in the source document, for example `did:btcr2:...#initialP2WPKH`. A relative DID URL (`#initialP2WPKH`) is also valid. The api resolves it against the source document. The value is a plain string, not JSON. An id that names no service fails the factory check `No beacon service found for provided beaconId`. | derived | The beacon service (Singleton, CAS, or SMT) that announces the update on-chain. Without the flag, the api selects the only beacon of the document, else the one beacon with a spendable UTXO (ADR 104). The api refuses zero funded beacons and more than one funded beacon, and it names them. Pass the flag to select one. |
| `-r, --resolution-options <json>` | Resolution options as a JSON string, with the shape of `btcr2 resolve -r`. Invalid JSON fails with `Invalid resolution options.` Not valid with the source pair. | none | Feeds the resolution of the current document. Supply sidecar data here if a prior update of the identifier is not in a CAS. |
| `--resolution-options-path <path>` | The path of a JSON file with resolution options. An unreadable file or invalid JSON fails with `Invalid resolution options path.` `-r` wins if both are present. Not valid with the source pair. | none | The file form of `-r`. There is no short form: `-p` is `--patches` on this command. |
| `--min-conf <n>` | A positive integer (minimum 1). The command refuses another value at parse time with `--min-conf must be a positive integer (minimum 1).` Not valid with the source pair. | `6` (the specification value) | The minimum number of block confirmations that a beacon signal needs before the source resolution applies it (ADR 105). The flag overrides a `minConf` inside `-r` or the options file. Pass `1` to build on an update with one confirmation. |
| `--genesis-document <path>` | The path of the JSON genesis document of an external (`x`) identifier. An unreadable file or invalid JSON fails with `Invalid genesis document path.` For a `k` identifier, the command refuses the flag with `--genesis-document applies only to external identifiers (x).` Not valid with the source pair. | none | Fills `sidecar.genesisDocument` of the resolution options. The flag wins over a value inside `-r` or the options file. Use it if the genesis document is not in a CAS (ADR 108). |
| `--publish-to-cas <mode>` | One of `auto`, `always`, `never`. The command refuses another value at parse time. | `never` | The CAS publication policy for the update artifacts, applied before the broadcast. `never`: publish nothing. Distribute the returned artifacts as sidecar data. `auto`: best effort. If a writable CAS is configured, publish the signed update (all beacon types) and the CAS announcement (CAS beacons). Otherwise skip the publication without a message. `always`: a writable CAS is required. A read-only or absent CAS fails up front, before any signature or spend. `--cas-rpc-url`, `BTCR2_CAS_RPC_URL`, or `profiles.<name>.cas.rpcUrl` configures a writable CAS. |
| `--fee-rate <satsPerVByte>` | A positive finite number of sats per vByte (decimals are valid). Zero, a negative value, or a non-numeric value fails with `Invalid --fee-rate ...`. | unset (the SDK default is 5 sat/vB) | The fee rate of the beacon transaction. Raise it if the network is busy, so that the transaction confirms. If the flag is unset, the value comes from `BTCR2_FEE_RATE`, then the `btc.feeRate` of the profile, then the SDK default. |
| `--change-address <address>` | A Bitcoin address on the network of the identifier. The beacon validates it at broadcast time. | unset (the change returns to the beacon address) | Sends the change of the transaction to this address instead of the beacon address, so that the announcements of an identifier are not linked on-chain (ADR 044). If the flag is unset, the value comes from the `btc.changeAddress` of the profile. There is no environment variable for this value on purpose: a change address belongs to one identifier and one network. |
| `-h, --help` | | | Print the help of the command. |

### Behavior notes

- **Network.** There is no `--network` flag. The command decodes the network (`bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`) from the identifier (`-i`). The network drives the endpoint resolution, the profile selection, and the mainnet keystore guard.
- **Source resolution.** Without the source pair, the command resolves the identifier first, through the same path as `btcr2 resolve`. That resolution needs the sidecar data of each prior update that is not in a CAS. Pass it with `-r` or `--resolution-options-path`. The resolution applies `--min-conf` (default six). An external (`x`) identifier also needs its genesis document. Pass it with `--genesis-document` if it is not in a CAS. The command refuses a half pair before it reads any key: `Provide both --source-document and --source-version-id, or neither.` The command refuses the four resolution flags with the pair: `... apply only when --source-document and --source-version-id are omitted.` The api ignores resolution options if the pair is present (ADR 098), so the CLI refuses the combination instead of a silent ignore.
- **Mainnet dev keystore guard.** The command refuses a `bitcoin` (mainnet) identifier if the resolved keystore is a dev keystore (`DEV_KEYSTORE_MAINNET_ERROR`, ADR 080). Create an encrypted keystore (`btcr2 keystore init`) for a mainnet key.
- **Derivation (ADR 104).** Without `-m`, the api selects the one verification method whose `publicKeyMultibase` is the signing key. Without `-b`, the api selects the only beacon, else the one beacon with a spendable UTXO. The api refuses zero candidates and more than one candidate with a message that names them. Pass `-m` or `-b` to select.
- **Deactivated source.** The api refuses a source document with `deactivated: true`, supplied or resolved, before it signs (ADR 100).
- **Patch checks (ADR 112).** The api applies the patch strictly per RFC 6902 before it signs. It refuses a patch with an unknown `op`, a missing `value`, a `remove` or `replace` of a missing path, or a failed `test`, with `Invalid patch: ...`. It refuses a patch that changes the `id` of the document. The error type is `INVALID_DID_UPDATE`, also for a verification method that no `capabilityInvocation` entry identifies.
- **Funding checkpoint.** Before the broadcast, the api checks the beacon address for a spendable UTXO through the Bitcoin REST endpoint. An unfunded beacon fails after the signature but before any spend: `Beacon address ... is unfunded. Send BTC to this address before broadcasting the update.`
- **CAS before chain.** Under `auto` or `always` with a writable CAS, the api publishes the signed update (and, for a CAS beacon, the announcement) to the CAS before the transaction broadcast. A CAS failure therefore stops the command while the beacon UTXO is intact, and a second run is idempotent.
- **Output.** On success, the command prints the result on stdout. In text mode (default), it prints the update result object as pretty JSON. In JSON mode (`-o json`), it prints `{ "action": "update", "data": { ... } }`. The `data` payload is a `DidUpdateResult`: `signedUpdate` (the off-chain signed update, keep it for sidecar resolution), `txid` (the broadcast beacon transaction), `announcement` (CAS beacons only), `proof` (SMT beacons only, never in a CAS, always sidecar data), and `publishedToCas` (`{ update, announcement }` booleans that record what reached the CAS).
- **Watch hint.** In text mode, after a successful broadcast, the command prints a `Watch: <explorer-url>/tx/<txid>` line on stderr for a network with a block explorer (all except regtest). `--quiet` and `-o json` suppress the hint, so machine-readable output stays clean. `update` prints no faucet hint. That hint belongs to `create`.
- **Errors.** A failure prints the error message only and sets exit code 1. The full error object and the stack appear only under `--verbose`.

## Environment and configuration

Each value below follows the CLI-wide precedence: **flag, then environment variable, then the active profile, then the built-in default**. The active profile is `--profile`, else `defaults.profile` of the config file, else the profile with the name of the network of the identifier (a mutinynet identifier selects `profiles.mutinynet`). The config file is `--config`, else `<home>/config.json`. The home is `--home`, else `$BTCR2_HOME`, else `~/.btcr2` (`%LOCALAPPDATA%\btcr2` on Windows).

The environment variables that `update` reads:

| Variable | Flag or role |
|----------|--------------|
| `BTCR2_HOME` | The home directory (below `--home`). |
| `BTCR2_OUTPUT` | The output format (below `-o/--output`, above config `defaults.output`). |
| `BTCR2_BTC_REST` | `--btc-rest` |
| `BTCR2_BTC_RPC_URL` | `--btc-rpc-url` |
| `BTCR2_BTC_RPC_USER` | `--btc-rpc-user` |
| `BTCR2_BTC_RPC_PASS` | No flag (a password on argv is visible through `ps` and the shell history). The value can be an `env:<VAR>` or `file:<path>` secret reference. |
| `BTCR2_BTC_RPC_PASS_FILE` | The path of a file with the RPC password (the fallback if no layer supplies one). |
| `BTCR2_CAS_GATEWAY` | `--cas-gateway` |
| `BTCR2_CAS_RPC_URL` | `--cas-rpc-url` (a writable CAS, necessary for `--publish-to-cas auto` and `always`). |
| `BTCR2_BTC_SIGNAL_DISCOVERY` | `--btc-signal-discovery` (the source of the beacon signals, `indexer` or `fullnode`). An invalid value fails the command. `fullnode` without a connection with RPC fails the command too. |
| `BTCR2_BTC_TIMEOUT` | `--btc-timeout` |
| `BTCR2_CAS_TIMEOUT` | `--cas-timeout` |
| `BTCR2_FEE_RATE` | `--fee-rate` |
| `BTCR2_KEYSTORE_PASSPHRASE` | The keystore passphrase for unattended use (the passphrase source with the highest precedence). |

The config file keys that feed this command (under the active profile, unless noted):

| Key | Role |
|-----|------|
| `defaults.profile` | The active profile if `--profile` is absent. |
| `defaults.output` | The output format if neither `-o` nor `BTCR2_OUTPUT` is set. |
| `profiles.<name>.network` | The network that the profile declares (for the profile and network coherence). |
| `profiles.<name>.btc.rest` | The Esplora REST endpoint. |
| `profiles.<name>.btc.rpcUrl`, `rpcUser`, `rpcPass` | The Bitcoin Core RPC endpoint and credentials. They resolve as one unit: the URL, the user, and the password always come from the same precedence layer. A host from one layer never gets the credentials of another layer (ADR 074). |
| `profiles.<name>.btc.wallet` | The Bitcoin Core wallet name (`--btc-rpc-wallet`). |
| `profiles.<name>.btc.headers`, `rpcHeaders` | Extra REST and RPC headers. The repeatable `--btc-rest-header` and `--btc-rpc-header` flags merge over them, and a flag wins per key. |
| `profiles.<name>.btc.signalDiscovery` | The source of the beacon signals: `"indexer"` (default) or `"fullnode"`. Below `--btc-signal-discovery` and `BTCR2_BTC_SIGNAL_DISCOVERY`. `fullnode` needs a connection with RPC. Without one, the connection setup fails and the update stops. |
| `profiles.<name>.btc.timeoutMs` | The Bitcoin request timeout (`--btc-timeout`, unset means no limit). |
| `profiles.<name>.btc.feeRate` | The fee rate in sats/vByte, below `--fee-rate` and `BTCR2_FEE_RATE`. |
| `profiles.<name>.btc.changeAddress` | The change address, below `--change-address` (no environment layer). |
| `profiles.<name>.cas.gateway` | The read-only IPFS gateway for CAS reads. |
| `profiles.<name>.cas.rpcUrl` | The writable IPFS RPC endpoint. It wins over the gateway, and `--publish-to-cas auto` and `always` need it. |
| `profiles.<name>.cas.timeoutMs` | The CAS request timeout (`--cas-timeout`, default 30000, `0` disables it). |
| `profiles.<name>.identity.keystore` | The keystore path, below the `--keystore` flag, above `<home>/keystore.json`. |
| `profiles.<name>.identity.default` | The default signing key reference, below the `--signing-key` flag. |

A blank value at one layer defers to the next layer. It does not mask the next layer.

### Signing key and passphrase

The signing key comes from `--signing-key`, else the `identity.default` of the active profile, else the active key of the keystore (set with `btcr2 key use`). With no reference and no active key, the command fails. A reference is an exact URN (`urn:kms:secp256k1:<fingerprint>`), a unique key `name` tag, or a unique fingerprint prefix. An exact name wins over a fingerprint prefix. An ambiguous reference is an error. The resolution of a reference reads public key material only, and it never asks for the passphrase.

The command gets the keystore passphrase (for an encrypted keystore) in this order, and never from a flag value:

1. The `BTCR2_KEYSTORE_PASSPHRASE` environment variable.
2. `--passphrase-file <path>` (the file content, the CLI trims one trailing newline).
3. A live session that `btcr2 keystore unlock` cached in `<home>/session.json` (ADR 081). For a mainnet (`bitcoin`) identifier, the command uses the session only if you unlocked it with `--allow-mainnet`. Otherwise mainnet keeps the per-use authentication and falls through to the prompt.
4. An interactive terminal prompt with no echo. With no TTY and none of the sources above, the command fails with `PASSPHRASE_REQUIRED_ERROR`.

A dev (plaintext) keystore needs no passphrase, but the command refuses it for a mainnet operation.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. `update` uses: `--signing-key`, `--keystore`, `--passphrase-file`, `--profile`, `--home`, `-c/--config`, `-o/--output`, `--quiet` (suppresses the stderr `Watch:` hint), `--verbose`, the Bitcoin endpoint overrides (`--btc-rest`, `--btc-rpc-url`, `--btc-rpc-user`, `--btc-rpc-wallet`, `--btc-rest-header`, `--btc-rpc-header`, `--btc-signal-discovery`, `--btc-timeout`), and the CAS overrides (`--cas-gateway`, `--cas-rpc-url`, `--cas-timeout`). The CAS overrides gate `--publish-to-cas`.

## Examples

Add an `alsoKnownAs` entry to a mutinynet identifier, with the key named `demo`. The command resolves the current document (version 1), derives the verification method and the beacon, then signs and broadcasts:

```bash
DID='did:btcr2:k1q5p57d2mmjmuczhh9rhnen4ev9weq6ztkkev5hu9n2c0pdcyqav8r2sfy39pm'

btcr2 --signing-key demo update \
  -i "$DID" \
  -p '[{"op":"add","path":"/alsoKnownAs","value":["https://example.com/demo"]}]'
```

JSON output. Keep only the signed update for a later sidecar resolution:

```bash
btcr2 -o json --signing-key demo update \
  -i "$DID" \
  -p '[{"op":"add","path":"/service/-","value":{"id":"#svc","type":"X","serviceEndpoint":"https://x"}}]' \
  | jq '.data.signedUpdate' > signed-update.json
```

A second update. The prior update is sidecar data only, so the source resolution needs it. `--min-conf 1` lets a signal with one confirmation count:

```bash
btcr2 --signing-key demo update \
  -i "$DID" \
  --min-conf 1 \
  -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)" \
  -p '[{"op":"remove","path":"/service/1"}]'
```

An external (`x`) identifier whose genesis document is not in a CAS. The file that `btcr2 genesis build` wrote fills the sidecar data:

```bash
btcr2 --signing-key alice update \
  -i did:btcr2:x1q... \
  --genesis-document ./alice.json \
  -p '[{"op":"add","path":"/alsoKnownAs","value":["https://example.com/alice"]}]'
```

An offline source. Use this form if the source document is not reachable over the network, or if you already hold large sidecar data. Supply the document and its version, and name the method and the beacon. `doc-v1.json` holds the document as `btcr2 -o json resolve` printed it under `.data.didDocument`:

```bash
btcr2 --signing-key demo update \
  -i "$DID" \
  -s "$(cat doc-v1.json)" \
  --source-version-id 1 \
  -p '[{"op":"remove","path":"/service/1"}]' \
  -m "${DID}#initialKey" \
  -b "${DID}#initialP2WPKH"
```

Raise the fee on a busy network, and send the change away from the beacon address:

```bash
btcr2 update \
  -i "$DID" \
  -p '[{"op":"remove","path":"/service/1"}]' \
  --fee-rate 12 \
  --change-address tb1q...
```

`tb1q...` is a placeholder. Put a fresh address under your control on the network of the identifier. The beacon validates the change address at broadcast time. A malformed address, or an address of another network, stops the update.

Require the CAS publication against a local writable IPFS (Kubo) node:

```bash
btcr2 --cas-rpc-url http://127.0.0.1:5001 update \
  -i "$DID" \
  -p '[{"op":"add","path":"/alsoKnownAs","value":["https://example.com"]}]' \
  --publish-to-cas always
```

An unattended run (CI or a script), with the keystore passphrase from a file:

```bash
btcr2 --passphrase-file /run/secrets/btcr2-pass --signing-key demo update \
  -i "$DID" \
  -p "$(cat patches.json)"
```

## See also

- `btcr2 resolve`: make sure that the update applied. Its sidecar options are the `-r` input of the next `update`.
- `btcr2 deactivate`: deactivate an identifier for good. It takes the same signature, fee, change address, and CAS flags.
- `btcr2 create`: create the identifier and the initial DID document. It prints the beacon funding hint.
- `btcr2 key` and `btcr2 keystore`: manage the signing keys, create the keystore, and `btcr2 keystore unlock` a session so that an update does not ask for the passphrase.
- `btcr2 config`: show the effective endpoint config (`btcr2 config effective`, `btcr2 config doctor`).
- [DEMO.md](./DEMO.md): the full create, fund, resolve, update, and deactivate walkthrough on mutinynet.
