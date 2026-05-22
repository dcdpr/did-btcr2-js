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

The api wires the configured `BitcoinApi` into the sans-I/O Resolver and Updater state machines, fulfilling `NeedBeaconSignals`, `NeedFunding`, `NeedBroadcast`, and CAS-related needs automatically. Multi-party aggregation is out of scope here; drive the Updater directly and hand `NeedBroadcast` to the aggregation runner from `@did-btcr2/method`.

## Install

```bash
npm install @did-btcr2/api
```

Or with pnpm:

```bash
pnpm add @did-btcr2/api
```

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

const signed = await api.btcr2
  .buildUpdate(currentDoc)
  .patch({ op: 'add', path: '/service/-', value: newService })
  .version(2)
  .verificationMethodId('#initialKey')
  .beacon('#beacon-0')
  .signer(new LocalSigner(secretKey))
  .execute();
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

const signer = new KeyManagerSigner(api.kms.backing, keyId);

await api.updateDid({
  did,
  patches              : [{ op: 'add', path: '/service/-', value: newService }],
  verificationMethodId : '#initialKey',
  beaconId             : '#beacon-0',
  signer,
});
```

## Architecture Principles

- **Lazy sub-facades.** `api.btc` / `api.cas` / `api.btcr2` instantiate on first access. Creating an api without a Bitcoin config and never touching the chain costs nothing.
- **Layered config.** Constructor config is applied first, then per-call overrides win. Bitcoin endpoint defaults come from `@did-btcr2/bitcoin`'s `DEFAULT_BITCOIN_NETWORK_CONFIG`.
- **CAS has a sensible default.** If no `cas` config is passed, `api.cas` defaults to a read-only HTTP gateway against `https://ipfs.io`. Override for write capability or an alternative gateway.
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
- **ADR-006** API package boundary
- **ADR-024** API facade lazy initialization + layered config
- **Source reference** See JSDoc on `DidBtcr2Api`, `DidMethodApi`, and the sub-facade classes.
