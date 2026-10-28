# @did-btcr2/api

High-level SDK facade for the did:btcr2 DID method. Wraps `@did-btcr2/method` and the surrounding crypto / bitcoin / key-management packages behind a single ergonomic entry point.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

The lower-level packages (`@did-btcr2/method`, `@did-btcr2/integrity`, `@did-btcr2/key-manager`, `@did-btcr2/bitcoin`) are designed to be composable and sans-I/O. This package is the thin layer above them: it owns Bitcoin endpoint configuration, CAS retrieval, key management, and the dispatch loop for the sans-I/O state machines.

If you're integrating did:btcr2 into an app, start here. If you're customizing the protocol, drop down to `@did-btcr2/method` directly.

- **`DidBtcr2Api`** is the main facade. Sub-facades for crypto, did, key manager, bitcoin, CAS, and the DID method itself; the bitcoin, CAS, and DID method facades initialize lazily on first access.
- **`createApi(config?)`** is the factory. Pass `btc`, `cas`, `kms`, and `logger` overrides.
- **`updateDid(source, patch, signer, options?)`** and **`deactivateDid(source, signer, options?)`** follow the update and deactivate operations of the specification. `source` is a DID or a resolved `SourceState`. `options.announce` holds the beacon, the beacon input signer, the fee, the change address, and the CAS policy.
- **`tryResolveDid(did)`** returns `{ ok: true, document, metadata }` or `{ ok: false, error, errorMessage, cause }` instead of a throw. `error` is the DID Resolution error code of the nearest typed failure in the cause chain. If no failure in the cause chain has a DID Resolution error code, `error` is `INTERNAL_ERROR`. `errorMessage` is the root cause. `cause` is the original error. `raw.didResolutionMetadata.error` is the error object of DID Resolution v1, section 10 (`ResolutionError`): `type` is the URL of the code, `title` is a short text, and `detail` is the root cause (ADR 157). Examples of `error`:
  - `NOT_FOUND`: an EXTERNAL DID whose genesis document is not in the sidecar and not in the CAS.
  - `INVALID_DID`: a DID that does not conform to the DID syntax, also the empty string and a value that is not a string. `METHOD_NOT_SUPPORTED`: a valid DID of another method, for example `did:example:a:b`.
  - `FEATURE_NOT_SUPPORTED`: a resolution option that the resolver does not support, or `expandRelativeUrls: true`. `INVALID_OPTIONS`: an option value that is not valid (see **The other resolution options** below).
  - `MISSING_UPDATE_DATA`: a signed update, a CAS announcement, or an SMT proof that the sidecar and the CAS do not supply.
  - `MISSING_UPDATE_DATA`: a CAS announcement value for the DID that is not a base64url SHA-256 hash.
  - `INVALID_DID_UPDATE`: an update with a `targetVersionId` that is not an integer.
