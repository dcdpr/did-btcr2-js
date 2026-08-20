# btcr2 resolve

Resolves the DID document of a `did:btcr2` identifier and prints the resolution result to stdout.
The command is read-only and keystore-free: it never touches the keystore, never prompts for a
passphrase, and never consults the session cache. The Bitcoin network is derived from the
identifier itself (it is encoded in the DID), so `resolve` works with zero configuration against
the public per-network defaults (mempool.space-style Esplora REST endpoints, and the public
`https://ipfs.io` IPFS gateway for CAS reads). Under the hood the CLI drives the sans-I/O
`Resolver` state machine through `@did-btcr2/api`: beacon signals are fetched from the Bitcoin
REST endpoint (or, with `--btc-signal-discovery fullnode`, by scanning blocks over Bitcoin Core
RPC), and any genesis document, CAS announcement, or signed update not supplied via
sidecar is fetched from the configured CAS by hash. Use `-r`/`-p` to pass resolution options
(version pinning, sidecar data, discovery limits).

## Synopsis

```
btcr2 resolve [options] -i <identifier>
btcr2 read [options] -i <identifier>          # 'read' is a registered alias

btcr2 resolve -i did:btcr2:k1qq...
btcr2 resolve -i did:btcr2:x1qh... -r '<json>'
btcr2 resolve -i did:btcr2:x1qh... -p <path-to-json-file>
```

There are no subcommands and no positional arguments; the identifier is passed with the required
`-i` flag.

## Options

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `-i, --identifier <identifier>` | A `did:btcr2` identifier string: `did:btcr2:` followed by a Bech32m-encoded body whose HRP is `k` (deterministic, 33-byte compressed secp256k1 pubkey) or `x` (external, 32-byte genesis-document hash). The embedded network must decode to one of `bitcoin`, `testnet3`, `testnet4`, `signet`, `mutinynet`, `regtest`. | none (required) | The DID to resolve. Decoded and validated before any I/O: a malformed DID fails immediately (for example `Invalid did: <value>`), and a DID whose network nibble decodes to a custom numeric network (decode-only values `1`-`3`) is rejected with `Unsupported network "<network>" in DID.` (`INVALID_ARGUMENT_ERROR`). |
| `-r, --resolution-options <json>` | An inline JSON string; see "Resolution options JSON" below for the accepted shape. | none | Resolution options passed straight through to the resolver. Non-JSON input fails with `Invalid resolution options. Must be a valid JSON string.` (`INVALID_ARGUMENT_ERROR`). When both `-r` and `-p` are given, `-r` wins and `-p` is silently ignored. |
| `-p, --resolution-options-path <path>` | Path to a file containing the same JSON shape as `-r`. | none | File-based alternative to `-r`. An unreadable path or non-JSON file content fails with `Invalid resolution options path. Must be a valid path to a JSON file.` (`INVALID_ARGUMENT_ERROR`). |
| `-h, --help` | none | n/a | Print usage for the command and exit. |

Validation order (from source): the identifier is decoded first, then `-r` is parsed, then `-p`.
An invalid identifier therefore fails before a bad options string is even looked at.

The printed `--help` output for `resolve` matches the source exactly; no discrepancies.

### Resolution options JSON (`-r` / `-p` value)

The JSON object is the `ResolutionOptions` type from `@did-btcr2/method`. All fields are optional;
an empty object `{}` is equivalent to passing no options.

| Field | Type | Meaning |
|-------|------|---------|
| `versionId` | string | ASCII string of the specific DID document version to resolve (versions start at `"1"`). |
| `versionTime` | string | XML datetime, UTC, no sub-second precision (for example `'2026-07-01T00:00:00Z'`). Resolves the most recent version valid before that time. |
| `maxDiscoveryRounds` | number | Opt-in upper bound on multi-round beacon-discovery passes. Unset, omitted, or non-positive means unlimited (termination is guaranteed by de-duplicating queried beacon addresses); a positive value is a resource guard, and exceeding it surfaces as an `INTERNAL_ERROR`. |
| `sidecar` | object | Off-chain data bundle, see below. |

`sidecar` fields:

| Field | Type | Meaning |
|-------|------|---------|
| `@context` | string | Optional context string `https://btcr2.dev/context/v1`. |
| `genesisDocument` | object | The genesis DID document. Required for `x1` (external) DIDs unless the document can be fetched from the configured CAS by its hash. |
| `updates` | array of SignedBTCR2Update | Signed updates. Required if the DID has published updates that cannot be fetched from the CAS. |
| `casUpdates` | array of CASAnnouncement | CAS announcements (maps of DID to signed-update hash). Required for CAS-beacon updates not fetchable from the CAS. |
| `smtProofs` | array of SMTProof | SMT inclusion proofs (`id`, `collapsed`, `hashes`, optional `nonce`/`updateId`, all base64url no-pad). **Sidecar is the only channel for SMT proofs**: they are nonce-blinded and cannot be fetched from a CAS, so a missing proof fails resolution with `SMT proof required but not in sidecar (root hash: ...)`. |

How data needs are satisfied (behavior of the `@did-btcr2/api` layer the CLI calls):

- Beacon signals are fetched from the Bitcoin endpoint selected by the signal-discovery mode:
  `indexer` (the default) reads them from the REST endpoint for the DID's network; `fullnode`
  scans blocks over Bitcoin Core RPC.
- A genesis document, CAS announcement, or signed update is taken from `sidecar` when present;
  otherwise it is fetched from the configured CAS by its hex hash. If the CAS lookup returns
  nothing, resolution fails (for example `Signed update not found in CAS (hash: ...)`).
- SMT proofs come from `sidecar.smtProofs` only (see above).

### Output

- Text mode (default): the `DidResolutionResult` object, pretty-printed as 2-space-indented JSON
  on stdout: `{ "didResolutionMetadata": {}, "didDocument": { ... }, "didDocumentMetadata":
  { ... } }`. `didResolutionMetadata` is always `{}` on success; version and update metadata
  (`versionId`, and so on) live in `didDocumentMetadata`.
- JSON mode (`-o json`): the same payload wrapped in the CLI result envelope:
  `{ "action": "resolve", "data": { ...DidResolutionResult... } }`, pretty-printed on stdout.
- `--quiet` has no effect on this command; it prints nothing besides the result.
- No stderr hints: unlike `create`, `update`, and `deactivate`, `resolve` prints no faucet or
  explorer links.

Exit codes: `0` on success, `1` on any error. Errors go to stderr. CLI-typed errors (invalid
identifier network, bad `-r`/`-p` input, config problems) print message-only unless `--verbose`
is set, in which case the full structured error is shown. A resolution failure raised by the API
layer (network failure, missing sidecar data, unreachable endpoint) is a plain `Error` with a
`cause` chain and prints with its stack regardless of `--verbose`. Note that a well-formed-prefix
DID with an invalid Bech32m body can also surface as a raw `TypeError` with a stack (the decoder's
own error), while `Invalid did: ...` prints as a single line.

## Environment & configuration

`resolve` derives its network from the DID, then resolves Bitcoin and CAS endpoints for that
network through the standard CLI precedence chain:

```
flag  >  environment variable  >  profile in config.json  >  built-in per-network default
```

A blank value at any layer defers to the next layer instead of masking it.

Profile selection: `--profile <name>` flag, else the config file's `defaults.profile`, else the
network name derived from the DID is used as the profile key (resolving a mutinynet DID
auto-selects `profiles.mutinynet`). The config file's `defaults.network` is **not** consulted by
`resolve` (that key steers commands that lack a network-fixing DID, such as offline `create`,
`init`, and `quickstart`); the DID always fixes the network.

Settings that feed this command:

| Setting | Flag | Env var | config.json key | Built-in default |
|---------|------|---------|-----------------|------------------|
| Home directory | `--home <dir>` | `BTCR2_HOME` | n/a | `~/.btcr2` (Linux/macOS); `%LOCALAPPDATA%\btcr2` on Windows (fallback `%APPDATA%\btcr2`) |
| Config file | `-c, --config <path>` | none | n/a | `<home>/config.json` |
| Active profile | `--profile <name>` | none | `defaults.profile` | network name from the DID |
| Output format | `-o, --output <format>` (`json` \| `text`) | `BTCR2_OUTPUT` | `defaults.output` | `text` |
| Bitcoin REST endpoint | `--btc-rest <url>` | `BTCR2_BTC_REST` | `profiles.<name>.btc.rest` | per network, see below |
| Bitcoin Core RPC URL | `--btc-rpc-url <url>` | `BTCR2_BTC_RPC_URL` | `profiles.<name>.btc.rpcUrl` | `http://localhost:18443` (regtest only); none elsewhere |
| RPC username | `--btc-rpc-user <user>` | `BTCR2_BTC_RPC_USER` | `profiles.<name>.btc.rpcUser` | none |
| RPC password | none (never argv) | `BTCR2_BTC_RPC_PASS` | `profiles.<name>.btc.rpcPass` | none |
| RPC password file | none | `BTCR2_BTC_RPC_PASS_FILE` | none | none |
| RPC wallet | `--btc-rpc-wallet <name>` | none | `profiles.<name>.btc.wallet` | none |
| Extra REST headers | `--btc-rest-header <header>` (repeatable, `'Key: Value'`) | none | `profiles.<name>.btc.headers` | none |
| Extra RPC headers | `--btc-rpc-header <header>` (repeatable, `'Key: Value'`) | none | `profiles.<name>.btc.rpcHeaders` | none |
| Beacon signal discovery | `--btc-signal-discovery <mode>` (`indexer` \| `fullnode`) | `BTCR2_BTC_SIGNAL_DISCOVERY` | `profiles.<name>.btc.signalDiscovery` | `indexer` |
| Bitcoin timeout (ms) | `--btc-timeout <ms>` (finite number >= 1) | `BTCR2_BTC_TIMEOUT` | `profiles.<name>.btc.timeoutMs` | unbounded |
| CAS gateway (read-only) | `--cas-gateway <url>` | `BTCR2_CAS_GATEWAY` | `profiles.<name>.cas.gateway` | `https://ipfs.io` |
| CAS RPC endpoint (writable) | `--cas-rpc-url <url>` | `BTCR2_CAS_RPC_URL` | `profiles.<name>.cas.rpcUrl` | none |
| CAS timeout (ms) | `--cas-timeout <ms>` (finite number >= 0; `0` disables) | `BTCR2_CAS_TIMEOUT` | `profiles.<name>.cas.timeoutMs` | `30000` |

Built-in per-network Bitcoin REST defaults (from `@did-btcr2/api`):

| Network | REST default |
|---------|--------------|
| `bitcoin` | `https://mempool.space/api` |
| `testnet3` | `https://mempool.space/testnet/api` |
| `testnet4` | `https://mempool.space/testnet4/api` |
| `signet` | `https://mempool.space/signet/api` |
| `mutinynet` | `https://mutinynet.com/api` |
| `regtest` | `http://localhost:3000` (REST), `http://localhost:18443` (RPC, no default credentials) |

Behavior details, all confirmed against the source:

- **RPC credentials resolve as one atomic unit** (url + user + pass from a single precedence
  layer), so a URL from one layer never inherits credentials from another. The password value may
  be a secret reference: `env:<VAR>` reads an environment variable, `file:<path>` reads a file
  (one trailing newline trimmed); anything else is used literally. When no layer supplies a
  password, `BTCR2_BTC_RPC_PASS_FILE` (a path to a file holding the password) is the final
  fallback, read lazily only when an RPC config is actually built.
- **An RPC client is only wired when a host exists**: some layer supplies `--btc-rpc-url` (or its
  env/profile equivalent), or the network is `regtest` (which has a default RPC host). RPC
  credentials, wallet, or headers alone on a public network configure nothing. For most `resolve`
  runs no RPC is involved at all; beacon-signal discovery uses the REST endpoint in the default
  `indexer` mode (`fullnode` mode instead reads signals over the RPC client, and therefore
  requires one).
- **Header flags merge over profile headers** per key, with the flag winning. Headers apply even
  without a host override, so an authenticated Esplora/mempool endpoint works with the default
  host. A header value missing a `Key: Value` colon fails with `INVALID_ARGUMENT_ERROR`.
- **CAS endpoint selection**: a writable `--cas-rpc-url` takes precedence over the read-only
  gateway for retrieval. When only a CAS timeout is set, the default gateway is attached so the
  timeout is honored. (The `--cas-rpc-url` help text's mention of `--publish-to-cas` applies to
  `update`/`deactivate`; `resolve` only ever reads from the CAS.)
- **A malformed config file aborts the command** with `CONFIG_PARSE_ERROR` naming the file, and a
  config written by a newer CLI (higher `schemaVersion`) is refused with
  `CONFIG_SCHEMA_VERSION_ERROR`. A genuinely absent config file is fine (defaults apply).
