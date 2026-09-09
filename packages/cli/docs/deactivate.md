# btcr2 deactivate

Permanently and irreversibly deactivates a did:btcr2 identifier. The command calls the api's
`deactivateDid`. Deactivation is a regular DID update whose only change is the fixed JSON Patch
`[{ "op": "add", "path": "/deactivated", "value": true }]` (ADR 094); the api supplies that patch.
The api refuses a document that is deactivated already (ADR 100). The command resolves the current
document from the network, or takes the source pair you supply. It signs the update with a key
from the keystore, optionally publishes the artifacts to a writable CAS, and broadcasts a beacon
signal transaction on the Bitcoin network that the DID encodes. It shares the update write path
end to end (same funding prerequisite, same signing and session behavior, same
`--publish-to-cas` / `--fee-rate` / `--change-address` knobs). Use it only when you are certain
that the identifier must reach its terminal state; there is no undo. `delete` is an alias.

## Synopsis

```
btcr2 deactivate -i <did> [-s <doc-json> --source-version-id <n>] [-m <vm-id>] [-b <beacon-id>]
                 [-r <json> | --resolution-options-path <path>] [--min-conf <n>]
                 [--genesis-document <path>]
                 [--publish-to-cas <auto|always|never>] [--fee-rate <satsPerVByte>]
                 [--change-address <address>]

btcr2 delete ...        # alias, identical behavior
```

There are no subcommands.

## Options

`-i` is required. The other flags are optional; `-s` and `--source-version-id` come together or not
at all, and the command errors before it reads any key if only one is given.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-i, --identifier <identifier>` | A `did:btcr2:...` identifier. The network is derived from it. A DID that encodes an unsupported network fails with `Unsupported network "..." in DID.` | (required) | The DID to deactivate. It drives the network, the mainnet keystore guard, and the resolution of the current document. A supplied `-s` document must carry this DID as its `id`; the api refuses a mismatch before it signs. |
| `-s, --source-document <json>` | JSON object (the current DID document). Parsed with `JSON.parse` at flag-parse time; invalid JSON is rejected (`INVALID_ARGUMENT_ERROR`). Requires `--source-version-id`. | none | The document to deactivate. Omit both `-s` and `--source-version-id` to let the command resolve the current document first. Supply both for an offline source, or when you already hold a bulky sidecar. |
| `--source-version-id <number>` | Digits only (`/^\d+$/`): a non-negative integer. `-1`, `1.5`, or `2a` are rejected at parse time (`INVALID_ARGUMENT_ERROR`). Requires `--source-document`. | none | The version ID of the source document; the deactivation becomes version `n + 1`. |
| `-m, --verification-method-id <id>` | A verification method ID present in the document's `capabilityInvocation` (validated before the update is constructed). Absolute (`did:btcr2:...#initialKey`) and relative (`#initialKey`) DID URLs are both accepted: the id is resolved against the source document before matching. | derived | Verification method used to sign the deactivation. Its key must be resolvable in the keystore. Without the flag, the api picks the one method whose `publicKeyMultibase` is the signing key (ADR 104). The api refuses zero or several candidates and names them; pass the flag to choose one. |
| `-b, --beacon-id <id>` | A DID URL that names a beacon service `id` in the source document, in either the absolute or the relative spelling. The value is a plain string, not JSON. | derived | The beacon service whose Bitcoin address broadcasts the deactivation signal. Without the flag, the api picks the only beacon of the document, else the one beacon with a spendable UTXO (ADR 104). The api refuses zero or several funded beacons and names them; pass the flag to choose one. |
| `-r, --resolution-options <json>` | Resolution options as a JSON string, the same shape as `btcr2 resolve -r`. Invalid JSON is rejected (`INVALID_ARGUMENT_ERROR`). Not allowed with the source pair. | none | Feeds the resolution of the current document. Supply sidecar data here if a prior update of the DID is not in a CAS. |
| `--resolution-options-path <path>` | Path to a JSON file with resolution options. `-r` wins if both are given. Not allowed with the source pair. | none | The file form of `-r`. There is no short form, so the flag set mirrors `update`, where `-p` is `--patches`. |
| `--min-conf <n>` | A positive integer (minimum 1). Other values are rejected at parse time (`INVALID_ARGUMENT_ERROR`). Not allowed with the source pair. | `6` (the specification value) | Minimum block confirmations a beacon signal needs before the source resolution applies it (ADR 105). Overrides a `minConf` inside `-r` or the options file. Pass `1` to build on an update that has one confirmation. |
| `--genesis-document <path>` | Path to the JSON genesis document of an external (`x`) identifier. An unreadable file or invalid JSON is rejected (`INVALID_ARGUMENT_ERROR`). Refused for a `k` identifier. Not allowed with the source pair. | none | Fills `sidecar.genesisDocument` of the resolution options, and wins over a value inside `-r` or the options file. Use it when the genesis document is not in a CAS (ADR 108). |
| `--publish-to-cas <mode>` | `auto` \| `always` \| `never`. Any other value is rejected at parse time. | `never` | CAS publication policy for the signed update (and, for CAS beacons, the announcement), applied before broadcast. `never`: publish nothing; distribute the returned artifacts via sidecar. `auto`: best effort; publish when a writable CAS (`--cas-rpc-url`) is configured, silently skip otherwise, never blocks. `always`: require a writable CAS; a read-only or absent CAS fails up front, before signing or spending. |
| `--fee-rate <satsPerVByte>` | Positive finite number of sats/vByte (fractions allowed). Zero, negative, or non-numeric values are rejected (`INVALID_ARGUMENT_ERROR`). | `5` (SDK default) | Fee rate for the beacon signal transaction. Raise it under congestion so the transaction confirms. |
| `--change-address <address>` | A Bitcoin address for the DID's network; validated by the beacon at broadcast time. | change returns to the beacon address | Sends transaction change to this address instead of back to the beacon address, so a DID's announcements are not linked on-chain (ADR 044). |
| `-h, --help` | | | Show help for the command. |

