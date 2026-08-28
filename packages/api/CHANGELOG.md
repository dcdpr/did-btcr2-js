# @did-btcr2/api

## 0.20.0

### Minor Changes

- Complete the CRUD cycle on the api facade alone (ADRs 093 to 104).

  A caller now creates a DID, funds its beacon, updates the DID, deactivates it, and resolves it with this package only. Before this release, a caller needed the method and keypair packages for a `Signer` and for the beacon address, and `deactivateDid` threw `NotImplementedError`.

  Create:

  - `createDid`, `generateDid`, `DidMethodApi.createDeterministic`, and `DidMethodApi.createExternal` mint the DID for the network of the configured Bitcoin connection if the caller names no network. Without a connection, they mint for regtest (`DidMethodApi.FALLBACK_NETWORK`). They never mint for mainnet by omission. `BitcoinApi.network` and `DidMethodApi.defaultNetwork` expose the network in use.
  - `DidMethodApi.getInitialDocument(did, genesisDocument?)` derives the initial DID document offline. `DidMethodApi.getBeacons(document)` lists each beacon service with its Bitcoin address (new type `BeaconInfo`). A caller can fund a beacon before the first update with no connection.

  Read:

  - `resolveDid`, `tryResolveDid`, and `DidMethodApi.resolve` report the root cause of a failure. `resolveDid` and `DidMethodApi.resolve` throw `Failed to resolve DID <did>: <root cause>`. `tryResolveDid` sets `errorMessage` to the root cause, and the `ok: false` variant of `ResolutionResult` gains `cause`, the original thrown value. The new helper `rootCauseMessage(err)` follows a cause chain and reads the first sub-error of an `AggregateError`.
  - `resolveDid` and `DidMethodApi.resolve` refuse a DID whose network differs from the network of the Bitcoin connection (`ResolveError`). `tryResolveDid` returns `ok: false`, and the `ResolveError` is reachable through `cause`.

  Update and deactivate:

  - `deactivateDid` and `DidMethodApi.deactivate` are real operations. A deactivation is an update that carries `DidMethodApi.DEACTIVATION_PATCH`. The facade refuses a document that is already deactivated.
  - `updateDid` and `deactivateDid` accept `resolutionOptions`. The facade uses them if it resolves the source state itself. Supply sidecar data there if no CAS holds the prior updates.
  - `verificationMethodId` and `beaconId` are optional on `updateDid`, `deactivateDid`, `DidMethodApi.update`, and `DidMethodApi.deactivate`. The facade derives the verification method that publishes the signer's key. The facade derives the only beacon, else the one beacon that holds a spendable UTXO. If none or several candidates match, the facade throws an `UpdateError` of type `INVALID_DID_UPDATE` that names them.
  - Four new refusals, each an `UpdateError` of type `INVALID_DID_UPDATE`, each before any CAS publication and before the broadcast:
    - a source pair with only `sourceDocument` or only `sourceVersionId`, or a `sourceDocument.id` that is not the DID;
    - a deactivated source document;
    - a DID whose network differs from the network of the Bitcoin connection;
    - a beacon whose UTXOs are all unconfirmed, or all at or below the 546-sat dust limit. The funding guard applies `selectSpendableUtxo`, the rule of the beacon itself.

  Signers and exports:

  - `KeyManagerApi.signer(id?)` returns a `Signer` bound to the given key, else to the active key. `KeyManagerApi.activeKeyId` exposes the active key.
  - The package re-exports the write path and the signer types, so a CRUD cycle needs no second package: `LocalSigner`, `SchnorrKeyPair`, `KeyManagerSigner`, `LocalKeyManager`, `BitcoinConnection`, `DidBtcr2`, `Resolver`, `Updater`, `BeaconFactory`, `BeaconUtils`, and the types `Signer`, `SigningScheme`, `SignOptions`, `KmsSignOptions`, `KeyManager`, `KeyIdentifier`, `GenerateKeyOptions`, `ImportKeyOptions`, `VerifyOptions`, `BeaconService`, `BroadcastOptions`, `BroadcastResult`, `Btcr2DidDocument`, `CASAnnouncement`, `DidCreateOptions`, `IdentifierComponents`, `ResolutionOptions`, `Sidecar`, `SignedBTCR2Update`, `SMTProof`.

  Breaking:

  - The facade no longer mints a DID for mainnet if the caller names no network. `generateDid` with a Bitcoin connection mints for the network of the connection, not for regtest. Name the network to keep the old result.
  - In the four cases above, `updateDid` and `deactivateDid` throw where 0.19.x continued. `updateDid` no longer resolves the DID to complete a half-supplied source pair.
  - `DidMethodApi.deactivate` takes the update parameters and returns a `DidUpdateResult`. It threw `NotImplementedError` before.
  - The text of a resolution failure changed. The cli prints the new text on a `resolve` failure without `--verbose`.