- **Timeout validation**: `--btc-timeout` must be a finite number >= 1 (`0` would abort every
  request); `--cas-timeout` must be >= 0 (`0` disables the timeout). Violations fail with
  `INVALID_ARGUMENT_ERROR`.
- **Signal-discovery validation**: a `--btc-signal-discovery` value other than `indexer` or
  `fullnode` (from any layer, including a typo in `BTCR2_BTC_SIGNAL_DISCOVERY` or a profile)
  fails with `Invalid --btc-signal-discovery value "<value>". Expected indexer or fullnode.`
  (`INVALID_ARGUMENT_ERROR`). `fullnode` needs an RPC-capable connection: without one (any public
  network with no RPC configured) resolution fails with `signalDiscovery: 'fullnode' scans blocks
  over Bitcoin Core RPC, but no rpc config was resolved for network '<network>' ...`, a plain
  `Error` printed with its stack.
- **No keystore, passphrase, or session interaction.** `resolve` uses the keystore-free API
  factory: `--keystore`, `--passphrase-file`, and `--signing-key` are accepted globally but have
  no effect here, `<home>/session.json` is never read, and no prompt can occur. The profile's
  `identity.*` keys and the `btc.feeRate`/`btc.changeAddress` broadcast knobs (and
  `BTCR2_FEE_RATE`) are likewise not consulted.

## Global options

Shared global flags are documented in the [docs README](./README.md#global-options). `resolve` notably interacts
with: `-o, --output` (text vs json envelope), `--verbose` (full structured error output for
CLI-typed errors), the connection overrides (`--btc-rest`, `--btc-rpc-url`, `--btc-rpc-user`,
`--btc-rpc-wallet`, `--btc-rest-header`, `--btc-rpc-header`, `--btc-signal-discovery`,
`--btc-timeout`, `--cas-gateway`, `--cas-rpc-url`, `--cas-timeout`), and the state-location flags (`--home`,
`-c, --config`, `--profile`). `--quiet`, `--keystore`, `--passphrase-file`, and `--signing-key`
are accepted but have no effect on this command.

## Examples

```sh
# Zero-config resolution; the DID encodes mainnet ('bitcoin'), so https://mempool.space/api is used
btcr2 resolve -i did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47

# Same, via the alias
btcr2 read -i did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47

# JSON envelope output ({ "action": "resolve", "data": ... })
btcr2 -o json resolve -i did:btcr2:k1qqpyerymt5aaxm2jyh7za2594hgrq24uhqanxe5h94rf42flxkwhvmqd03t47

# Pin a specific document version
btcr2 resolve -i did:btcr2:k1qq... -r '{"versionId":"2"}'

# Resolve the document as it stood at a point in time (UTC, no sub-second precision)
btcr2 resolve -i did:btcr2:k1qq... -r '{"versionTime":"2026-07-01T00:00:00Z"}'

# External (x1) DID with sidecar data from a file
btcr2 resolve -i did:btcr2:x1qh... -p ./resolution-options.json

# Cap multi-round beacon discovery as a resource guard
btcr2 resolve -i did:btcr2:k1qq... -r '{"maxDiscoveryRounds":3}'

# Override the Bitcoin REST endpoint and bound request time
btcr2 --btc-rest 'https://mutinynet.com/api' --btc-timeout 15000 resolve -i did:btcr2:k1qq...

# Use a self-hosted IPFS gateway for CAS reads
btcr2 --cas-gateway 'http://127.0.0.1:8080' resolve -i did:btcr2:x1qh...
```

A `resolution-options.json` for an external DID whose updates are distributed via sidecar:

```json
{
  "sidecar": {
    "genesisDocument": { "id": "did:btcr2:x1qh...", "@context": ["..."] },
    "updates": [ { "patch": [ ... ], "proof": { ... }, "targetVersionId": 2 } ],
    "smtProofs": [ { "id": "...", "collapsed": "...", "hashes": [ "..." ] } ]
  }
}
```

## See also

- `btcr2 create`: mint the identifier that `resolve` reads back.
- `btcr2 update` / `btcr2 deactivate`: publish the updates that `resolve` discovers and applies.
- `btcr2 config effective` / `btcr2 config doctor`: inspect the resolved endpoints (with
  provenance) and probe their reachability for a given network.
- [README](./README.md): global flags, config file reference, and profile semantics.
- [DEMO.md](./DEMO.md): full create, fund, resolve, update, deactivate walkthrough on mutinynet.