Notes on behavior not visible in `--help`:

- The network is never a flag: it is decoded from the identifier (`-i`). Supported networks are
  `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, and `regtest`; any other embedded
  network aborts with `INVALID_ARGUMENT_ERROR`.
- Source resolution: with no source pair, the command resolves the DID first, through the same
  path as `btcr2 resolve`. That resolution needs the sidecar data of every prior update that is
  not in a CAS, passed with `-r` or `--resolution-options-path`, and honours `--min-conf`
  (default six). An external (`x`) identifier also needs its genesis document, passed with
  `--genesis-document` when it is not in a CAS. A half pair is refused before any key is read:
  `Provide both --source-document and --source-version-id, or neither.` The four resolution
  flags with the pair are refused: `... apply only when --source-document and
  --source-version-id are omitted.`
- Mainnet guard (ADR 080): if the DID's network is `bitcoin` and the resolved keystore is an
  unencrypted dev keystore, the command hard-refuses (`DEV_KEYSTORE_MAINNET_ERROR`) before touching
  any key material.
- Derivation (ADR 104): with no `-m`, the api picks the one verification method whose
  `publicKeyMultibase` is the signing key. With no `-b`, the api picks the only beacon, else the
  one beacon with a spendable UTXO. Zero or several candidates are refused with a message that
  names them; pass `-m`/`-b` to choose.
- Deactivated source (ADR 100): a source document with `deactivated: true`, supplied or resolved,
  is refused before signing. The api supplies the deactivation patch itself (ADR 094).
- Funding prerequisite: the beacon address must hold at least one spendable UTXO. An unfunded
  address aborts with `Beacon address <addr> is unfunded. Send BTC to this address before
  broadcasting the update.` after signing but before any coins move.
- CAS publication (when enabled) happens before the on-chain broadcast, so a CAS failure aborts
  while the beacon UTXO is still intact; content addressing makes a retry idempotent.

### Output

- Text mode (default): the update result payload is pretty-printed as JSON to stdout:
  `signedUpdate` (the full signed BTCR2 update for sidecar distribution), `txid` (the beacon signal
  transaction), `announcement` (CAS beacons only), `proof` (SMT beacons only; always distribute via
  sidecar), and `publishedToCas` (`{ update, announcement }` booleans recording what actually
  reached the CAS).
- Text mode also prints a watch hint to stderr on networks with a block explorer
  (all except regtest): `Watch: <explorer-tx-url>`, e.g. `https://mutinynet.com/tx/<txid>`.
  Suppressed under `--quiet` and in JSON mode; there is no faucet hint on this command.