- **`resolveDid(did)`** returns the `DidResolutionResult` of the api: `didDocument` is a `Btcr2DidDocument`. The type is not the `DidResolutionResult` of `@web5/dids`. `didResolutionMetadata.contentType` is `application/did`, the media type of a bare DID document. `didDocumentMetadata` always carries `versionId`, `confirmations`, and `deactivated`; `updated` is present if the resolved version is more than 1. `CasApi.retrieve` hashes the bytes that the CAS returns and refuses content that does not hash to the requested address, as the specification requires.
- **`updateDid` / `deactivateDid`** resolve a DID source for you. Pass `options.resolutionOptions` to hand sidecar data to that resolution. Omit `verificationMethodId` and `announce.beaconId`: the api derives them.
- **The source check of `updateDid` / `deactivateDid`.** For a DID source, the api refuses the update if the resolved `versionId` is less than the highest `targetVersionId` of the sidecar updates of the DID (the updates whose `proof.invocationTarget` is the DID). The resolution then cannot see all previous updates, and the specification forbids the announcement. Resolve again after the beacon signal of the last update has `minConf` confirmations, or set a lower `minConf`. Without sidecar updates, the api cannot do this check. A `SourceState` source skips it (ADR 135).
- **`announce.signer`** signs the beacon transaction input. It defaults to `signer`. Pass it if a key other than the verification method key controls the beacon address.
- **`api.kms.signer(id?)`** returns the `Signer` for a KMS key. The write path needs no second package.
- **`api.btcr2.getInitialDocument(did)`** and **`api.btcr2.getBeacons(document)`** give the beacon addresses to fund with no chain read. The `address` of a beacon is the address part of the BIP321 `bitcoin:` URI in its `serviceEndpoint`, with a bech32 address in lower case. `getBeacons` omits a beacon whose `serviceEndpoint` gives no Bitcoin address (ADR 161).
- **`api.btcr2.buildGenesisDocument(spec)`** builds the Genesis Document of an EXTERNAL (`x`) DID from public keys, relationships, beacons, and services, with no I/O. **`api.btcr2.createExternalFromDocument(document, { network })`** checks the document, hashes it as given, and returns `{ did, genesisBytes, didDocument }`. Keep the document: an EXTERNAL DID resolves only with it.
- **The checks of `createExternalFromDocument`.** If no `capabilityInvocation` method of the initial DID document can sign an update, `createExternalFromDocument` refuses the document with a `DidDocumentError` of type `INVALID_DID_DOCUMENT`. Nobody can update or deactivate such a DID. A document with `deactivated: true` passes (ADR 147). A document without a beacon service also passes, but nobody can announce an update for its DID. The `service` member can be absent. A verification method that does not sign updates must have a DID as its controller, and that controller can be another DID (ADRs 148 and 149). The document must conform to DID Core v1.1 with the rules of a producer (ADR 149). These rules also refuse four things that the resolver accepts: an item that occurs two times in a set, two methods or services with one `id`, a `secretKeyMultibase`, and a URL with a wrong syntax in `controller`, `alsoKnownAs`, a service `id`, or a `serviceEndpoint`. `buildGenesisDocument`, `constructUpdate`, `signUpdate`, and `update` apply the same rules to the document that they make. `api.did.validate` applies the rules of the resolver.
- **`api.btcr2.constructUpdate(source, patch)`** and **`api.btcr2.signUpdate(source, unsignedUpdate, verificationMethodId, signer)`** make a signed update with no I/O and no broadcast. They are the "Construct BTCR2 Unsigned Update" and "Construct BTCR2 Signed Update" steps of the specification. Use them for a test vector or an aggregate beacon. `signUpdate` returns a new object and adds no proof to `unsignedUpdate`.
- **The checks of `constructUpdate` / `signUpdate`.** Give the same `SourceState` to the two calls. `source.versionId` must be an integer of 1 or more. `signUpdate` refuses an unsigned update whose `targetVersionId` is not `source.versionId + 1`. It also refuses an update after which no `capabilityInvocation` method can sign an update (ADR 147). `constructUpdate` refuses a source document or a patch with no JCS form (RFC 8785), for example with NaN or a lone surrogate, with `INVALID_DID_UPDATE` (ADR 154). See [Update failures](#update-failures).
- **`api.btcr2.hashDocument(document)`** is the JSON Document Hashing of the specification (base64url, no padding). It refuses a document with no JCS form with a `CanonicalizationError`, for example a document that holds NaN or a lone surrogate. `data.path` gives the location of the value (ADR 154). **`api.btcr2.applyPatch(document, patch)`** gives the target document of a patch, with the rules of an update. A `remove` of the whole document (`''`) fails (ADR 155). **`api.btcr2.rootCapability(did)`** gives the root capability that an update proof invokes.
- **`api.btcr2.signMessage(document, message, signer, options?)`** signs a text message as an assertion of the DID, with no I/O (ADR 137). The result is `{ type: 'BTCR2Message', message, proof }` with a `bip340-jcs-2025` proof and the fixed proof purpose `assertionMethod`, so no message signature is valid as an update proof. **`api.btcr2.verifyMessage(document, signedMessage)`** runs the `structure`, `signer`, `active`, `assertionMethod`, and `signature` checks and returns a report. Pass the current document from a resolution: an old document accepts a key that a later update removed.
- **`api.smt.build(entries)`** builds the Sparse Merkle Tree of one SMT beacon signal and gives its root and the proof of each DID. **`api.smt.verify(proof, did)`** verifies an SMT proof.
- **`announce.feeRate`** sets a fixed fee rate of the beacon transaction in sats/vB. `announce.feeEstimator` takes your own `FeeEstimator`. Set one of the two, not both.
- **`api.crypto.keypair.fromPublicKey(bytes)`** makes a watch-only key pair for `api.kms.import`.
- **`api.crypto`** makes and verifies `bip340-jcs-2025` Data Integrity proofs, with the rules of the integrity README (ADR 158).
  - `crypto.cryptosuite.createFromKms(id, controller, keyId, kms)` signs through `kms.signer(keyId)`, so the secret key stays in the KMS. For a watch-only key, `createProof` fails with `KEY_NOT_SIGNER`.
  - `crypto.signDocument`, `crypto.proof.addProof`, and `crypto.proof.signDocument` return a copy of the document with the proof. They do not change their inputs. They refuse a document that has a `proof`, and options with a `previousProof`.
  - `crypto.verifyDocument` and `crypto.cryptosuite.verifyProof` return a `CryptosuiteVerificationResult`: `verified`, and the document without its proof (else `null`). A malformed proof gives a `CryptosuiteError`, not `verified: false`.
  - `crypto.proof.verifyProof(text, expectedPurpose?, mediaType?, expectedDomain?, expectedChallenge?)` returns a `VerificationResult`. A failed check, for example a purpose that does not match, gives `verified: false` and one `ProblemDetails` in `errors`. A signature that does not verify gives `verified: false` and an empty `errors` array. `expectedDomain` is one string or an array of strings.
- **`api.did.validate(did, { genesisBytes?, genesisDocument? })`** returns a conformance report of an identifier: the checks of the decoding algorithm in run order, `valid`, and the failed check with its detail. `genesisBytes` adds the check that the identifier encodes these bytes. It does not throw on an invalid identifier. `api.did.decode(did)` returns `DidComponents`, with the Bech32m `hrp`, and refuses an uppercase id and a custom network.
- **`minConf`** on `ResolutionOptions` sets the confirmations a beacon signal needs before resolution applies it. Default `6` (`DEFAULT_MIN_CONF`), the specification value. Pass `{ minConf: 1 }` to see a fresh update after one block. `updateDid` and `deactivateDid` inherit it through `options.resolutionOptions`.
- **`versionId`** and **`versionTime`** on `ResolutionOptions` select a version, as the specification defines them. The two options are mutually exclusive. `versionId` is an ASCII string of an integer. The versions start at `"1"`, the genesis document.
- **`versionTime`** is an XML Datetime in UTC without a fraction, for example `"2026-07-01T00:00:00Z"`. The result is the state before the first new version whose block `mediantime` is after `versionTime`. A `mediantime` equal to `versionTime` is not after it. If no new version is after `versionTime`, the result is the current version.
- **A historical request (ADR 145).** For a request with `versionId` or `versionTime`, the resolver processes the full history and returns the state at the requested version. Thus an error in a later update fails the request. The api also gets the data of each later update, from the sidecar or from the CAS. Each beacon signal at an SMT beacon needs its proof in `sidecar.smtProofs`, also a signal that announces no update for the DID. `maxDiscoveryRounds` counts the rounds of the full history.
- **The errors of `versionId` and `versionTime`.** A request with both, or with a value that does not parse, fails with `INVALID_OPTIONS`. A version that the history does not reach fails with `NOT_FOUND`. `tryResolveDid` reports both codes in `error`.
- **The other resolution options (ADR 157).** The resolver checks the options in the order of DID Resolution v1, section 4.4, before any data need. An option with the value `undefined` is absent.
  - An option name other than `accept`, `expandRelativeUrls`, `noCache`, `versionId`, `versionTime`, `minConf`, `sidecar`, and `maxDiscoveryRounds` fails with `FEATURE_NOT_SUPPORTED`.
  - `expandRelativeUrls: true` fails with `FEATURE_NOT_SUPPORTED`: the resolver returns each relative DID URL unchanged. `false` has no effect.
  - `accept` must be an Accept header value (RFC 9110, section 12.5.1), for example `'application/did'`. The value has no effect.
  - `noCache` must be `true`, `false`, `'true'`, or `'false'`. The resolver keeps no cache, so the value has no effect.
  - A `sidecar` that is not an object, or a `maxDiscoveryRounds` that is not a number, fails with `INVALID_OPTIONS`. Each other wrong value of the list also fails with `INVALID_OPTIONS`.

The api wires the configured `BitcoinApi` into the sans-I/O Resolver and Updater state machines, fulfilling `NeedBeaconSignals`, `NeedFunding`, `NeedBroadcast`, and CAS-related needs (`NeedGenesisDocument`, `NeedCASAnnouncement`, `NeedSignedUpdate`) automatically. How `NeedBeaconSignals` is fulfilled follows the connection's `btc.signalDiscovery` mode: `'indexer'` (the default) reads beacon-address transaction listings from the Esplora-compatible REST backend, while `'fullnode'` scans every block from genesis over Bitcoin Core RPC and needs an `rpc` config (the `BitcoinApi` constructor refuses `'fullnode'` without one), a node with `-txindex=1`, and Bitcoin Core >= 25; the linear scan makes it practical only on regtest.

`NeedSMTProof` is not auto-fulfilled by the facade: an SMT proof has no content address on chain (the signal is the tree root, and the proof of one DID is not derivable from it), so it must be provided upfront via `options.sidecar.smtProofs`; resolution fails with `MISSING_UPDATE_DATA` and that pointer otherwise. The resolver ignores a sidecar proof whose `id` does not decode to 32 bytes, for example an `id` with non-zero pad bits (ADR 146).

Multi-party aggregation is out of scope here. Make the signed update with `api.btcr2.constructUpdate` and `api.btcr2.signUpdate`, and give it to the aggregation participant of `@did-btcr2/aggregation` (`submitUpdate`). On the read path, a signal below `minConf` confirmations is excluded before any fetch: the api requests no update, announcement, or proof for it, and the resolved document does not show it until the transaction reaches the depth.

On the write path, `announce.publishToCas` (`'never'` | `'auto'` | `'always'`, default `'never'`) controls whether update artifacts are published to the configured CAS **before** the on-chain broadcast. CAS publication is optional and never required: every update, for every beacon type, completes and is distributable via sidecar regardless. Publishing is opt-in: pass `'auto'` (publishes when a writable CAS is configured, otherwise skips silently) or `'always'` (requires a writable CAS and throws up-front when none is available). Under both modes, a failed publication stops the update before the broadcast, and the beacon UTXO stays unspent. When publication happens, the canonical signed update (all beacon types) plus the CAS Announcement (CAS beacons) reach the CAS, so resolvers can fetch every OP_RETURN update hash from the CAS with no sidecar. Update calls return a `DidUpdateResult` carrying the signal `txid` and the per-beacon-type sidecar artifacts (announcement, SMT proof).

The write path refuses these inputs before any CAS publication or broadcast:

- an `announce.publishToCas` value other than `'never'`, `'auto'`, and `'always'`, for example `null` or `'Never'` (ADR 150)
- a deactivated source document (ADR 100)
- a DID whose network differs from the network of the Bitcoin connection (ADR 103)
- an update after which no `capabilityInvocation` method can sign an update, if the target document does not have `deactivated: true` (ADR 147)
- an `announce.beaconId` that names a service that is not a beacon, or a beacon whose `serviceEndpoint` gives no Bitcoin address (ADR 161)
- a beacon address that cannot fund the signal at the fee rate of the update: its confirmed UTXOs, each above the fee of its own input, do not cover the fee of the transaction (ADRs 102, 134)

The first five refusals run before the signature. Each refusal is an `UpdateError`. The `publishToCas` refusal has the type `INVALID_OPTIONS`, and each other refusal in the list has the type `INVALID_DID_UPDATE`. `resolve()` refuses the network mismatch too, with a `ResolveError`.

The api refuses an api option that is not valid with an `UpdateError` of type `INVALID_OPTIONS` (ADR 150). The specification makes `INVALID_DID_UPDATE` a refinement of `INVALID_DID_DOCUMENT`, which DID Resolution defines for a malformed DID document. DID Resolution defines `INVALID_OPTIONS` for options that are not valid. These refusals have the type `INVALID_OPTIONS`:

- an `announce.publishToCas` value other than the three modes
- `announce.publishToCas: 'always'` with no writable CAS
- both `announce.feeRate` and `announce.feeEstimator`
- an `announce.feeRate` that is not a positive finite number
- no Bitcoin connection: no `announce.bitcoin`, and no `BitcoinApi` on the `DidBtcr2Api` instance

The `BitcoinApi` constructor refuses these `btc` config values with a `MethodError` of type `INVALID_OPTIONS` (ADR 156):

- a `signalDiscovery` value other than `undefined`, `'indexer'`, and `'fullnode'`, for example `'Fullnode'` or `null`
- a `network` that is not a key of `DEFAULT_BITCOIN_NETWORK_CONFIG`, for example `'toString'`
- `signalDiscovery: 'fullnode'` with no `rpc` config for the network

`createApi` makes the `BitcoinApi` at the first access of `api.btc` or `api.btcr2`. Thus the refusal comes at that access. `tryResolveDid` reports it as the error `INVALID_OPTIONS`.

An error message holds a value of the caller only if the value is a primitive, for example a string or a number. For an object or a function, the message holds no value. The error `data` always holds the value (ADR 156).

## Install

```bash
npm install @did-btcr2/api
```

Or with pnpm:

```bash
pnpm add @did-btcr2/api
```

**Runtime note:** ESM-first package; a CJS build ships via the `require` export condition (some transitive deps are ESM-only, so `import` is the reliable path). Ships a browser bundle at `dist/browser.mjs` for bundler-based environments. Requires Node >= 22.

## Key Exports

The api is the one entry point of the implementation (ADR 132). It exports no class of a lower package as a value: each CRUD step is a function of a sub-facade. It exports each type that a public signature uses. `src/index.ts` lists the full surface.

| Concern | Entry point |
|---|---|
| Main facade | `DidBtcr2Api`, `createApi(config?)` |
| Sub-facades | `BitcoinApi`, `CasApi`, `CryptoApi` (`KeyPairApi`, `MultikeyApi`, `CryptosuiteApi`, `DataIntegrityProofApi`), `DidApi`, `DidMethodApi`, `KeyManagerApi`, `SmtApi` |
| Config | `ApiConfig`, `BitcoinApiConfig`, `SignalDiscoveryMode`, `CasConfig`, `Logger`, `HttpGatewayCasExecutor`, `IpfsRpcCasExecutor`, `BlockstoreCasExecutor` |
| Constants and presets | `DEFAULT_MIN_CONF`, `DEFAULT_CAS_GATEWAY`, `DEFAULT_CAS_TIMEOUT_MS`, `DEFAULT_BITCOIN_NETWORK_CONFIG`, `NETWORK_PRESETS`, `explorerTxUrl`, `explorerAddressUrl`, `faucetUrl`, the genesis constants |
| Errors | `DidMethodError` (the base class), `IdentifierError`, `DidDocumentError`, `MethodError`, `UpdateError`, `ResolveError`, `CanonicalizationError`, `CryptosuiteError` |
| Resolution | `ResolutionOptions`, `Sidecar`, `DidResolutionResult`, `ResolutionError` (the error object of a failed resolution), `ResolutionResult` (`tryResolveDid` return type) |
| Signers and keys | `Signer` (from `api.kms.signer(id)`), `KeyManager` (your own KMS for `createApi({ kms })`), `SchnorrKeyPair` |
| Write inputs | `UpdateSource`, `SourceState`, `UpdateOptions`, `DidUpdateOptions`, `AnnounceOptions`, `PublishToCasMode`, `PatchOperation` |
| Write results | `DidUpdateResult`, `BeaconInfo`, `UnsignedBTCR2Update`, `SignedBTCR2Update`, `RootCapability` |
| SMT | `SmtEntry`, `SmtTree`, `SMTProof` |
| Identifier validation | `DidComponents`, `IdentifierReport`, `IdentifierCheck`, `IdentifierCheckName`, `IdentifierValidateOptions` |
| Message signatures | `SignedMessage`, `SignMessageOptions`, `MessageReport`, `MessageCheck`, `MessageCheckName` |
| Data Integrity proofs | `DataIntegrityProofOptions`, `SecuredDocument`, `CryptosuiteVerificationResult`, `VerificationResult`, `ProblemDetails` |

## Quick Start

### Generate a DID and resolve it

```typescript
import { createApi } from '@did-btcr2/api';

const api = createApi({ btc: { network: 'mutinynet' } });

// Generate a keypair, derive the DID, import the secret into the in-process KMS.
// The DID inherits the network of the connection: mutinynet here.
const { did, keyId } = api.generateDid();

// Resolve. Bitcoin signals are fetched automatically via the configured BitcoinApi.
const resolution = await api.resolveDid(did);
console.log(resolution.didDocument?.id);
```

### Find the beacon address to fund, with no chain read

```typescript
// The initial document of a `k` DID is a pure function of its key. The beacon
// addresses are known before the DID touches the chain.
const beacons = api.btcr2.getBeacons(api.btcr2.getInitialDocument(did));
const beacon = beacons.find((b) => b.id.endsWith('#initialP2WPKH'))!;
console.log(beacon.address); // fund this address before the first update
```

### Build an EXTERNAL DID from a genesis document

```typescript
// One key with all four relationships, one P2WPKH Singleton beacon on mutinynet.
const genesisDocument = api.btcr2.buildGenesisDocument({
  network             : 'mutinynet',
  verificationMethods : [{ publicKey: kp.publicKey.compressed }],
});
// Hash exactly the bytes you keep or publish.
const json = JSON.stringify(genesisDocument, null, 2);
const { did, didDocument } = api.btcr2.createExternalFromDocument(JSON.parse(json), { network: 'mutinynet' });
const [beacon] = api.btcr2.getBeacons(didDocument);
console.log(did, beacon.address); // fund this address before the first update
// Later: api.resolveDid(did, { sidecar: { genesisDocument: JSON.parse(json) } })
```

A spec can name several keys with chosen relationships, a `CASBeacon` or `SMTBeacon` with the address of a cohort, and other services. The builder refuses a spec with no `capabilityInvocation` method or no beacon. `createExternalFromDocument` refuses a genesis document if no `capabilityInvocation` method of the initial DID document can sign an update. The error text is `Invalid genesis document: the DID document has no capabilityInvocation method that can sign an update. Nobody can update or deactivate the DID.`

### Update

The update arguments follow the update operation of the specification:

```typescript
// spec: update(sourceDidDocument, jsonPatch, targetVersionId, verificationMethodId, signer)
api.updateDid(source, patch, signer, options?)
// spec: deactivate(sourceDidDocument, targetVersionId, verificationMethodId, signer)
api.deactivateDid(source, signer, options?)
```

```typescript
// The source is the DID: the api resolves it and takes the document and its
// versionId from the resolution. The verification method is the one
// capabilityInvocation method that can sign an update and has the key of
// the signer. The beacon is the one funded beacon.
const { signedUpdate, txid } = await api.updateDid(
  did,
  [{ op: 'add', path: '/service/-', value: newService }],
  api.kms.signer(keyId),
);
```

If you resolved the DID already, pass the state as the source. The api then does not resolve. The `versionId` must come from the resolution that returned the document:

```typescript
const source = { document: currentDoc, versionId: 2 };
await api.updateDid(source, patch, signer, {
  // Ids are resolved against the document before matching, so a full DID URL
  // (`${did}#initialKey`) and a bare fragment (`#initialKey`) both work.
  verificationMethodId : `${did}#initialKey`,
  announce             : { beaconId: `${did}#initialP2WPKH` },
});
```

`api.btcr2.update(source, patch, signer, options?)` takes the same arguments, but the source must be a `SourceState`.

### Publish update artifacts to a CAS before broadcasting

```typescript
// A writable CAS (an IPFS node's RPC endpoint) makes updates resolvable
// without sidecar data: the signed update (and, for CAS beacons, the
// announcement) is published before the beacon transaction is broadcast.
const api = createApi({
  btc : { network: 'mutinynet' },
  cas : { rpcUrl: 'http://127.0.0.1:5001' },
});

