# btcr2 update

Updates a did:btcr2 document. The command signs a JSON Patch against the current document and
broadcasts an on-chain beacon signal. It derives the Bitcoin network from the identifier (`-i`).
It resolves the current document from the network, or takes the source pair you supply. It
resolves a signing key from the encrypted keystore and signs the update (a BIP-340 proof plus the
input signature of the beacon transaction). It spends a UTXO at the beacon address and broadcasts
a transaction whose `OP_RETURN` carries the update hash. Use it when a published DID document must
change: add or remove services, verification methods, or any other field that an RFC 6902 JSON
Patch can express. The signed update itself stays off-chain. Keep the returned artifacts for
sidecar distribution to resolvers, or opt into CAS publication with `--publish-to-cas`.

## Synopsis

```
btcr2 [global options] update -i <did> -p <json>
                              [-s <json> --source-version-id <number>] [-m <id>] [-b <id>]
                              [-r <json> | --resolution-options-path <path>] [--min-conf <n>]
                              [--genesis-document <path>]
                              [--publish-to-cas <auto|always|never>]
                              [--fee-rate <satsPerVByte>]
                              [--change-address <address>]

btcr2 update --help
```

There are no subcommands. Global options (`-o`, `--signing-key`, endpoint overrides, and so on)
go before the `update` keyword.

## Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-i, --identifier <identifier>` | A `did:btcr2:...` identifier. The network is derived from it. A DID that encodes an unsupported network fails with `Unsupported network "..." in DID.` | none (required) | The DID to update. It drives the network, the mainnet keystore guard, and the resolution of the current document. A supplied `-s` document must carry this DID as its `id`; the api refuses a mismatch before it signs. |
| `-s, --source-document <json>` | A complete DID document as a JSON string. Must parse as JSON or the command fails at parse time. Requires `--source-version-id`. | none | The document that the patch applies to. Omit both `-s` and `--source-version-id` to let the command resolve the current document first. Supply both for an offline source, or when you already hold a bulky sidecar. |
| `--source-version-id <number>` | A non-negative base-10 integer string (digits only; `1` for the first update). Negative, decimal, and non-numeric values are rejected at parse time with `--source-version-id must be a non-negative integer.` Requires `--source-document`. | none | The version of the source document that the patch applies to. |
| `-p, --patches <json>` | A JSON string holding an array of RFC 6902 JSON Patch operations (`op`, `path`, `value`, ...). Must parse as JSON or the command fails at parse time. | none (required) | The changes to apply to the source document. |
| `-m, --verification-method-id <id>` | A DID URL with fragment, e.g. `did:btcr2:...#initialKey`. A relative DID URL (`#initialKey`) is also accepted and is resolved against the source document, so it matches whichever spelling that document uses. Must be listed in the document's `capabilityInvocation`, resolve to a `Multikey` verification method, and have a `publicKeyMultibase` that starts with `zQ3s`. | derived | The verification method whose key signs the update. Without the flag, the api picks the one method whose `publicKeyMultibase` is the signing key (ADR 104). The api refuses zero or several candidates and names them; pass the flag to choose one. |
| `-b, --beacon-id <id>` | A DID URL that names a beacon service `id` in the source document, e.g. `did:btcr2:...#initialP2WPKH`. A relative DID URL (`#initialP2WPKH`) is also accepted and is resolved against the source document. The value is a plain string, not JSON. An id that names no service fails the factory check `No beacon service found for provided beaconId`. | derived | The beacon service (Singleton, CAS, or SMT) that announces the update on-chain. Without the flag, the api picks the only beacon of the document, else the one beacon with a spendable UTXO (ADR 104). The api refuses zero or several funded beacons and names them; pass the flag to choose one. |
| `-r, --resolution-options <json>` | Resolution options as a JSON string, the same shape as `btcr2 resolve -r`. Invalid JSON fails with `Invalid resolution options.` Not allowed with the source pair. | none | Feeds the resolution of the current document. Supply sidecar data here if a prior update of the DID is not in a CAS. |
| `--resolution-options-path <path>` | Path to a JSON file with resolution options. An unreadable file or invalid JSON fails with `Invalid resolution options path.` `-r` wins if both are given. Not allowed with the source pair. | none | The file form of `-r`. There is no short form: `-p` is `--patches` on this command. |
| `--min-conf <n>` | A positive integer (minimum 1). Other values are rejected at parse time with `--min-conf must be a positive integer (minimum 1).` Not allowed with the source pair. | `6` (the specification value) | Minimum block confirmations a beacon signal needs before the source resolution applies it (ADR 105). Overrides a `minConf` inside `-r` or the options file. Pass `1` to build on an update that has one confirmation. |
| `--genesis-document <path>` | Path to the JSON genesis document of an external (`x`) identifier. An unreadable file or invalid JSON fails with `Invalid genesis document path.` Refused for a `k` identifier with `--genesis-document applies only to external identifiers (x).` Not allowed with the source pair. | none | Fills `sidecar.genesisDocument` of the resolution options, and wins over a value inside `-r` or the options file. Use it when the genesis document is not in a CAS (ADR 108). |
| `--publish-to-cas <mode>` | One of `auto`, `always`, `never`. Any other value is rejected at parse time. | `never` | CAS publication policy for the update artifacts, applied before broadcast. `never`: publish nothing; distribute the returned artifacts via sidecar. `auto`: best-effort; publish the signed update (all beacon types) and the CAS Announcement (CAS beacons) when a writable CAS is configured, otherwise skip silently. `always`: require a writable CAS; a read-only or absent CAS aborts up-front, before any signing or spending. A writable CAS is configured via `--cas-rpc-url`, `BTCR2_CAS_RPC_URL`, or `profiles.<name>.cas.rpcUrl`. |
| `--fee-rate <satsPerVByte>` | A positive finite number of sats per vByte (decimals allowed). Zero, negative, or non-numeric values fail with `Invalid --fee-rate ...`. | unset (SDK default 5 sat/vB) | Fee rate for the beacon transaction. Raise it under congestion so the transaction confirms. When unset, resolution falls through to `BTCR2_FEE_RATE`, then the profile's `btc.feeRate`, then the SDK default. |
| `--change-address <address>` | A Bitcoin address on the DID's network; validated by the beacon at broadcast time. | unset (change returns to the beacon address) | Sends transaction change to this address instead of the beacon address, so a DID's successive announcements are not linked on-chain (ADR 044). When unset, falls through to the profile's `btc.changeAddress`. There is deliberately no environment variable for this knob (a change address is DID/network-specific). |
| `-h, --help` | | | Display help for the command. |