- JSON mode (`-o json`): stdout carries `{ "action": "deactivate", "data": { ...same payload... } }`
  and nothing is written to stderr on success.
- Errors print their message only (full object and stack under `--verbose`) and exit with code 1.

Capture the printed `signedUpdate` (and `announcement`/`proof` when present): a resolver needs it
as sidecar data to observe the deactivated state unless it was published to a CAS.

## Environment & configuration

General precedence for every knob: flag > environment variable > active profile in `config.json` >
built-in default. Exceptions are called out below.

### Environment variables consulted

| Variable | Feeds | Equivalent flag |
|----------|-------|-----------------|
| `BTCR2_HOME` | Home directory holding `config.json`, `keystore.json`, `session.json` | `--home` (flag wins) |
| `BTCR2_OUTPUT` | Output format (`json` or `text`) | `-o, --output` |
| `BTCR2_KEYSTORE_PASSPHRASE` | Keystore passphrase (see passphrase order below) | none (never a flag value) |
| `BTCR2_FEE_RATE` | Fee rate in sats/vByte | `--fee-rate` |
| `BTCR2_BTC_REST` | Bitcoin REST (Esplora) endpoint | `--btc-rest` |
| `BTCR2_BTC_RPC_URL` | Bitcoin Core RPC endpoint | `--btc-rpc-url` |
| `BTCR2_BTC_RPC_USER` | Bitcoin Core RPC username | `--btc-rpc-user` |
| `BTCR2_BTC_RPC_PASS` | Bitcoin Core RPC password (supports `env:<VAR>` / `file:<path>` refs) | none (a password on argv is readable through `ps` and shell history) |
| `BTCR2_BTC_RPC_PASS_FILE` | Path to a file holding the RPC password (fallback when no layer supplies one) | none |
| `BTCR2_BTC_TIMEOUT` | Bitcoin REST/RPC timeout in ms (>= 1) | `--btc-timeout` |
| `BTCR2_BTC_SIGNAL_DISCOVERY` | Where beacon signals are read from (`indexer` \| `fullnode`); an invalid value, or `fullnode` without an RPC-capable connection, aborts the command | `--btc-signal-discovery` |
| `BTCR2_CAS_GATEWAY` | Read-only IPFS gateway for CAS reads | `--cas-gateway` |
| `BTCR2_CAS_RPC_URL` | Writable IPFS RPC endpoint (enables `--publish-to-cas auto|always`) | `--cas-rpc-url` |
| `BTCR2_CAS_TIMEOUT` | CAS timeout in ms (`0` disables) | `--cas-timeout` |

### config.json / profile keys that feed this command

The config file lives at `<home>/config.json` (override with `-c/--config`). The active profile is
the `--profile` flag, else `defaults.profile`; when neither names a profile, the profile keyed by
the DID's network name is used for connection resolution (e.g. a mutinynet DID reads
`profiles.mutinynet`).

| Key | Feeds |
|-----|-------|
| `defaults.output` | Output format fallback (`json` \| `text`) |
| `defaults.profile` | Active profile selection |
| `profiles.<name>.network` | Which network a non-network-named profile targets (affects active-profile resolution) |
| `profiles.<name>.btc.rest`, `.rpcUrl`, `.rpcUser`, `.rpcPass` | Bitcoin endpoints and credentials |
| `profiles.<name>.btc.feeRate` | Fee rate (number, sats/vByte) |
| `profiles.<name>.btc.changeAddress` | Change address (no env var for this one: flag > profile only) |
| `profiles.<name>.btc.timeoutMs`, `.headers`, `.wallet`, `.rpcHeaders` | Timeout, extra REST headers, RPC wallet, extra RPC headers |
| `profiles.<name>.btc.signalDiscovery` | Where beacon signals are read from (`"indexer"` \| `"fullnode"`) |
| `profiles.<name>.cas.gateway`, `.rpcUrl`, `.timeoutMs` | CAS endpoints and timeout |
| `profiles.<name>.identity.keystore` | Keystore path (below the `--keystore` flag, above `<home>/keystore.json`) |
| `profiles.<name>.identity.default` | Default signing-key reference (below the `--signing-key` flag, above the KMS active key) |

RPC credentials resolve as one atomic unit (ADR 074): url, user, and pass are taken together from
the highest layer (flag, env, profile) that supplies a url, so a host from one layer is never paired
with another layer's credentials.