const first = await api.updateDid(
  did,
  [{ op: 'add', path: '/service/-', value: newService }],
  api.kms.signer(keyId),
  // publishToCas defaults to 'never' (opt-in): update artifacts are returned
  // for sidecar distribution and nothing is published. Opt in with 'auto' to
  // publish to the writable CAS configured above. Note 'auto'/'always' publish
  // canonical signed updates to the configured (possibly public) CAS before the
  // on-chain anchor, so keep the 'never' default for sidecar-only privacy.
  { announce: { publishToCas: 'auto' } },
);
console.log(first.txid, first.publishedToCas); // e.g. { update: true, announcement: false }
```

### Resolve without throwing

```typescript
const result = await api.tryResolveDid(did);
if (result.ok) {
  console.log(result.document);
} else {
  console.warn(`resolve failed: ${result.error} - ${result.errorMessage}`);
  // result.cause holds the original error, for instanceof checks.
}
```

### Update a DID that already has updates, with the facade's signer

```typescript
// api.kms.signer(keyId) wraps the KMS key behind the Signer interface. It also
// works with an external KeyManager (HSM, cloud KMS) passed to createApi({ kms }).
const signer = api.kms.signer(keyId);

// A DID with prior updates resolves only with its sidecar. resolutionOptions
// hands the sidecar to the auto-resolution. The api derives the two ids.
// The signal of `first` must have minConf (default 6) confirmations. If not,
// the resolution cannot see `first`, and the api refuses the update.
const second = await api.updateDid(did, [{ op: 'add', path: '/service/-', value: newService }], signer, {
  resolutionOptions : { sidecar: { updates: [first.signedUpdate] } },
});
```

### Deactivate

```typescript
// Deactivation is permanent. It is an ordinary update that carries the
// deactivation patch. Pass the full update history in the sidecar.
const { txid } = await api.deactivateDid(did, signer, {
  resolutionOptions : { sidecar: { updates: [first.signedUpdate, second.signedUpdate] } },
});
```

A later `updateDid` on a deactivated DID is refused before any signature or broadcast. The patch is `DEACTIVATION_PATCH` of `@did-btcr2/method`; `DidMethodApi.DEACTIVATION_PATCH` is the same object.

### Update failures

Every update failure that the specification names is an `UpdateError` of type `INVALID_DID_UPDATE`. The refusals of the api in this section have the same type. A refusal of an api option has the type `INVALID_OPTIONS`, for example an `announce.publishToCas` value that is not valid (ADR 150). The method package applies the patch with the rules of RFC 6902 and RFC 6901 (ADR 155). The first operation that fails, a failed `test` included, fails the whole patch. Examples: a `remove` of a location that does not exist, and an array index with a leading zero.

The verification method that signs an update must agree with these conditions (ADR 147):

1. An entry of `capabilityInvocation` identifies the method. The entry is a reference to a member of `verificationMethod`, or the method as an embedded object. An embedded method signs like a referenced one, also if `verificationMethod` does not list it.
2. The `type` of the method is `Multikey`.
3. The `controller` of the method is the DID.
4. The `publicKeyMultibase` of the method is the BIP340 Multikey text of a secp256k1 public key. A `publicKeyMultibase` that only starts with `zQ3s` does not agree with this condition.

In this README, a method that agrees with these conditions is a method that "can sign an update". The key of the signer must be the key of the method. `verificationMethodId` is a DID URL under the DID, or a relative DID URL that starts with `#`.

