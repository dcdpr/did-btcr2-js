# @did-btcr2/cli

## 0.25.1

### Patch Changes

- The default config works in a browser with no proxy and no custom executor (ADR 124).

  - bitcoin: a GET request carries no `Content-Type`, so a browser sends no CORS preflight. `POST /tx` sends `text/plain` and the `RestConfig` headers, and the protocol ignores a `Content-Type` entry in `RestConfig.headers`. `HttpRequest` gets the optional field `fresh`, which `EsploraProtocol` sets on each endpoint whose response can change. The new export `createFetchExecutor({ timeoutMs? })` sends a fresh request with `cache: 'no-store'` and a random `_` query parameter. `defaultHttpExecutor` is `createFetchExecutor()`.
  - api: `BitcoinApi` uses `createFetchExecutor` for the default executor and for the `timeoutMs` executor. `DEFAULT_CAS_GATEWAY` is `https://trustless-gateway.link`, because `ipfs.io` redirects a raw-block read there with no CORS header.
  - cli: the docs and the config file example name the new default CAS gateway.
  - method, aggregation: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/api@0.28.1
  - @did-btcr2/method@0.66.3

## 0.25.0

### Minor Changes

- `updateDid` and `deactivateDid` follow the signatures of the specification (ADR 123).

  - api: `updateDid(source, patch, signer, options?)` and `deactivateDid(source, signer, options?)` replace the single objects with eleven and ten fields. `source` is a DID, which the api resolves, or a resolved `SourceState` `{ document, versionId }`. `options` holds `verificationMethodId`, `resolutionOptions`, and `announce`. `announce` holds `beaconId`, `signer` (the beacon input signer, the old `beaconSigner`), `feeEstimator`, `changeAddress`, `publishToCas`, and `bitcoin`. `DidMethodApi.update(source, patch, signer, options?)` and `DidMethodApi.deactivate(source, signer, options?)` take the same shape with a `SourceState`. New exported types: `SourceState`, `UpdateSource`, `UpdateOptions`, `DidUpdateOptions`, `AnnounceOptions`. Breaking: `UpdateBuilder` and `DidMethodApi.buildUpdate` are removed, and the half-supplied source pair refusal is replaced by the `SourceState` type.
  - cli: `UpdateCommandOptions` is `{ source, signer, options }`. `update` and `deactivate` refuse a `--source-document` whose `id` is not the identifier. No flag changes.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.28.0

## 0.24.8

### Patch Changes

- The REST client returns the block height as a number.

  - bitcoin: `BitcoinBlock.count()` converts the `text/plain` body of the Esplora tip height to a number. Before, it returned the body as a string, for example `'601'`. A body that is not a non-negative integer raises `BitcoinRestError`.
  - method, aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.66.2
  - @did-btcr2/api@0.27.2

## 0.24.7

### Patch Changes

- The api exports the steps of a vector tool, and the SMT verifier rejects an empty sibling in `hashes` (ADR 122).

  - smt: the result of `verifyZeroHash`, `verifyProof`, and `verifySerializedProof` is `false` if a `0` bit of `collapsed` selects an entry of `hashes` that is equal to the cached zero of its level. This follows specification pull request 370. `serializeProof` writes the properties in the order of the SMT Proof data structure: `id`, `nonce`, `updateId`, `collapsed`, `hashes`. No root or hash changes.
  - method: `DidDocument.fromKeyIdentifier` sets the document `id` to the DID and the verification method id to `<did>#initialKey`. Before, the constructor threw `INVALID_DID_DOCUMENT` for each input.
  - api: the package root exports `canonicalHash`, `JSONPatch`, and `Appendix`.
  - aggregation, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.66.1
  - @did-btcr2/api@0.27.1

## 0.24.6

### Patch Changes

