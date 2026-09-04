# @did-btcr2/api

High-level SDK facade for the did:btcr2 DID method. Wraps `@did-btcr2/method` and the surrounding crypto / bitcoin / key-management packages behind a single ergonomic entry point.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

The lower-level packages (`@did-btcr2/method`, `@did-btcr2/cryptosuite`, `@did-btcr2/key-manager`, `@did-btcr2/bitcoin`) are designed to be composable and sans-I/O. This package is the thin layer above them: it owns Bitcoin endpoint configuration, CAS retrieval, key management, and the dispatch loop for the sans-I/O state machines.

If you're integrating did:btcr2 into an app, start here. If you're customizing the protocol, drop down to `@did-btcr2/method` directly.

- **`DidBtcr2Api`** is the main facade. Sub-facades for crypto, did, key manager, bitcoin, CAS, and the DID method itself; the bitcoin, CAS, and DID method facades initialize lazily on first access.
- **`createApi(config?)`** is the factory. Pass `btc`, `cas`, `kms`, and `logger` overrides.
- **`UpdateBuilder`** is a fluent chain over `DidMethodApi.update()` for callers who prefer named steps over a positional argument bag.
- **`tryResolveDid(did)`** returns `{ ok: true, document, metadata }` or `{ ok: false, error, errorMessage, cause }` instead of a throw. `errorMessage` is the root cause. `cause` is the original error.
- **`updateDid` / `deactivateDid`** resolve the source state for you. Pass `resolutionOptions` to hand sidecar data to that resolution. Omit `verificationMethodId` and `beaconId`: the api derives them.
- **`api.kms.signer(id?)`** returns the `Signer` for a KMS key. The write path needs no second package.
- **`api.btcr2.getInitialDocument(did)`** and **`api.btcr2.getBeacons(document)`** give the beacon addresses to fund with no chain read.
- **`minConf`** on `ResolutionOptions` sets the confirmations a beacon signal needs before resolution applies it. Default `6` (`DEFAULT_MIN_CONF`), the specification value. Pass `{ minConf: 1 }` to see a fresh update after one block. `updateDid` and `deactivateDid` inherit it through `resolutionOptions`.

The api wires the configured `BitcoinApi` into the sans-I/O Resolver and Updater state machines, fulfilling `NeedBeaconSignals`, `NeedFunding`, `NeedBroadcast`, and CAS-related needs (`NeedGenesisDocument`, `NeedCASAnnouncement`, `NeedSignedUpdate`) automatically. How `NeedBeaconSignals` is fulfilled follows the connection's `btc.signalDiscovery` mode: `'indexer'` (the default) reads beacon-address transaction listings from the Esplora-compatible REST backend, while `'fullnode'` scans every block from genesis over Bitcoin Core RPC and needs an `rpc` config (rejected at construction without one), a node with `-txindex=1`, and Bitcoin Core >= 25; the linear scan makes it practical only on regtest. `NeedSMTProof` is not auto-fulfilled by the facade: SMT proofs are nonce-blinded (there is no content address to fetch them by), so they must be provided upfront via `options.sidecar.smtProofs`; resolution fails fast with that pointer otherwise. Multi-party aggregation is out of scope here; drive the Updater directly and hand `NeedBroadcast` to the aggregation runner from `@did-btcr2/aggregation`. On the read path, a signal below `minConf` confirmations is excluded before any fetch: the api requests no update, announcement, or proof for it, and the resolved document does not show it until the transaction reaches the depth.

On the write path, `publishToCas` (`'never'` | `'auto'` | `'always'`, default `'never'`) controls whether update artifacts are published to the configured CAS **before** the on-chain broadcast. CAS publication is optional and never required: every update, for every beacon type, completes and is distributable via sidecar regardless. Publishing is opt-in: pass `'auto'` (best-effort - publishes when a writable CAS is configured, otherwise skips silently and never blocks the update) or `'always'` (requires a writable CAS and throws up-front when none is available). When publication happens, the canonical signed update (all beacon types) plus the CAS Announcement (CAS beacons) reach the CAS, so resolvers can fetch every OP_RETURN update hash from the CAS with no sidecar. Update calls return a `DidUpdateResult` carrying the signal `txid` and the per-beacon-type sidecar artifacts (announcement, SMT proof).

The write path refuses these inputs before any CAS publication or broadcast:

- a deactivated source document (ADR 100)
- a half-supplied source pair, or a `sourceDocument` whose `id` is not the DID (ADR 101)
- a DID whose network differs from the network of the Bitcoin connection (ADR 103)
- a beacon with no spendable UTXO, which is a confirmed UTXO above the dust limit (ADR 102)

The first three refusals run before the signature. Each refusal is an `UpdateError` with type `INVALID_DID_UPDATE`. `resolve()` refuses the network mismatch too, with a `ResolveError`.

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

| Concern | Entry point |
|---|---|
| Main facade | `DidBtcr2Api`, `createApi(config?)` |
| Sub-facades | `BitcoinApi`, `CasApi`, `CryptoApi`, `DidApi`, `KeyManagerApi`, `DidMethodApi` |
| Fluent update | `UpdateBuilder` (from `api.btcr2.buildUpdate(...)`) |
| Config types | `ApiConfig`, `BitcoinApiConfig`, `SignalDiscoveryMode`, `CasConfig`, `Logger` |
| Resolution result | `ResolutionResult` (`tryResolveDid` return type) |
| Signers | `Signer`, `LocalSigner`, `KeyManagerSigner`, `LocalKeyManager`, `KeyManager`, `SchnorrKeyPair` |
| Write results | `DidUpdateResult`, `BeaconInfo`, `PublishToCasMode` |
| Re-exports from method/common | `Btcr2DidDocument`, `DidDocument`, `DidDocumentBuilder`, `Identifier`, `IdentifierTypes`, `ResolutionOptions`, `Sidecar`, `PatchOperation` |

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