| Failure | Error text |
|---|---|
| `verificationMethodId` is not a DID URL under the DID, and not a relative DID URL that starts with `#`. | `Invalid verificationMethodId: expected ...` |
| No entry of `capabilityInvocation` identifies the method. | `Invalid verificationMethodId: not authorized for capabilityInvocation` |
| The entry is a reference, and `verificationMethod` has no method with that id. | `Invalid verificationMethodId: not found in source document` |
| The method does not agree with condition 2, 3, or 4. `data.field` names the field. | `Invalid update: verificationMethod.type must equal "Multikey"`, and the same form for `controller` and `publicKeyMultibase` |
| The key of the signer is not the key of the method. | `Signing key does not match verification method "<id>": ...` |
| The public key of the signer is not a valid secp256k1 public key. | `Invalid signer: <message>` |
| The signer or its key manager fails, for example with a watch-only key. A signature that does not have 64 bytes also fails here. `data.cause` holds the type and the message of the inner error, for example `KEY_NOT_SIGNER` or `PROOF_GENERATION_ERROR`. | `Invalid update: cannot make the proof with "<id>": <message>` |
| The proof does not verify with the key of the method. | `Invalid update: the proof does not verify with the public key of "<id>"` |
| The patch fails to apply, or the patched document changes the `id` or does not conform to DID Core. | `Invalid patch: ...`, `Patches must not change the DID document id ...`, or `Error validating targetDocument: ...` |
| `source.versionId` is not an integer of 1 or more (`constructUpdate`, `signUpdate`). | `Invalid sourceVersionId: expected an integer of 1 or more.` |
| `targetVersionId` is not `source.versionId + 1` (`signUpdate`). | `Invalid update: targetVersionId is <n>, but the source has versionId <m>. Construct the update from this source.` |
| After the update, no `capabilityInvocation` method can sign an update, and the target document does not have `deactivated: true`. | `Invalid update: after this update, the DID document has no capabilityInvocation method that can sign an update. Nobody can update or deactivate <did> again.` |

