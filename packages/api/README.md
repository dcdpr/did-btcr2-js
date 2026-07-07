# @did-btcr2/api

High-level SDK facade for the did:btcr2 DID method. Wraps `@did-btcr2/method` and the surrounding crypto / bitcoin / key-management packages behind a single ergonomic entry point.

Part of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) monorepo.

## Summary

The lower-level packages (`@did-btcr2/method`, `@did-btcr2/cryptosuite`, `@did-btcr2/key-manager`, `@did-btcr2/bitcoin`) are designed to be composable and sans-I/O. This package is the thin layer above them: it owns Bitcoin endpoint configuration, CAS retrieval, key management, and the dispatch loop for the sans-I/O state machines.

If you're integrating did:btcr2 into an app, start here. If you're customizing the protocol, drop down to `@did-btcr2/method` directly.

- **`DidBtcr2Api`** is the main facade. Lazy sub-facades for crypto, did, key manager, bitcoin, CAS, and the DID method itself.
- **`createApi(config?)`** is the factory. Pass `btc`, `cas`, `kms`, and `logger` overrides.
- **`UpdateBuilder`** is a fluent chain over `DidMethodApi.update()` for callers who prefer named steps over a positional argument bag.
- **`tryResolveDid(did)`** returns a discriminated `{ ok, document } | { ok, error, errorMessage }` instead of throwing, for cases where resolution failure is an expected outcome.

The api wires the configured `BitcoinApi` into the sans-I/O Resolver and Updater state machines, fulfilling `NeedBeaconSignals`, `NeedFunding`, `NeedBroadcast`, and CAS-related needs (`NeedGenesisDocument`, `NeedCASAnnouncement`, `NeedSignedUpdate`) automatically. `NeedSMTProof` is not auto-fulfilled by the facade: SMT proofs are nonce-blinded (there is no content address to fetch them by), so they must be provided upfront via `options.sidecar.smtProofs`; resolution fails fast with that pointer otherwise. Multi-party aggregation is out of scope here; drive the Updater directly and hand `NeedBroadcast` to the aggregation runner from `@did-btcr2/aggregation`.

On the write path, `publishToCas` (`'auto'` | `'always'` | `'never'`, default `'auto'`) controls whether update artifacts are published to the configured CAS **before** the on-chain broadcast. With a writable CAS, `'auto'` publishes the canonical signed update (all beacon types) plus the CAS Announcement (CAS beacons), so resolvers can fetch every OP_RETURN update hash from the CAS with no sidecar. Update calls return a `DidUpdateResult` carrying the signal `txid` and the per-beacon-type sidecar artifacts (announcement, SMT proof) for callers that distribute them out-of-band instead.

## Install

```bash
npm install @did-btcr2/api
```

Or with pnpm:

```bash
pnpm add @did-btcr2/api
```

**Runtime note:** ESM-only package (requires `import`, not `require`). Ships a browser bundle at `dist/browser.mjs` for bundler-based environments. Requires Node >= 22.

## Key Exports

| Concern | Entry point |
|---|---|
| Main facade | `DidBtcr2Api`, `createApi(config?)` |
| Sub-facades | `BitcoinApi`, `CasApi`, `CryptoApi`, `DidApi`, `KeyManagerApi`, `DidMethodApi` |
| Fluent update | `UpdateBuilder` (from `api.btcr2.buildUpdate(...)`) |
| Config types | `ApiConfig`, `BitcoinApiConfig`, `CasConfig`, `Logger` |
| Resolution result | `ResolutionResult` (`tryResolveDid` return type) |
| Re-exports from method/common | `DidDocument`, `DidDocumentBuilder`, `Identifier`, `IdentifierTypes` |

## Quick Start

### Generate a DID and resolve it

```typescript
import { createApi } from '@did-btcr2/api';

const api = createApi({ btc: { network: 'mutinynet' } });

// Generate keypair, derive DID, import the secret into the in-process KMS.
const { did, keyId } = api.generateDid({ network: 'mutinynet' });

// Resolve. Bitcoin signals are fetched automatically via the configured BitcoinApi.
const resolution = await api.resolveDid(did);
console.log(resolution.didDocument?.id);
```

### Update via the fluent builder