## 0.19.2

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.58.0

## 0.19.1

### Patch Changes

- Accept relative DID URLs everywhere in a DID document, and take the DID a beacon serves by injection (ADR 091).

  DID Core permits a verification method or service `id`, and the entries of a verification
  relationship, to be a relative DID URL (`#initialKey`). This implementation only ever produced
  the absolute spelling and in three places required it, so a conformant document using the
  relative form did not resolve.

  - `SMTBeacon` and `CASBeacon` recovered the DID by slicing their own `service.id` on `#`, which
    yields the empty string for a relative id. The SMT beacon then indexed the tree at
    `didToIndex('')` and failed proof verification; the CAS beacon looked up `announcement['']`
    and **silently skipped the update**, completing resolution against a stale document.
    `SMTBeacon.broadcastSignal` had the same slice on the write path.
  - `DidBtcr2.getSigningMethod` compared verification method ids as raw strings, so an absolute
    `proof.verificationMethod` never matched a relative `verificationMethod[].id`.

  Beacons now take the DID they serve as a required constructor argument.
  `BeaconFactory.establish(service, did)` threads it, the `Resolver` supplies
  `currentDocument.id`, `Updater.announce(beaconService, did, ...)` takes it as a parameter, and
  `NeedBroadcast` carries a `did` field. Verification method lookup resolves both sides to
  absolute DID URLs first, via the new `Appendix.absoluteDidUrl`, which the read path's
  `capabilityInvocation` check now shares. Comparison is on the resolved URL rather than the
  fragment, so a reference naming a different DID still cannot match. The unused and misnamed
  `Appendix.extractDidFragment`, which returned its input unchanged, is removed.

  Breaking: the beacon constructors, `BeaconFactory.establish`, and `Updater.announce` each take
  one more required argument.

  `AggregationService` also rejected a relative `proof.verificationMethod` on the opt-in path
  when checking that a submission is signed by its sender's own key. That failed closed, so it
  was never a trust gap, but it turned away a legal spelling; the signing key is pinned by the
  opt-in record regardless, so the relative form now resolves to the sender.

  Together these let the danubetech `uni-resolver-driver-did-btcr2` examples 11a-b and 12a-b, two
  aggregate SMT cohorts on mutinynet, resolve to version 2.

- Updated dependencies []:
  - @did-btcr2/method@0.57.0

## 0.19.0

### Minor Changes

- Choose where beacon signals are read from on the Bitcoin connection.

  - Added `BitcoinApiConfig.signalDiscovery` (`'indexer' | 'fullnode'`, default `'indexer'`) and the `SignalDiscoveryMode` type, surfaced as the readonly `BitcoinApi.signalDiscovery`. `fullnode` scans every block from genesis over Bitcoin Core RPC instead of reading an Esplora index; it requires an `rpc` config (rejected at construction without one), a node with `-txindex=1`, and Bitcoin Core 25 or later for `getblock` verbosity 3, and the linear scan makes it practical only on regtest. Resolution reads the mode off the connection, not off the DID: which path reads the chain is a property of how this SDK talks to Bitcoin.
  - **BREAKING:** resolution inherits the `capabilityInvocation` authorization check from `@did-btcr2/method`, so a DID whose updates were signed by a key outside that relationship now resolves as an error rather than a document (ADR 088).
  - **BREAKING:** the re-exported `MultikeyObject` narrows with `@did-btcr2/cryptosuite`: its `keyPair` field carries public key material only.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.10.0
  - @did-btcr2/common@9.3.0
  - @did-btcr2/cryptosuite@10.0.0
  - @did-btcr2/method@0.56.0

## 0.18.0

### Minor Changes

- `DidMethodApi.deactivate()` now rejects with a `NotImplementedError` whose `name` and `type` are both `DID_API_METHOD_NOT_IMPLEMENTED` (ADR 085); previously `name` was `NOT_IMPLEMENTED_ERROR` while `type` was `DID_API_METHOD_NOT_IMPLEMENTED`. The error is also now `instanceof DidMethodError` via the reparented `NotImplementedError` in `@did-btcr2/common`.

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/common@9.2.0
  - @did-btcr2/method@0.55.0

## 0.17.0

### Minor Changes

- Add per-network presets: human-facing faucet and explorer metadata beside the endpoint config (ADR 082).

  - New `NETWORK_PRESETS` map (keyed by `NetworkName`) and the `NetworkPreset` type, carrying an optional `faucetUrl`, `explorerBaseUrl`, and `blockTimeHint` per network. mutinynet, signet, and the testnets get a faucet and explorer; regtest has neither; mainnet has an explorer but no faucet.
  - New pure helpers `explorerTxUrl(network, txid)`, `explorerAddressUrl(network, address)`, and `faucetUrl(network)`, each returning `undefined` for a network without the corresponding datum.
  - These are the single source of truth for the faucet/explorer/block-time data previously duplicated privately in the `lib/` e2e scripts, and are consumed by the CLI to print funding and watch links.

  Purely additive: no existing export changes.