### Behavior notes

- **Network derivation.** There is no `--network` flag: the network (`bitcoin`, `testnet3`,
  `testnet4`, `signet`, `mutinynet`, `regtest`) is decoded from the identifier (`-i`) and
  drives endpoint resolution, profile auto-selection, and the mainnet keystore guard.
- **Source resolution.** With no source pair, the command resolves the DID first, through the
  same path as `btcr2 resolve`. That resolution needs the sidecar data of every prior update that
  is not in a CAS, passed with `-r` or `--resolution-options-path`, and honours `--min-conf`
  (default six). An external (`x`) identifier also needs its genesis document, passed with
  `--genesis-document` when it is not in a CAS. A half pair is refused before any key is read:
  `Provide both --source-document and --source-version-id, or neither.` The four resolution
  flags with the pair are refused: `... apply only when --source-document and
  --source-version-id are omitted.` The api ignores resolution options when the pair is
  supplied (ADR 098), so the cli refuses the combination instead of a silent ignore.
- **Mainnet dev-keystore guard.** A `bitcoin` (mainnet) DID is refused outright when the resolved
  keystore is an unencrypted dev keystore (`DEV_KEYSTORE_MAINNET_ERROR`, ADR 080). Establish an
  encrypted keystore (`btcr2 keystore init`) for mainnet keys.