Nobody can update or deactivate a DID after an update that leaves no method that can sign an update. Thus the api refuses such an update. `updateDid` and `api.btcr2.update` refuse it before the signature. A deactivation always passes, because its target document has `deactivated: true`. `signUpdate` signs first, so that each refusal of the method package names its own cause. Then it refuses such an update and returns no signed update.

The api does not refuse an update that leaves no beacon service, for example a patch that removes `/service` (ADR 148). A beacon of the source document announces this update. After the update, nobody can announce a later update for the DID.

Before the signature, the method package also checks that the unsigned update belongs to the source document. It refuses the update at the first check that fails. The checks run in this order:

1. `Invalid unsignedUpdate: expected an object.`
2. `Invalid unsignedUpdate: an unsigned update must not have a proof.`
3. `Invalid unsignedUpdate: targetVersionId must be an integer of 2 or more.`
4. `Invalid unsignedUpdate: @context must be the BTCR2 update context.`
5. `Invalid unsignedUpdate: sourceHash is not the hash of sourceDocument.`
6. `Invalid unsignedUpdate: the patch does not give a valid DID document from sourceDocument: <message>`
7. `Invalid unsignedUpdate: targetHash is not the hash of the document that the patch gives.`

If you make the unsigned update with `constructUpdate` from the same source, these checks pass.