- The SMT path follows the leaf values, the proof bit sequence, and the signal results of specification pull request 365 (ADR 120).

  - smt: `bitAt(i)` counts from the left, and `collapsed` follows the same sequence. `leafValue(nonce?, updateId?)` returns one of the four leaf values. `TreeEntry` is `{ did, nonce?, updateId? }`, with `updateId` the JSON Document Hash of the update. `verifyProof(proof, did)` verifies a serialized proof for a DID and returns `false` on a malformed proof. It never throws. `BTCR2MerkleTree.proof` returns an empty-index proof for a DID that is not in the tree. A nonce has any length. Breaking: every root and every proof changes. `TreeEntry.signedUpdate`, `inclusionLeafHash`, and `nonInclusionLeafHash` are gone.
  - common: the `INVALID_SIGNAL_DATA` error code.
  - method: the SMT beacon checks that the id of the proof is the signal root, verifies the proof with `verifyProof`, raises `INVALID_SIGNAL_DATA` on a failure, and produces no tuple for a proof without `updateId`. The resolver keeps `current_block_height` and drops a signal below it. `provide()` raises `INVALID_SIGNAL_DATA` for a signed update hash mismatch and for a malformed or mismatched SMT proof. It raises `MISSING_UPDATE_DATA` for a CAS announcement hash mismatch. Breaking: the error types of these failures change.
  - aggregation: the cohort builds its SMT entries with `updateId` and verifies the participant view with `verifyProof`.
  - api: a resolution that needs an SMT proof that the sidecar does not hold fails with a typed `ResolveError` of type `MISSING_UPDATE_DATA`. The vector build script adds SMT entries with `updateId`.
  - cli: documentation and dependency uptake.

- Updated dependencies []:
  - @did-btcr2/common@9.7.0
  - @did-btcr2/method@0.66.0
  - @did-btcr2/api@0.27.0

## 0.24.5

### Patch Changes

- The api takes a separate signer for the beacon transaction input (ADR 119).

  - api: `beaconSigner?: Signer` on `update`, `deactivate`, `updateDid`, `deactivateDid`, and `UpdateBuilder.beaconSigner()`. It signs the beacon transaction input and defaults to `signer`. A beacon at a key other than the DID key is now usable through the api.
  - cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/api@0.26.0

## 0.24.4

### Patch Changes

- The resolver keys the processed beacon signals by beacon address (ADR 118).

  - method: the processed set of BeaconProcess is keyed by beacon address, not by service id. A rotated beacon whose old address carried a signal now resolves past the rotation. `Identifier.encode` rejects a numeric-string network such as `'5'`, which the numeric enum read as a network name and minted as a mainnet identifier.
  - bitcoin: the REST client reads the status before it parses the body. A non-OK status raises `FAILED_HTTP_REQUEST` with the status, the URL, and the body. An OK status with a body that is not JSON raises `INVALID_HTTP_RESPONSE`.
  - aggregation, api, cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.65.1
  - @did-btcr2/api@0.25.2

## 0.24.3

### Patch Changes

- The resolver ignores the signals of a beacon address that an applied update removed from the DID document (ADR 114, specification pull request 367).

  - method: each update tuple carries the beacon address of its signal. Step 4 of "Process Next Update" ignores a tuple whose address the current document does not carry: the tuple stamps no metadata, enters no history, and does not reach the duplicate check. An update announced at the address that it removes still applies. Breaking: a history that announces a later version at a removed beacon address resolves to the last version that a kept address announced, and a `versionId` that only an ignored update reaches fails with `NOT_FOUND`. A conflicting re-announcement at a removed address is ignored; before, it raised `LATE_PUBLISHING`.
  - api: dependency uptake.
  - cli: dependency uptake.

- Updated dependencies []:
  - @did-btcr2/method@0.65.0
  - @did-btcr2/api@0.25.1

## 0.24.2

### Patch Changes

