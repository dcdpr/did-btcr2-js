# btcr2 resolve

Resolves the DID document of a `did:btcr2` identifier and prints the resolution result on stdout. The command is read-only and needs no keystore: it never touches the keystore, never asks for a passphrase, and never reads the session. The identifier encodes the network. So `resolve` works with no config against the public defaults of each network: the mempool.space Esplora REST endpoints and the public `https://ipfs.io` IPFS gateway for CAS reads.

The CLI drives the sans-I/O `Resolver` state machine through `@did-btcr2/api`. The api fetches the beacon signals from the Bitcoin REST endpoint. With `--btc-signal-discovery fullnode`, it scans blocks over Bitcoin Core RPC instead. The api fetches a genesis document, a CAS announcement, or a signed update from the configured CAS by hash, if the sidecar data does not supply it. Use `-r` or `-p` to pass resolution options (a version pin, sidecar data, a discovery limit).

## Synopsis

```
btcr2 resolve [options] -i <identifier>
btcr2 read [options] -i <identifier>          # 'read' is an alias

btcr2 resolve -i did:btcr2:k1qq...
btcr2 resolve -i did:btcr2:x1qh... -r '<json>'
btcr2 resolve -i did:btcr2:x1qh... -p <path-to-json-file>
btcr2 resolve -i did:btcr2:x1qh... --genesis-document ./genesis.json
```

There are no subcommands and no arguments. The required `-i` flag carries the identifier.

## Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-i, --identifier <identifier>` | A `did:btcr2` identifier string: `did:btcr2:` and a Bech32m body. The HRP is `k` (deterministic, a 33-byte compressed secp256k1 public key) or `x` (external, a 32-byte genesis document hash). The encoded network must be one of `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`. | none (required) | The identifier to resolve. The command decodes and validates it before any I/O. A malformed identifier fails at once (for example `Invalid did: <value>`). An identifier with a reserved network value (`6` to `11`) or a custom network value (`12` to `15`) fails at decode with `Invalid network (reserved): <n>` or `Invalid network (custom network not supported): <n>` (ADR 107). |
| `-r, --resolution-options <json>` | An inline JSON string. See "Resolution options JSON" below for the shape. | none | The resolution options, passed to the resolver as they are. Non-JSON input fails with `Invalid resolution options. Must be a valid JSON string.` (`INVALID_ARGUMENT_ERROR`). If both `-r` and `-p` are present, `-r` wins and the command ignores `-p` without a message. |
| `-p, --resolution-options-path <path>` | The path of a file with the same JSON shape as `-r`. | none | The file form of `-r`. An unreadable path or non-JSON content fails with `Invalid resolution options path. Must be a valid path to a JSON file.` (`INVALID_ARGUMENT_ERROR`). |
| `--min-conf <n>` | A positive integer (minimum 1). Another value fails at parse time with `--min-conf must be a positive integer (minimum 1).` | `6` (the specification value) | The minimum number of block confirmations that a beacon signal needs before resolution applies it (ADR 105). The flag overrides a `minConf` inside `-r` or `-p`. Pass `1` to see a fresh update after one block. |
| `--genesis-document <path>` | The path of the JSON genesis document of an external (`x`) identifier, for example the file that `btcr2 genesis build` wrote. An unreadable path or non-JSON content fails with `Invalid genesis document path. Must be a valid path to a JSON file.`. A JSON value that is not an object fails with `Invalid genesis document. The file must contain a JSON object.`. | none | Fills `sidecar.genesisDocument` of the resolution options. The flag wins over a `sidecar.genesisDocument` inside `-r` or `-p`. For a `k` identifier, the command refuses the flag with `--genesis-document applies only to external identifiers (x).` before it reads the file (ADR 108). |
| `-h, --help` | none | n/a | Print the help of the command and exit. |

The validation order (from the source): the command decodes the identifier first, then checks `--genesis-document` against the identifier type, then parses `-r`, then `-p`, then reads the genesis document file. An invalid identifier therefore fails before the command looks at a bad options string.

The `--help` text of `resolve` matches the source.

### Resolution options JSON (the `-r` or `-p` value)

The JSON object is the `ResolutionOptions` type of `@did-btcr2/method`. Each field is optional. An empty object `{}` equals no options.

| Field | Type | Meaning |
|-------|------|---------|
| `versionId` | string | The version of the DID document to resolve, as an ASCII string. The versions start at `"1"`. |
| `versionTime` | string | An XML datetime in UTC without sub-second precision (for example `'2026-07-01T00:00:00Z'`). The resolver returns the most recent version that was valid before that time. |
| `maxDiscoveryRounds` | number | An opt-in upper bound on the number of beacon discovery rounds. Unset, absent, or not positive means no limit. The resolver always stops, because it does not query a beacon address twice. A positive value is a resource guard. A run over the limit fails with `INTERNAL_ERROR`. |
| `sidecar` | object | The off-chain data bundle. See below. |