## Architecture Principles

- **Lazy sub-facades.** `api.btc` / `api.cas` / `api.btcr2` instantiate on first access. Creating an api without a Bitcoin config and never touching the chain costs nothing.
- **Layered config.** Constructor config is applied first, then per-call overrides win. Bitcoin endpoint defaults come from this package's `DEFAULT_BITCOIN_NETWORK_CONFIG` (the sans-I/O `@did-btcr2/bitcoin` transport holds no service URLs).
- **CAS has a sensible default.** If no `cas` config is passed, `api.cas` defaults to a read-only HTTP gateway against the public IPFS Trustless Gateway `https://trustless-gateway.link`. A browser can read from it: it sends CORS headers. Configure `cas.rpcUrl`, `cas.blockstore`, or a custom `cas.executor` for write capability. For an IPFS node behind a reverse proxy with HTTP Basic auth, add `cas.rpcAuth: { username, password }`: `IpfsRpcCasExecutor` sends the credentials with each RPC request; `api.cas.writable` reports whether the configured backend accepts publishes (executors declare it via `CasExecutor.canPublish`; undefined means writable). `api.cas.probe()` checks that the backend answers a read: it reads a fixed identity block (no network retrieval, no write) through the optional `CasExecutor.probe`, and aborts at the CAS timeout. `btcr2 config doctor` uses it.
- **Driver injection.** `announce.bitcoin` is a per-call `BitcoinConnection` override for the announcement; the api uses its own connection automatically when none is provided. Resolution always reads the chain through the configured `BitcoinApi`.
- **The network is inherited, then enforced.** A new DID inherits the network of the configured connection, else `regtest`. The api never mints a mainnet DID by omission. `resolve()` and `update()` refuse a DID whose network differs from the network of the connection.
- **One source value.** `updateDid` and `deactivateDid` take a DID, which they resolve, or a `SourceState` `{ document, versionId }`. A document without its version cannot occur.