- The update paths check the proof fields and the proof time window, accept an embedded verification method, apply the JSON Patch strictly, and raise `INVALID_DID_UPDATE` (ADR 112).

  - common: `JSONPatch.apply` takes a `strict` option. With `strict: true`, an unknown `op`, a missing `value`, a `remove` or `replace` of a missing path, a `move` or `copy` from a missing path, and a failed `test` fail the patch at the first failing operation. The default does not change.
  - method: the resolver checks `type`, `cryptosuite`, `proofPurpose`, `capabilityAction`, and `capability` by string equality before it verifies the signature. Both paths locate the verification method through the `capabilityInvocation` entry, in the reference form or the embedded form. The resolver checks `created` and `expires` against the block of the Beacon Signal. Both paths apply the patch strictly and check the `id` and the DID Core conformance of the patched document. Every failure that the specification names is an `UpdateError` or a `ResolveError` of type `INVALID_DID_UPDATE`, with the inner error in `data.cause`. `Updater.sign` verifies the proof before the state machine asks for funding. `DidBtcr2.deactivate` and `DEACTIVATION_PATCH` are new. `capability` and `capabilityAction` are required in the proof types. `DidBtcr2.update` refuses a `sourceVersionId` that is not an integer of at least 1. Breaking: the write path raises `INVALID_DID_UPDATE` where it raised `INVALID_DID_DOCUMENT` for a method that is not authorized or not found.
  - api: `DidMethodApi.DEACTIVATION_PATCH` is the constant of the method package. The error type of an unauthorized or unknown verification method is `INVALID_DID_UPDATE`.
  - cli: documentation only.

- Updated dependencies []:
  - @did-btcr2/common@9.6.0
  - @did-btcr2/method@0.64.0
  - @did-btcr2/api@0.25.0

## 0.24.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.63.0
  - @did-btcr2/api@0.24.1

## 0.24.0

### Minor Changes

- Resolution reports the required DID document metadata (`confirmations`, `deactivated`; `contentType: application/did`) and the DID Resolution error codes (`INVALID_DID`, `NOT_FOUND`, `MISSING_UPDATE_DATA`, `INTERNAL_ERROR`); `CasApi.retrieve` checks the content hash (ADR 110).

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.5.0
  - @did-btcr2/method@0.62.0
  - @did-btcr2/api@0.24.0

## 0.23.2

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.61.0
  - @did-btcr2/api@0.23.1

## 0.23.1

### Patch Changes

- `btcr2 completion` builds the word list from the registered commands at run time, not from a constant. The list gains `init`, `quickstart`, `keystore`, and the built-in `help`, which the constant omitted.

## 0.23.0

### Minor Changes

- New `genesis` command group (ADR 108). `btcr2 genesis build` builds the genesis document of an external identifier, writes it to `--out` (default `genesis.json`; `--force` overwrites), and prints `{ did, network, genesisBytes, path, beacons }`. On a terminal the command asks for the keys, the relationships, the beacons, and the services; `--spec <path>` reads a JSON spec and asks nothing. `create -t x --document <path>` hashes a genesis document file and adds `genesisBytes` to the result. `resolve`, `update`, and `deactivate` gain `--genesis-document <path>`, which fills `sidecar.genesisDocument` and is refused for a `k` identifier. Breaking: the `create -t x` error message with no input names both `--document` and `--bytes`. The shell completion list gains `genesis`.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.23.0

## 0.22.0

### Minor Changes

- New `identifier` command group (ADR 107). `btcr2 identifier decode <did>` prints the identifier type, the hrp, the version, the network, and the genesis bytes as hex. `--initial-document` adds the initial DID document with no I/O; an external identifier needs `--genesis-document <path>` for it. `btcr2 identifier validate <did> [-b <hex>] [--genesis-document <path>]` prints the validation report and sets exit code 1 if the identifier is not valid; `-b` takes the genesis bytes of a `k` or an `x` identifier, the same value as `create -b`. Both subcommands are offline and keystore-free. The shell completion list gains `identifier`.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.22.0
  - @did-btcr2/method@0.60.0

## 0.21.0

### Minor Changes