The `sidecar` fields:

| Field | Type | Meaning |
|-------|------|---------|
| `@context` | string | The optional context string `https://btcr2.dev/context/v1`. |
| `genesisDocument` | object | The genesis document. An `x` identifier needs it, unless the api can fetch the document from the configured CAS by its hash. |
| `updates` | array of SignedBTCR2Update | The signed updates. Necessary if the identifier has published updates that the api cannot fetch from the CAS. |
| `casUpdates` | array of CASAnnouncement | The CAS announcements (maps of identifier to signed update hash). Necessary for CAS beacon updates that the api cannot fetch from the CAS. |
| `smtProofs` | array of SMTProof | The SMT inclusion proofs (`id`, `collapsed`, `hashes`, optional `nonce` and `updateId`, all base64url without padding). **Sidecar data is the only channel for an SMT proof.** A proof has a nonce blind, so the api cannot fetch it from a CAS. A missing proof fails resolution with `SMT proof required but not in sidecar (root hash: ...)`. |

How the `@did-btcr2/api` layer satisfies each data need:

- The api fetches the beacon signals from the Bitcoin endpoint of the signal discovery mode. `indexer` (the default) reads them from the REST endpoint of the network of the identifier. `fullnode` scans blocks over Bitcoin Core RPC.
- The api takes a genesis document, a CAS announcement, or a signed update from `sidecar` if present. Otherwise it fetches the item from the configured CAS by its hex hash. If the CAS lookup returns nothing, resolution fails with a typed error: `NOT_FOUND` for the genesis document (for example `Genesis document not found in CAS (hash: ...)`), `MISSING_UPDATE_DATA` for a signed update or a CAS announcement (for example `Signed update not found in CAS (hash: ...)`). The api hashes the bytes that the CAS returns and refuses content that does not hash to the requested address.
- An SMT proof comes from `sidecar.smtProofs` only (see above).

### Output

- Text mode (default): the `DidResolutionResult` object as pretty JSON with 2-space indentation on stdout: `{ "didResolutionMetadata": { "contentType": "application/did" }, "didDocument": { ... }, "didDocumentMetadata": { ... } }`. `didResolutionMetadata.contentType` is always `application/did` on success, the media type of a bare DID document. `didDocumentMetadata` always carries `versionId`, `confirmations`, and `deactivated`. `confirmations` is `0` and `versionId` is `"1"` before the first update. `updated` is present after an update.
- JSON mode (`-o json`): the same payload in the CLI envelope `{ "action": "resolve", "data": { ...DidResolutionResult... } }`, as pretty JSON on stdout.
- `--quiet` has no effect on this command. The command prints nothing except the result.
- There are no stderr hints. Unlike `create`, `update`, and `deactivate`, `resolve` prints no faucet or explorer links.

Exit codes: `0` on success, `1` on an error. Errors go to stderr. A CLI-typed error (an invalid identifier network, bad `-r` or `-p` input, a config problem) prints the message only, unless `--verbose` is set. Then it prints the full structured error. A resolution failure from the api layer (a network failure, missing sidecar data, an unreachable endpoint) is a plain `Error` with a `cause` chain. It prints with its stack, with or without `--verbose`. An identifier that does not decode, also one with a correct prefix but an invalid Bech32m body, fails as a method error of type `INVALID_DID` and prints as one line (`Invalid did: ...` or `Invalid method-specific id (Bech32m decoding failed: ...)`).

## Environment and configuration

`resolve` reads the network from the identifier. Then it resolves the Bitcoin and CAS endpoints of that network through the standard CLI precedence chain:

```
flag  >  environment variable  >  profile in config.json  >  built-in default of the network
```

A blank value at one layer defers to the next layer. It does not mask the next layer.

Profile selection: the `--profile <name>` flag, else `defaults.profile` of the config file, else the profile with the name of the network of the identifier. A mutinynet identifier selects `profiles.mutinynet`. `resolve` does **not** read `defaults.network` of the config file. That key steers a command without an identifier, such as `create`, `init`, and `quickstart`. The identifier always fixes the network.

The settings that feed this command:

| Setting | Flag | Env var | config.json key | Built-in default |
|---------|------|---------|-----------------|------------------|
| Home directory | `--home <dir>` | `BTCR2_HOME` | n/a | `~/.btcr2` (Linux and macOS). On Windows `%LOCALAPPDATA%\btcr2`, else `%APPDATA%\btcr2` |
| Config file | `-c, --config <path>` | none | n/a | `<home>/config.json` |
| Active profile | `--profile <name>` | none | `defaults.profile` | the network name of the identifier |
| Output format | `-o, --output <format>` (`json` \| `text`) | `BTCR2_OUTPUT` | `defaults.output` | `text` |
| Bitcoin REST endpoint | `--btc-rest <url>` | `BTCR2_BTC_REST` | `profiles.<name>.btc.rest` | per network, see below |
| Bitcoin Core RPC URL | `--btc-rpc-url <url>` | `BTCR2_BTC_RPC_URL` | `profiles.<name>.btc.rpcUrl` | `http://localhost:18443` (regtest only), none elsewhere |
| RPC username | `--btc-rpc-user <user>` | `BTCR2_BTC_RPC_USER` | `profiles.<name>.btc.rpcUser` | none |
| RPC password | none (never argv) | `BTCR2_BTC_RPC_PASS` | `profiles.<name>.btc.rpcPass` | none |
| RPC password file | none | `BTCR2_BTC_RPC_PASS_FILE` | none | none |
| RPC wallet | `--btc-rpc-wallet <name>` | none | `profiles.<name>.btc.wallet` | none |
| Extra REST headers | `--btc-rest-header <header>` (repeatable, `'Key: Value'`) | none | `profiles.<name>.btc.headers` | none |
| Extra RPC headers | `--btc-rpc-header <header>` (repeatable, `'Key: Value'`) | none | `profiles.<name>.btc.rpcHeaders` | none |
| Beacon signal discovery | `--btc-signal-discovery <mode>` (`indexer` \| `fullnode`) | `BTCR2_BTC_SIGNAL_DISCOVERY` | `profiles.<name>.btc.signalDiscovery` | `indexer` |
| Bitcoin timeout (ms) | `--btc-timeout <ms>` (finite number, 1 or more) | `BTCR2_BTC_TIMEOUT` | `profiles.<name>.btc.timeoutMs` | no limit |
| CAS gateway (read-only) | `--cas-gateway <url>` | `BTCR2_CAS_GATEWAY` | `profiles.<name>.cas.gateway` | `https://ipfs.io` |
| CAS RPC endpoint (writable) | `--cas-rpc-url <url>` | `BTCR2_CAS_RPC_URL` | `profiles.<name>.cas.rpcUrl` | none |
| CAS timeout (ms) | `--cas-timeout <ms>` (finite number, 0 or more. `0` disables the timeout) | `BTCR2_CAS_TIMEOUT` | `profiles.<name>.cas.timeoutMs` | `30000` |

The built-in Bitcoin REST defaults per network (from `@did-btcr2/api`):

| Network | REST default |
|---------|--------------|
| `bitcoin` | `https://mempool.space/api` |
| `testnet3` | `https://mempool.space/testnet/api` |
| `testnet4` | `https://mempool.space/testnet4/api` |
| `signet` | `https://mempool.space/signet/api` |
| `mutinynet` | `https://mutinynet.com/api` |
| `regtest` | `http://localhost:3000` (REST), `http://localhost:18443` (RPC, no default credentials) |

Behavior details, all checked against the source:

- **The RPC credentials resolve as one unit** (URL, user, and password from one precedence layer). A URL from one layer never gets the credentials of another layer. The password value can be a secret reference: `env:<VAR>` reads an environment variable, `file:<path>` reads a file (the CLI trims one trailing newline). The CLI uses any other value as it is. If no layer supplies a password, `BTCR2_BTC_RPC_PASS_FILE` (the path of a file with the password) is the last fallback. The CLI reads that file only if it builds an RPC config.
- **The CLI creates an RPC client only if a host exists**: one layer supplies `--btc-rpc-url` (or its environment or profile equivalent), or the network is `regtest` (which has a default RPC host). RPC credentials, a wallet name, or headers alone on a public network configure nothing. Most `resolve` runs use no RPC at all. The default `indexer` mode reads the beacon signals from the REST endpoint. The `fullnode` mode reads them over the RPC client, so it needs one.
- **A header flag merges over the profile headers** per key, and the flag wins. The headers apply also without a host override, so an authenticated Esplora or mempool endpoint works with the default host. A header value without a `Key: Value` colon fails with `INVALID_ARGUMENT_ERROR`.
- **CAS endpoint selection**: a writable `--cas-rpc-url` wins over the read-only gateway for a fetch. If only a CAS timeout is set, the CLI attaches the default gateway so that the timeout applies. The `--cas-rpc-url` help text mentions `--publish-to-cas`. That applies to `update` and `deactivate`. `resolve` only reads from the CAS.
- **A malformed config file fails the command** with `CONFIG_PARSE_ERROR` and the file name. The CLI refuses a config file from a newer CLI (a higher `schemaVersion`) with `CONFIG_SCHEMA_VERSION_ERROR`. An absent config file is fine: the defaults apply.
- **Timeout validation**: `--btc-timeout` must be a finite number of 1 or more (`0` would fail each request). `--cas-timeout` must be 0 or more (`0` disables the timeout). A violation fails with `INVALID_ARGUMENT_ERROR`.
- **Signal discovery validation**: a `--btc-signal-discovery` value other than `indexer` or `fullnode`, from any layer (also a typo in `BTCR2_BTC_SIGNAL_DISCOVERY` or in a profile), fails with `Invalid --btc-signal-discovery value "<value>". Expected indexer or fullnode.` (`INVALID_ARGUMENT_ERROR`). `fullnode` needs a connection with RPC. Without one (a public network with no RPC config), resolution fails with `signalDiscovery: 'fullnode' scans blocks over Bitcoin Core RPC, but no rpc config was resolved for network '<network>' ...`, a plain `Error` with its stack.
- **No keystore, passphrase, or session interaction.** `resolve` uses the api factory without a keystore. The command accepts `--keystore`, `--passphrase-file`, and `--signing-key`, but they have no effect here. The command never reads `<home>/session.json`, and no prompt can occur. The command does not read the `identity.*` keys of the profile, the `btc.feeRate` and `btc.changeAddress` broadcast values, or `BTCR2_FEE_RATE`.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. `resolve` uses: `-o, --output` (text or the JSON envelope), `--verbose` (the full structured error for a CLI-typed error), the connection overrides (`--btc-rest`, `--btc-rpc-url`, `--btc-rpc-user`, `--btc-rpc-wallet`, `--btc-rest-header`, `--btc-rpc-header`, `--btc-signal-discovery`, `--btc-timeout`, `--cas-gateway`, `--cas-rpc-url`, `--cas-timeout`), and the state location flags (`--home`, `-c, --config`, `--profile`). The command accepts `--quiet`, `--keystore`, `--passphrase-file`, and `--signing-key`, but they have no effect on it.

## Examples

```sh
# No config: the identifier encodes mainnet ('bitcoin'), so the CLI uses https://mempool.space/api
btcr2 resolve -i did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47

# The same, through the alias
btcr2 read -i did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47

# The JSON envelope ({ "action": "resolve", "data": ... })
btcr2 -o json resolve -i did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47

# Pin one version of the document
btcr2 resolve -i did:btcr2:k1qq... -r '{"versionId":"2"}'

# Resolve the document as it was at a point in time (UTC, no sub-second precision)
btcr2 resolve -i did:btcr2:k1qq... -r '{"versionTime":"2026-07-01T00:00:00Z"}'

# An external (x) identifier with sidecar data from a file
btcr2 resolve -i did:btcr2:x1qh... -p ./resolution-options.json

# An external (x) identifier with the genesis document that genesis build wrote
btcr2 resolve -i did:btcr2:x1qh... --genesis-document ./genesis.json

# Limit the beacon discovery rounds as a resource guard
btcr2 resolve -i did:btcr2:k1qq... -r '{"maxDiscoveryRounds":3}'

# Override the Bitcoin REST endpoint and limit the request time
btcr2 --btc-rest 'https://mutinynet.com/api' --btc-timeout 15000 resolve -i did:btcr2:k1qq...

# Use your own IPFS gateway for the CAS reads
btcr2 --cas-gateway 'http://127.0.0.1:8080' resolve -i did:btcr2:x1qh...
```

A `resolution-options.json` for an external identifier with sidecar updates:

```json
{
  "sidecar": {
    "genesisDocument": { "id": "did:btcr2:_", "@context": ["..."] },
    "updates": [ { "patch": [ ... ], "proof": { ... }, "targetVersionId": 2 } ],
    "smtProofs": [ { "id": "...", "collapsed": "...", "hashes": [ "..." ] } ]
  }
}
```

## See also

- `btcr2 create`: create the identifier that `resolve` reads back.
- `btcr2 identifier`: decode and validate the identifier offline.
- `btcr2 update` and `btcr2 deactivate`: publish the updates that `resolve` discovers and applies.
- `btcr2 config effective` and `btcr2 config doctor`: show the resolved endpoints (with their source) and probe them for a network.
- [README](./README.md): the global flags, the config file reference, and the profile rules.
- [DEMO.md](./DEMO.md): the full create, fund, resolve, update, and deactivate walkthrough on mutinynet.