- **Derivation (ADR 104).** With no `-m`, the api picks the one verification method whose
  `publicKeyMultibase` is the signing key. With no `-b`, the api picks the only beacon, else the
  one beacon with a spendable UTXO. Zero or several candidates are refused with a message that
  names them; pass `-m`/`-b` to choose.
- **Deactivated source.** A source document with `deactivated: true`, supplied or resolved, is
  refused before signing (ADR 100).
- **Funding checkpoint.** Before broadcasting, the beacon address is checked for spendable UTXOs
  via the Bitcoin REST endpoint. An unfunded beacon aborts after signing but before any spend:
  `Beacon address ... is unfunded. Send BTC to this address before broadcasting the update.`
- **CAS-before-chain ordering.** Under `auto`/`always` with a writable CAS, the signed update
  (and, for CAS beacons, the announcement) is published to CAS before the transaction broadcast,
  so a CAS failure aborts while the beacon UTXO is intact and a retry is idempotent.
- **Output.** On success the result is printed to stdout. In text mode (default) it is the
  pretty-printed update result object; in JSON mode (`-o json`) it is wrapped as
  `{ "action": "update", "data": { ... } }`. The `data` payload is a `DidUpdateResult`:
  `signedUpdate` (the off-chain signed update to keep for sidecar resolution), `txid` (the
  broadcast beacon transaction), `announcement` (CAS beacons only), `proof` (SMT beacons only,
  never CAS-fetchable; always sidecar), and `publishedToCas` (`{ update, announcement }` booleans
  recording what actually reached the CAS).
- **Watch hint.** In text mode, after a successful broadcast a `Watch: <explorer-url>/tx/<txid>`
  line is written to stderr for networks with a block explorer (all except regtest). Suppressed
  under `--quiet` and `-o json`, so machine-readable output is never touched. `update` prints no
  faucet hint (that belongs to `create`).
- **Errors.** Failures print only the error message and set exit code 1; the full error object and
  stack appear only under `--verbose`.

## Environment & configuration

Everything below follows the CLI-wide precedence order: **flag > environment variable > profile
config > built-in default**. The active profile is `--profile`, else the config file's
`defaults.profile`, else the profile named after the DID's network (e.g. a mutinynet DID
auto-selects `profiles.mutinynet`). The config file is `--config`, else `<home>/config.json`;
home is `--home`, else `$BTCR2_HOME`, else `~/.btcr2` (`%LOCALAPPDATA%\btcr2` on Windows).

Environment variables consulted by `update`:

| Variable | Equivalent flag / role |
|----------|------------------------|
| `BTCR2_HOME` | Home directory (below `--home`). |
| `BTCR2_OUTPUT` | Output format (below `-o/--output`, above config `defaults.output`). |
| `BTCR2_BTC_REST` | `--btc-rest` |
| `BTCR2_BTC_RPC_URL` | `--btc-rpc-url` |
| `BTCR2_BTC_RPC_USER` | `--btc-rpc-user` |
| `BTCR2_BTC_RPC_PASS` | no flag (a password on argv is readable through `ps` and shell history); supports `env:<VAR>` and `file:<path>` secret refs |
| `BTCR2_BTC_RPC_PASS_FILE` | Path to a file holding the RPC password (fallback when no layer supplies one) |
| `BTCR2_CAS_GATEWAY` | `--cas-gateway` |
| `BTCR2_CAS_RPC_URL` | `--cas-rpc-url` (a writable CAS; enables `--publish-to-cas auto|always`) |
| `BTCR2_BTC_SIGNAL_DISCOVERY` | `--btc-signal-discovery` (where beacon signals are read from: `indexer` or `fullnode`; an invalid value, or `fullnode` without an RPC-capable connection, aborts the command) |
| `BTCR2_BTC_TIMEOUT` | `--btc-timeout` |
| `BTCR2_CAS_TIMEOUT` | `--cas-timeout` |
| `BTCR2_FEE_RATE` | `--fee-rate` |
| `BTCR2_KEYSTORE_PASSPHRASE` | Keystore passphrase for unattended use (highest passphrase source) |

Config file keys that feed this command (under the active profile unless noted):