- `update` and `deactivate` take `-i/--identifier <did>` and call the api's `updateDid` and `deactivateDid`. The api resolves the source document when `-s/--source-document` and `--source-version-id` are omitted; the pair stays available for offline use and must come whole. Both commands gain `-r/--resolution-options`, `--resolution-options-path`, and `--min-conf <n>` for that resolution; the three flags are refused together with the source pair. `-m/--verification-method-id` and `-b/--beacon-id` become optional overrides of the api's derivation, and `-b` takes a plain DID URL instead of a JSON string. `deactivate` no longer builds the deactivation patch; the api supplies it. Breaking: `-i` is required, `-b` no longer accepts JSON, and the `UpdateCommandOptions` type changes shape.

## 0.20.0

### Minor Changes

- `resolve` gains `--min-conf <n>`: the confirmations a beacon signal needs before resolution applies it. A positive integer; default `6`, the specification value. The flag overrides a `minConf` inside `-r`/`-p`. Breaking: a default `resolve` no longer shows an update with fewer than six confirmations; pass `--min-conf 1` to see a fresh update after one block.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.21.0
  - @did-btcr2/common@9.4.0
  - @did-btcr2/method@0.59.0

## 0.19.3

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.20.0

## 0.19.2

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.58.0
  - @did-btcr2/api@0.19.2

## 0.19.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.57.0
  - @did-btcr2/api@0.19.1

## 0.19.0

### Minor Changes

- Keep the Bitcoin RPC password off argv, and expose the beacon signal-discovery mode (ADR 087).

  - **BREAKING:** the `--btc-rpc-pass` flag and `GlobalOptions.btcRpcPass` are removed; passing the flag now fails parsing with `commander.unknownOption` and the command never runs. A password on argv is readable by any local user through `ps` and `/proc/<pid>/cmdline` while the process runs, and outlives it in shell history and CI logs. Supply it through `BTCR2_BTC_RPC_PASS`, a file named by `BTCR2_BTC_RPC_PASS_FILE`, or a profile `btc.rpcPass` holding a literal value or an `env:<VAR>` or `file:<path>` secret reference, matching the keystore passphrase, which is likewise never taken from a flag (ADR 077). Because the atomic credential unit binds url, user, and pass to one layer (ADR 074), a command-line `--btc-rpc-url` now takes its password from `BTCR2_BTC_RPC_PASS_FILE` and not from `BTCR2_BTC_RPC_PASS`.
  - **BREAKING:** `resolve` fails for a DID whose update proofs name a key outside the document's `capabilityInvocation`, following the read-path authorization check in `@did-btcr2/method` (ADR 088).
  - Added `--btc-signal-discovery <indexer|fullnode>`, `BTCR2_BTC_SIGNAL_DISCOVERY`, and `profiles.<name>.btc.signalDiscovery`: where beacon signals are read from. `fullnode` scans blocks over Bitcoin Core RPC and requires an RPC-capable connection. A bad value is rejected at the CLI with the same named-flag message from any precedence layer, rather than passed to the SDK.
  - `btcr2 config effective` reports the resolved `signalDiscovery` value, so a setting that changes resolution behaviour is visible to config introspection (ADRs 075, 078).
  - The command reference no longer suggests passing an `Authorization` header value on the command line: `--btc-rpc-header` and `--btc-rest-header` place whatever they carry on argv, with the same exposure as the removed password flag.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.19.0
  - @did-btcr2/common@9.3.0
  - @did-btcr2/method@0.56.0

## 0.18.1

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.18.0
  - @did-btcr2/common@9.2.0
  - @did-btcr2/method@0.55.0

## 0.18.0

### Minor Changes