## Build & Test

```bash
# From packages/api/
pnpm build              # Compile ESM + CJS + browser bundle + type declarations
pnpm build:tests        # Compile tests to tests/compiled/
pnpm test               # Run the test suite with coverage
pnpm lint               # ESLint (zero warnings tolerated)
```

The `lib/` directory contains end-to-end scripts that exercise the full update path against regtest, mutinynet, signet, testnet3, and testnet4. Run with `bun packages/api/lib/e2e-*.ts` or `tsx`. On non-regtest networks the scripts persist generated secret keys to `lib/.e2e-keys/` (gitignored) so funds at beacon addresses can be recovered.

## Documentation

- **[docs/DEMO.md](./docs/DEMO.md)** Full-lifecycle walkthrough (create, resolve, update, deactivate on Mutinynet), with a runnable companion script at `lib/e2e-full-lifecycle.ts`
- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **[`docs/test-vectors.md`](./docs/test-vectors.md)** The test-vector pipeline for the did-btcr2-test-suite corpus, the test-network wallet, and the cross-implementation harness
- **[ADR-006](../../docs/adr/006-api-package-boundary.md)** API package boundary
- **[ADR-024](../../docs/adr/024-api-facade-lazy-and-layered-config.md)** API facade lazy initialization + layered config
- **[ADR-069](../../docs/adr/069-fetch-based-cas-executors-drop-helia.md)** Fetch-based CAS executors
- **[ADR-071](../../docs/adr/071-api-cas-publication-policy.md)** CAS publication policy on the update path (default corrected by ADR-073)
- **[ADR-073](../../docs/adr/073-cas-publication-is-opt-in.md)** CAS publication is opt-in: `publishToCas` defaults to `'never'` and `'auto'` skips the publication if no writable CAS is configured
- **[ADR-093 to ADR-104](../../docs/adr/index.md)** The api CRUD surface: network inheritance and the regtest fallback, `deactivateDid`, offline beacon addresses, the signer factory and the write-path re-exports, root causes, resolution options, the four write-path refusals, derived ids
- **[ADR-122](../../docs/adr/122-api-exports-vector-tool-steps-and-smt-rejects-empty-sibling-in-hashes.md)** The exports for a tool that builds specification examples or test vectors
- **[ADR-123](../../docs/adr/123-update-and-deactivate-follow-the-specification-signatures.md)** `updateDid` and `deactivateDid` follow the specification signatures
- **[ADR-135](../../docs/adr/135-an-update-is-refused-if-the-source-resolution-misses-an-update-of-the-sidecar-data.md)** An update is refused if the source resolution misses an update of the sidecar data
- **Source reference** See JSDoc on `DidBtcr2Api`, `DidMethodApi`, and the sub-facade classes.

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