| Key | Role |
|-----|------|
| `defaults.profile` | Active profile when `--profile` is not given. |
| `defaults.output` | Output format when neither `-o` nor `BTCR2_OUTPUT` is set. |
| `profiles.<name>.network` | Declares the profile's network (used for profile/network coherence). |
| `profiles.<name>.btc.rest` | Esplora REST endpoint. |
| `profiles.<name>.btc.rpcUrl` / `rpcUser` / `rpcPass` | Bitcoin Core RPC endpoint and credentials. Resolved as one atomic unit: url, user, and pass always come from the same precedence layer, so a host from one layer never receives another layer's credentials (ADR 074). |
| `profiles.<name>.btc.wallet` | Bitcoin Core wallet name (`--btc-rpc-wallet`). |
| `profiles.<name>.btc.headers` / `rpcHeaders` | Extra REST / RPC headers, merged with the repeatable `--btc-rest-header` / `--btc-rpc-header` flags (flags win per key). |
| `profiles.<name>.btc.signalDiscovery` | Where beacon signals are read from: `"indexer"` (default) or `"fullnode"`; below `--btc-signal-discovery` and `BTCR2_BTC_SIGNAL_DISCOVERY`. `fullnode` needs an RPC-capable connection; without one the connection setup fails, aborting the update. |
| `profiles.<name>.btc.timeoutMs` | Bitcoin request timeout (`--btc-timeout`; unset means unbounded). |
| `profiles.<name>.btc.feeRate` | Fee rate in sats/vByte, below `--fee-rate` and `BTCR2_FEE_RATE`. |
| `profiles.<name>.btc.changeAddress` | Change address, below `--change-address` (no env layer). |
| `profiles.<name>.cas.gateway` | Read-only IPFS gateway for CAS reads. |
| `profiles.<name>.cas.rpcUrl` | Writable IPFS RPC endpoint; takes precedence over the gateway and is what `--publish-to-cas auto|always` needs. |
| `profiles.<name>.cas.timeoutMs` | CAS request timeout (`--cas-timeout`; default 30000, `0` disables). |
| `profiles.<name>.identity.keystore` | Keystore path, below the `--keystore` flag, above `<home>/keystore.json`. |
| `profiles.<name>.identity.default` | Default signing-key reference, below the `--signing-key` flag. |

A blank value at any layer defers to the next layer instead of masking it.

### Signing key and passphrase

The signing key is resolved from `--signing-key`, else the active profile's `identity.default`,
else the keystore's active key (set with `btcr2 key use`); with no reference and no active key the
command fails. A reference may be an exact URN (`urn:kms:secp256k1:<fingerprint>`), a unique key
`name` tag, or a unique fingerprint prefix; an exact name wins over a fingerprint prefix, and an
ambiguous reference is an error. Resolving a reference reads only public key material and never
prompts.

The keystore passphrase (for an encrypted keystore) is acquired in this order, and never from a
command-line flag value:

1. `BTCR2_KEYSTORE_PASSPHRASE` environment variable.
2. `--passphrase-file <path>` (contents, one trailing newline trimmed).
3. A live session cached by `btcr2 keystore unlock` at `<home>/session.json` (ADR 081). For a
   mainnet (`bitcoin`) DID the session is consumed only if it was unlocked with
   `--allow-mainnet`; otherwise mainnet keeps per-use authentication and falls through to the
   prompt.
4. A hidden interactive terminal prompt. With no TTY and none of the above, the command fails
   with `PASSPHRASE_REQUIRED_ERROR`.

A dev (plaintext) keystore needs no passphrase but is refused for mainnet operations.

## Global options