- Add a `quickstart` command, fold the network into `init`, and print faucet/explorer links (ADRs 082, 083).

  - **`btcr2 quickstart`** collapses onboarding into one step: it composes `init` (home + config + keystore), records the network (default **mutinynet**), and optionally caches the session and probes endpoints. Flags: `-n/--network`, `--dev`, `--unlock` (opt-in session caching), `--ttl`, `--no-doctor`, `--allow-mainnet`, `--force`. Session caching stays opt-in so ADR 081's establish-vs-cache separation holds; on a fresh encrypted keystore `--unlock` reuses the establish-time passphrase with no second prompt. The endpoint probe runs by default but is advisory (a failed probe warns and still exits 0). Mainnet is guarded before any writes: `-n bitcoin` requires `--allow-mainnet`, and `-n bitcoin --dev` is refused.
  - **`btcr2 init` gains `-n/--network`**, recording `defaults.network` so later commands can drop `-n`; its output envelope gains a `network` field. The network write is idempotent and never clobbers a network the operator set earlier.
  - **Funding and watch links.** `create` on a testnet now prints the initial beacon address next to its faucet and explorer links; `update`/`deactivate` print a `Watch:` explorer link for the broadcast txid. These are text-mode stderr hints only, suppressed under `--quiet` and `--output json`, so machine output is unchanged.

  Breaking output surface: adds a `quickstart` result shape, a `network` field on `init` output, and new stderr hint lines. Machine (JSON) output shape is otherwise unchanged.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.17.0

## 0.17.0

### Minor Changes

- Add a session unlock agent so an encrypted keystore is authenticated once per session instead of on every command (ADR 081).

  - **`keystore unlock`** caches the verified passphrase in `<home>/session.json` (`0600`, TTL, bound to the keystore) so later commands do not re-prompt. `--ttl <duration>` sets the lifetime (bare seconds or an `s`/`m`/`h` suffix; default 1h, hard cap 24h; also `$BTCR2_KEYSTORE_TTL`).
  - **`keystore lock`** revokes the session; **`keystore status`** now reports whether a session is live and its remaining lifetime (a new `session` field on its output).
  - A cached session sits below `$BTCR2_KEYSTORE_PASSPHRASE` / `--passphrase-file` and above the interactive prompt, so unattended and CI paths still win and are never weakened by it. Establishment (the confirmed first passphrase, ADR 080) never consults the session, and the keystore verifier still checks every use, so a stale or forged cache can never seal a key under a divergent passphrase.
  - Mainnet keeps per-use authentication: `keystore unlock` refuses a `bitcoin` _default_ network unless `--allow-mainnet` is passed, and the session records that allowance so that at consumption a `bitcoin` operation (whose network is derived from the DID, not the config default) is withheld from a session lacking it and falls through to a per-use prompt, while other networks are still served. `change-passphrase`, `keystore init --force`, and `btcr2 init` (when it establishes a keystore) invalidate any cached session.
  - The cached passphrase is base64url-encoded, not encrypted: its only protection at rest is the `0600` file mode. This is a deliberate on-disk v1 for portability and a minimal diff; a future in-memory agent removes the on-disk persistence.

## 0.16.0

### Minor Changes

- Consolidate CLI state under one home directory and add a keystore lifecycle with a confirmed, verified passphrase and opt-in dev keystores (ADRs 079, 080).

  - **Single home directory (ADR 079, breaking default).** `config.json` and `keystore.json` now live side by side under one home: `~/.btcr2` on Linux/macOS, `%LOCALAPPDATA%\btcr2` on Windows, overridable with `--home` / `$BTCR2_HOME`. The old XDG config/data split is dropped outright (no migration path: re-run `btcr2 init` against the new home); `--config` / `--keystore` still override each file, so the split is reproducible explicitly. `btcr2 config path` now reports the home root.
  - **Confirmed, verified keystore passphrase (ADR 080).** The first passphrase is now established with a confirm prompt, and a keystore verifier makes every later use fail loudly (`Incorrect passphrase`) instead of sealing a key under an unknown or divergent passphrase, closing a key-loss bug where a first-key typo permanently sealed the keystore.
  - **`keystore` command group.** `keystore init` (encrypted by default, `--dev` for unencrypted), `keystore status`, and `keystore change-passphrase`.
  - **Opt-in dev keystores.** `--dev` establishes an unencrypted keystore (plaintext keys, no passphrase) for disposable testnet material; the CLI hard-refuses to sign or generate a mainnet (`bitcoin`) key with one.
  - **`btcr2 init`.** One-command setup that creates the home, a default config, and establishes the keystore (encrypted by default, `--dev` for testnet).