### Update via the fluent builder

```typescript
import { LocalSigner } from '@did-btcr2/api';

// Ids are resolved against the document before matching, so a full DID URL
// (`${did}#initialKey`) and a bare fragment (`#initialKey`) both work.
const { signedUpdate, txid, announcement, publishedToCas } = await api.btcr2
  .buildUpdate(currentDoc)
  .patch({ op: 'add', path: '/service/-', value: newService })
  .version(2)
  .verificationMethodId(`${did}#initialKey`)
  .beacon(currentDoc.service[0].id)
  .signer(new LocalSigner(secretKey))
  .execute();
```

The builder takes every id explicitly. `updateDid` derives `verificationMethodId` and `beaconId` if you omit them.

### Publish update artifacts to a CAS before broadcasting

```typescript
// A writable CAS (an IPFS node's RPC endpoint) makes updates resolvable
// without sidecar data: the signed update (and, for CAS beacons, the
// announcement) is published before the beacon transaction is broadcast.
const api = createApi({
  btc : { network: 'mutinynet' },
  cas : { rpcUrl: 'http://127.0.0.1:5001' },
});

const first = await api.updateDid({
  did,
  patches              : [{ op: 'add', path: '/service/-', value: newService }],
  // Both ids are optional. If you omit them, the api derives the verification
  // method from the signer's key and the beacon from the one funded beacon.
  verificationMethodId : `${did}#initialKey`,
  beaconId             : `${did}#initialP2WPKH`,
  signer               : api.kms.signer(keyId),
  // publishToCas defaults to 'never' (opt-in): update artifacts are returned
  // for sidecar distribution and nothing is published. Opt in with 'auto' to
  // publish to the writable CAS configured above. Note 'auto'/'always' publish
  // canonical signed updates to the configured (possibly public) CAS before the
  // on-chain anchor, so keep the 'never' default for sidecar-only privacy.
  publishToCas         : 'auto',
});
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
const second = await api.updateDid({
  did,
  patches           : [{ op: 'add', path: '/service/-', value: newService }],
  signer,
  resolutionOptions : { sidecar: { updates: [first.signedUpdate] } },
});
```

### Deactivate

```typescript
// Deactivation is permanent. It is an ordinary update that carries the
// deactivation patch. Pass the full update history in the sidecar.
const { txid } = await api.deactivateDid({
  did,
  signer,
  resolutionOptions : { sidecar: { updates: [first.signedUpdate, second.signedUpdate] } },
});
```

A later `updateDid` on a deactivated DID is refused before any signature or broadcast.

## Architecture Principles

- **Lazy sub-facades.** `api.btc` / `api.cas` / `api.btcr2` instantiate on first access. Creating an api without a Bitcoin config and never touching the chain costs nothing.
- **Layered config.** Constructor config is applied first, then per-call overrides win. Bitcoin endpoint defaults come from this package's `DEFAULT_BITCOIN_NETWORK_CONFIG` (the sans-I/O `@did-btcr2/bitcoin` transport holds no service URLs).
- **CAS has a sensible default.** If no `cas` config is passed, `api.cas` defaults to a read-only HTTP gateway against `https://ipfs.io`. Configure `cas.rpcUrl`, `cas.blockstore`, or a custom `cas.executor` for write capability; `api.cas.writable` reports whether the configured backend accepts publishes (executors declare it via `CasExecutor.canPublish`; undefined means writable).
- **Driver injection.** `api.btcr2.update(...)` (and `UpdateBuilder.bitcoin(...)`) accept a per-call `BitcoinConnection` override; the api uses its own connection automatically when none is provided. Resolution always reads the chain through the configured `BitcoinApi`.
- **The network is inherited, then enforced.** A new DID inherits the network of the configured connection, else `regtest`. The api never mints a mainnet DID by omission. `resolve()` and `update()` refuse a DID whose network differs from the network of the connection.
- **Source pair: both or neither.** `updateDid` and `deactivateDid` take `sourceDocument` and `sourceVersionId` together, or resolve both. A half pair is refused.

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

- **[DEMO.md](./DEMO.md)** Full-lifecycle walkthrough (create, resolve, update, deactivate on Mutinynet), with a runnable companion script at `lib/e2e-full-lifecycle.ts`
- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **[ADR-006](../../docs/adr/006-api-package-boundary.md)** API package boundary
- **[ADR-024](../../docs/adr/024-api-facade-lazy-and-layered-config.md)** API facade lazy initialization + layered config
- **[ADR-069](../../docs/adr/069-fetch-based-cas-executors-drop-helia.md)** Fetch-based CAS executors
- **[ADR-071](../../docs/adr/071-api-cas-publication-policy.md)** CAS publication policy on the update path (default corrected by ADR-073)
- **[ADR-073](../../docs/adr/073-cas-publication-is-opt-in.md)** CAS publication is opt-in: `publishToCas` defaults to `'never'` and `'auto'` never blocks
- **[ADR-093 to ADR-104](../../docs/adr/index.md)** The api CRUD surface: network inheritance and the regtest fallback, `deactivateDid`, offline beacon addresses, the signer factory and the write-path re-exports, root causes, resolution options, the four write-path refusals, derived ids
- **Source reference** See JSDoc on `DidBtcr2Api`, `DidMethodApi`, and the sub-facade classes.

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