See the [docs README](./README.md#global-options) for the shared global flags. Globals this command notably interacts
with: `--signing-key`, `--keystore`, `--passphrase-file`, `--profile`, `--home`, `-c/--config`,
`-o/--output`, `--quiet` (suppresses the stderr `Watch:` hint), `--verbose`, the Bitcoin endpoint
overrides (`--btc-rest`, `--btc-rpc-url`, `--btc-rpc-user`, `--btc-rpc-wallet`,
`--btc-rest-header`, `--btc-rpc-header`, `--btc-signal-discovery`, `--btc-timeout`), and the CAS overrides (`--cas-gateway`,
`--cas-rpc-url`, `--cas-timeout`, which gate `--publish-to-cas`).

## Examples

Add an `alsoKnownAs` entry to a mutinynet DID, signing with the key named `demo`. The command
resolves the current document (version 1), derives the verification method and the beacon, then
signs and broadcasts:

```bash
DID='did:btcr2:k1q5p57d2mmjmuczhh9rhnen4ev9weq6ztkkev5hu9n2c0pdcyqav8r2sfy39pm'

btcr2 --signing-key demo update \
  -i "$DID" \
  -p '[{"op":"add","path":"/alsoKnownAs","value":["https://example.com/demo"]}]'
```

JSON output, keeping only the signed update for later sidecar resolution:

```bash
btcr2 -o json --signing-key demo update \
  -i "$DID" \
  -p '[{"op":"add","path":"/service/-","value":{"id":"#svc","type":"X","serviceEndpoint":"https://x"}}]' \
  | jq '.data.signedUpdate' > signed-update.json
```

A second update. The prior update is sidecar-only, so the source resolution needs it, and
`--min-conf 1` lets a one-block-deep signal count:

```bash
btcr2 --signing-key demo update \
  -i "$DID" \
  --min-conf 1 \
  -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)" \
  -p '[{"op":"remove","path":"/service/1"}]'
```

An external (`x`) identifier whose genesis document is not in a CAS. The file that
`btcr2 genesis build` wrote fills the sidecar:

```bash
btcr2 --signing-key alice update \
  -i did:btcr2:x1q... \
  --genesis-document ./alice.json \
  -p '[{"op":"add","path":"/alsoKnownAs","value":["https://example.com/alice"]}]'
```

Offline source. Use this form when the source document is not reachable over the network, or
when you already hold a bulky sidecar. Supply the document and its version, and name the method
and the beacon. `doc-v1.json` holds the document as `btcr2 -o json resolve` printed it under
`.data.didDocument`:

```bash
btcr2 --signing-key demo update \
  -i "$DID" \
  -s "$(cat doc-v1.json)" \
  --source-version-id 1 \
  -p '[{"op":"remove","path":"/service/1"}]' \
  -m "${DID}#initialKey" \
  -b "${DID}#initialP2WPKH"
```

Raise the fee under congestion and route change away from the beacon address:

```bash
btcr2 update \
  -i "$DID" \
  -p '[{"op":"remove","path":"/service/1"}]' \
  --fee-rate 12 \
  --change-address tb1q...
```

`tb1q...` is a placeholder: substitute a fresh address you control on the DID's network. The
beacon validates the change address at broadcast time, so a malformed or wrong-network address
aborts the update.

Require CAS publication against a local writable IPFS (Kubo) node:

```bash
btcr2 --cas-rpc-url http://127.0.0.1:5001 update \
  -i "$DID" \
  -p '[{"op":"add","path":"/alsoKnownAs","value":["https://example.com"]}]' \
  --publish-to-cas always
```

Unattended run (CI or scripts), supplying the keystore passphrase from a file:

```bash
btcr2 --passphrase-file /run/secrets/btcr2-pass --signing-key demo update \
  -i "$DID" \
  -p "$(cat patches.json)"
```

## See also

- `btcr2 resolve`: verify an update landed; its sidecar options are the `-r` input of the next `update`.
- `btcr2 deactivate`: permanently deactivate a DID; takes the same signing, fee, change-address,
  and CAS knobs.
- `btcr2 create`: mint the identifier and initial document; prints the beacon funding hint.
- `btcr2 key` / `btcr2 keystore`: manage signing keys, establish the keystore, and
  `btcr2 keystore unlock` a session so updates do not prompt.
- `btcr2 config`: inspect the effective endpoint configuration (`btcr2 config effective`,
  `btcr2 config doctor`).
- [DEMO.md](./DEMO.md): a full create, fund, resolve, update, deactivate walkthrough on mutinynet.