## 0.16.1

### Patch Changes

- Remove the dead `allowDefaultWallet: true` from the exported `DEFAULT_BITCOIN_NETWORK_CONFIG.regtest.rpc` default, following ADR 078's removal of `RpcConfig.allowDefaultWallet` in `@did-btcr2/bitcoin`. The field was never consumed at the transport, so this is a behavior-neutral tidy of the exported config surface.

- Updated dependencies []:
  - @did-btcr2/bitcoin@0.9.0
  - @did-btcr2/method@0.54.1

## 0.16.0

### Minor Changes

- Make CAS publication opt-in: `publishToCas` now defaults to `'never'`, and `'auto'` no longer blocks an update.

  CAS publication is optional and never required: every update, for every beacon type, completes and is distributable via sidecar. The previous default of `'auto'` (from the prior release) was opt-out - it auto-published to any configured CAS and, for CAS beacons with no writable CAS, threw up-front - which effectively required CAS publication for that beacon type. This corrects that:

  - **Default is now `'never'`** on `DidMethodApi.update`, `DidBtcr2Api.updateDid`, and `UpdateBuilder`. Out of the box, nothing is published; a configured CAS never triggers publication on its own.
  - **`'auto'` is best-effort and never blocks:** it publishes when a writable CAS is configured, otherwise skips silently for every beacon type (CAS beacons included) and returns the artifacts for sidecar distribution. The CAS-beacon up-front throw is removed.
  - **`'always'` is unchanged:** it requires a writable CAS and throws up-front for every beacon type when none is available.

  Breaking for callers that relied on the implicit `'auto'` default: pass `publishToCas: 'auto'` explicitly to keep auto-publishing. See ADR 073 (supersedes ADR 071 §2).

## 0.15.0

### Minor Changes

- CAS publication policy on the update path, writable-CAS capability detection, and enriched update results (ADR 071).

  - `DidMethodApi.update`, `UpdateBuilder`, and `DidBtcr2Api.updateDid` gain `publishToCas: 'auto' | 'always' | 'never'` (default `'auto'`). Under `'auto'`/`'always'` with a writable CAS, the canonical signed update (all beacon types) and the CAS Announcement (CAS beacons) are published to the CAS **before** the on-chain broadcast, so any OP_RETURN update hash is fetchable from CAS at resolution time.
  - Policy guards fail fast, before signing: `'always'` throws when the CAS is read-only or absent; `'auto'` throws for CAS beacons in that case (a CAS-beacon signal whose announcement lands nowhere is unresolvable); set `'never'` for sidecar-only distribution. Singleton/SMT updates skip publication silently under `'auto'`.
  - **Privacy note:** `'auto'` publishes canonical signed updates to the configured (possibly public) CAS before anchoring. Privacy-conscious controllers should use `'never'` and distribute via sidecar.
  - `update()`/`updateDid()`/`UpdateBuilder.execute()` now return a `DidUpdateResult` (`{ signedUpdate, txid, announcement?, proof?, publishedToCas }`) instead of the bare `SignedBTCR2Update`; read `result.signedUpdate` for the old value.
  - `CasExecutor` gains optional `canPublish` (undefined means writable; `HttpGatewayCasExecutor` declares `false`); `CasApi` gains the `writable` getter.
  - `broadcastOptions` (fee estimator, change address) now pass through the api update path to the beacon transaction.
  - Fixed: `resolve()` no longer loops forever on an SMT beacon signal without a sidecar proof; it fails fast directing the caller to `options.sidecar.smtProofs` (SMT proofs are nonce-blinded and cannot be fetched from a CAS).

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.54.0

## 0.14.0

### Minor Changes

- Drop the `helia` production dependency in favor of fetch-based CAS executors (ADR 069). `BlockstoreCasExecutor` (structurally typed, accepts any in-process blockstore or blockstore provider, e.g. a Helia node) replaces `IpfsCasExecutor`; the new `IpfsRpcCasExecutor` publishes and retrieves raw blocks via the IPFS HTTP RPC API with local CID verification. `CasConfig` replaces `helia` with `blockstore` and adds `rpcUrl`; backend priority is `executor` > `blockstore` > `rpcUrl` > `gateway`. Consumers no longer install the libp2p subtree (436 lockfile packages removed).

## 0.13.12

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.53.0

## 0.13.11

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.52.0

## 0.13.10

### Patch Changes

- Updated dependencies []:
  - @did-btcr2/method@0.51.0