```typescript
import { LocalSigner } from '@did-btcr2/keypair';

// Ids are matched exactly against the document: use full DID URLs
// (e.g. `${did}#initialKey`), not bare fragments.
const { signedUpdate, txid, announcement, publishedToCas } = await api.btcr2
  .buildUpdate(currentDoc)
  .patch({ op: 'add', path: '/service/-', value: newService })
  .version(2)
  .verificationMethodId(`${did}#initialKey`)
  .beacon(currentDoc.service[0].id)
  .signer(new LocalSigner(secretKey))
  .execute();
```

### Publish update artifacts to a CAS before broadcasting

```typescript
// A writable CAS (an IPFS node's RPC endpoint) makes updates resolvable
// without sidecar data: the signed update (and, for CAS beacons, the
// announcement) is published before the beacon transaction is broadcast.
const api = createApi({
  btc : { network: 'mutinynet' },
  cas : { rpcUrl: 'http://127.0.0.1:5001' },
});

const result = await api.updateDid({
  did,
  patches              : [{ op: 'add', path: '/service/-', value: newService }],
  verificationMethodId : `${did}#initialKey`,
  beaconId             : `${did}#initialP2WPKH`,
  signer,
  // publishToCas defaults to 'auto'. Use 'never' for sidecar-only privacy:
  // 'auto'/'always' publish canonical signed updates to the configured
  // (possibly public) CAS before the on-chain anchor.
});
console.log(result.txid, result.publishedToCas); // e.g. { update: true, announcement: false }
```

### Resolve without throwing

```typescript
const result = await api.tryResolveDid(did);
if (result.ok) {
  console.log(result.document);
} else {
  console.warn(`resolve failed: ${result.error} - ${result.errorMessage}`);
}
```

### Sign with a KMS-backed signer (HSM / cloud / external keystore)

```typescript
import { KeyManagerSigner } from '@did-btcr2/key-manager';

const signer = new KeyManagerSigner(api.kms.kms, keyId);

await api.updateDid({
  did,
  patches              : [{ op: 'add', path: '/service/-', value: newService }],
  verificationMethodId : `${did}#initialKey`,
  beaconId             : `${did}#initialP2WPKH`,
  signer,
});
```

## Architecture Principles

- **Lazy sub-facades.** `api.btc` / `api.cas` / `api.btcr2` instantiate on first access. Creating an api without a Bitcoin config and never touching the chain costs nothing.
- **Layered config.** Constructor config is applied first, then per-call overrides win. Bitcoin endpoint defaults come from `@did-btcr2/bitcoin`'s `DEFAULT_BITCOIN_NETWORK_CONFIG`.
- **CAS has a sensible default.** If no `cas` config is passed, `api.cas` defaults to a read-only HTTP gateway against `https://ipfs.io`. Configure `cas.rpcUrl`, `cas.blockstore`, or a custom `cas.executor` for write capability; `api.cas.writable` reports whether the configured backend accepts publishes (executors declare it via `CasExecutor.canPublish`; undefined means writable).
- **Driver injection.** `api.btcr2.resolve(did, options)` accepts an optional override; the api passes its own `BitcoinConnection` automatically when none is provided.

## Build & Test

```bash
# From packages/api/
pnpm build              # Compile ESM + browser bundle + type declarations
pnpm build:tests        # Compile tests to tests/compiled/
pnpm test               # Run the test suite with coverage
pnpm lint               # ESLint (zero warnings tolerated)
```

The `lib/` directory contains end-to-end scripts that exercise the full update path against regtest, mutinynet, signet, testnet3, and testnet4. Run with `bun packages/api/lib/e2e-*.ts` or `tsx`. On non-regtest networks the scripts persist generated secret keys to `lib/.e2e-keys/` (gitignored) so funds at beacon addresses can be recovered.

## Documentation

- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **[ADR-006](../../docs/adr/006-api-package-boundary.md)** API package boundary
- **[ADR-024](../../docs/adr/024-api-facade-lazy-and-layered-config.md)** API facade lazy initialization + layered config
- **[ADR-069](../../docs/adr/069-fetch-based-cas-executors-drop-helia.md)** Fetch-based CAS executors
- **[ADR-071](../../docs/adr/071-api-cas-publication-policy.md)** CAS publication policy on the update path
- **Source reference** See JSDoc on `DidBtcr2Api`, `DidMethodApi`, and the sub-facade classes.

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