## 0.15.0

### Minor Changes

- User-configurable Bitcoin/CAS I/O with config correctness, validation, introspection, and secret handling (ADRs 074-078).

  - Config resolution correctness and safety: a malformed config now fails loudly instead of silently falling back to public endpoints or clobbering the file; a blank value at any precedence layer defers to the next layer; an empty `$XDG_CONFIG_HOME`/`$XDG_DATA_HOME` is treated as unset; the RPC url, user, and pass resolve as one atomic credential unit (a URL from a higher layer never inherits a lower layer's credentials); `config set` stores known scalar paths as strings; profiles gain an explicit `network` field and the two network resolvers are unified with a coherence warning; `defaults.output` is honored; `schemaVersion` is validated on read.
  - New Bitcoin/CAS I/O knobs, each with a `BTCR2_*` env var and a profile field: `--fee-rate`, `--change-address`, `--btc-timeout`, `--cas-timeout`, `--btc-rest-header`, `--btc-rpc-wallet`, `--btc-rpc-header`.
  - New introspection and validation: `config validate`, `config effective` (resolved values with per-value provenance), `config path`, and `config doctor` (endpoint reachability). `config set` rejects an invalid enum for a known key and warns on an unknown path.
  - Secret handling: `config get`/`list`/`effective` redact secret-looking values by default (`--show-secrets` reveals them); `rpcPass` accepts `env:<VAR>` and `file:<path>` secret references plus a `BTCR2_BTC_RPC_PASS_FILE` fallback.
  - Per-profile `identity.keystore` and `identity.default` are wired, below the `--keystore` / `--signing-key` flags.

  Printed output for `config get` and `config list` changes (secret values are now redacted by default), so this rides a minor bump.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.16.1
  - @did-btcr2/method@0.54.1

## 0.14.0

### Minor Changes

- Add writable-CAS configuration and an opt-in `--publish-to-cas` flag to `update`/`deactivate`.

  - New global `--cas-rpc-url <url>` flag, `BTCR2_CAS_RPC_URL` environment variable, and `profiles.<n>.cas.rpcUrl` config key configure a writable IPFS HTTP RPC endpoint (reads + writes). `resolveConnectionConfig` now carries `cas.rpcUrl` through the flag/env/config precedence chain; a previously silently-dropped `config set profiles.x.cas.rpcUrl` is now honored. When both a gateway and an RPC URL are set, the writable RPC endpoint takes precedence.
  - `update` and `deactivate` gain `--publish-to-cas <auto|always|never>`, validated at parse time and forwarded to the api's `publishToCas`. It **defaults to `never`**: CAS publication is optional and never required, so updates complete sidecar-only unless the user opts in. This replaces the hardcoded `'never'` from the previous release with no change to default behavior.

  See ADR 072.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.16.0

## 0.13.0

### Minor Changes

- **Breaking output change:** `update` and `deactivate` now print the api's enriched `DidUpdateResult` instead of the bare signed update. The old payload moves under `data.signedUpdate`; new fields are `data.txid`, `data.announcement` (CAS beacons), `data.proof` (SMT beacons), and `data.publishedToCas`. Note that `data.proof` changes meaning: it was the signed update's Data Integrity proof (now at `data.signedUpdate.proof`) and is now the optional SMT inclusion proof. Scripts parsing this output must be updated.

  The enriched output surfaces the artifacts required for manual sidecar distribution (txid, announcement, SMT proof). The cli passes `publishToCas: 'never'` explicitly (its CAS configuration is read-only gateway-only for now); a follow-up exposes writable-CAS configuration and a `--publish-to-cas` flag.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.15.0
  - @did-btcr2/method@0.54.0

## 0.12.18

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/api@0.14.0

## 0.12.17

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.53.0
  - @did-btcr2/api@0.13.12

## 0.12.16

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.52.0
  - @did-btcr2/api@0.13.11

## 0.12.15

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.51.0
  - @did-btcr2/api@0.13.10