### Signing key resolution

The signing key reference is, in order: `--signing-key <ref>`, else the active profile's
`identity.default`, else the keystore's active key (set with `btcr2 key use`). A reference may be a
full URN (`urn:kms:secp256k1:<fingerprint>`), a unique key name, or a unique fingerprint prefix; an
exact name match wins over a fingerprint prefix. No match, an ambiguous match, or no reference plus
no active key all abort before anything is signed.

### Passphrase and session

Signing with an encrypted keystore requires the passphrase, acquired in this order (note the env
var sits above the flag-named file):

1. `BTCR2_KEYSTORE_PASSPHRASE` environment variable
2. `--passphrase-file <path>` (contents, one trailing newline trimmed)
3. A live session cached by `btcr2 keystore unlock` at `<home>/session.json` (ADR 081). A session
   is consumed only if it is unexpired, bound to the resolved keystore, and matches the current
   passphrase verifier. For a mainnet (`bitcoin`) DID, a session is consumed only if it was
   unlocked with `--allow-mainnet`; otherwise the command falls through to a per-use prompt.
4. A non-echoing interactive terminal prompt. If stdin is not a TTY and none of the above supplied
   a passphrase, the command fails with `PASSPHRASE_REQUIRED_ERROR`.

Dev (plaintext) keystores need no passphrase but are refused outright for mainnet DIDs.

## Global options

See the [docs README](./README.md#global-options) for the shared global flags. Globals this command notably interacts
with: `--signing-key`, `--keystore`, `--passphrase-file`, `--home`, `-c/--config`, `--profile`,
`-o/--output`, `--quiet`, `--verbose`, the Bitcoin connection overrides (`--btc-rest`,
`--btc-rpc-url`, `--btc-rpc-user`, `--btc-rpc-wallet`, `--btc-rest-header`,
`--btc-rpc-header`, `--btc-signal-discovery`, `--btc-timeout`), and the CAS overrides (`--cas-gateway`, `--cas-rpc-url`,
`--cas-timeout`; a writable `--cas-rpc-url` is what makes `--publish-to-cas auto|always`
meaningful).

## Examples

Deactivate a mutinynet DID, signing with the key named `demo`. The version-2 update of the DID is
sidecar-only, so the source resolution needs it, and `--min-conf 1` lets a one-block-deep signal
count. The api derives the verification method and the beacon, and supplies the deactivation
patch:

```bash
DID='did:btcr2:k1qqp...'
btcr2 --signing-key demo deactivate \
  -i "$DID" \
  --min-conf 1 \
  -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)"
```

An external (`x`) identifier whose genesis document is not in a CAS. The file that
`btcr2 genesis build` wrote fills the sidecar:

```bash
btcr2 --signing-key alice deactivate \
  -i did:btcr2:x1q... \
  --genesis-document ./alice.json
```

Offline source: the current document (version 2) is saved in `doc-v2.json`. The pair skips the
resolution, so the resolution flags are not allowed here. The api still derives the
verification method and the beacon:

```bash
btcr2 --signing-key demo deactivate \
  -i "$DID" \
  -s "$(cat doc-v2.json)" \
  --source-version-id 2
```

Same as the first example, with a higher fee rate under congestion and change sent to a fresh
unlinked address:

```bash
btcr2 --signing-key demo deactivate \
  -i "$DID" \
  --min-conf 1 \
  -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)" \
  --fee-rate 12 \
  --change-address tb1q...
```

Unattended use (CI or a script; no TTY): supply the passphrase via a file, or unlock a session
first:

```bash
btcr2 --passphrase-file /run/secrets/btcr2-pass --signing-key demo deactivate \
  -i "$DID" \
  --min-conf 1 \
  -r "$(jq -c '{sidecar:{updates:[.]}}' signed-update.json)"

# or, interactively beforehand:
btcr2 keystore unlock --ttl 1h
```

## See also

- `btcr2 update`: the general write path this command specializes (deactivation is an update with
  a fixed patch).
- `btcr2 resolve`: verify the terminal state afterwards; with the deactivation supplied as sidecar
  data, `didDocumentMetadata.deactivated` is `true`.
- `btcr2 key`, `btcr2 keystore`: manage the signing key and the passphrase/session used here.
- [DEMO.md](./DEMO.md): the full lifecycle walkthrough, including a deactivate step on mutinynet.
