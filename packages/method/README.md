# @did-btcr2/method

TypeScript reference implementation of the [did:btcr2 DID Method](https://dcdpr.github.io/did-btcr2/): a censorship-resistant Decentralized Identifier method using Bitcoin as a verifiable data registry.

This package is the core of the `did-btcr2-js` monorepo. It implements DID create/resolve/update operations and the three beacon types (Singleton, CAS, SMT). Multi-party aggregation over MuSig2 and the pluggable peer-to-peer transport layer live in the companion [`@did-btcr2/aggregation`](https://github.com/dcdpr/did-btcr2-js/tree/main/packages/aggregation) package, which builds on this one.

## Installation

```bash
pnpm add @did-btcr2/method
```

## What's in the Box

| Feature | Entry point |
|---|---|
| Create a DID (offline, deterministic or external) | `DidBtcr2.create()` |
| Resolve a DID (sans-I/O state machine) | `DidBtcr2.resolve()` |
| Update a DID (sans-I/O state machine) | `DidBtcr2.update()` returns an `Updater` |
| Update utilities (construct, sign, announce) | `Updater.construct()`, `Updater.sign()`, `Updater.announce()` |
| Beacon types (Singleton, CAS, SMT) | `SingletonBeacon`, `CASBeacon`, `SMTBeacon` |
| Fee estimation (pluggable) | `FeeEstimator`, `StaticFeeEstimator` |
| Signer abstraction (local key, KMS, custom) | `Signer` / `LocalSigner` from `@did-btcr2/keypair`; `KeyManagerSigner` from `@did-btcr2/key-manager` |
| DID document types and builders | `Btcr2DidDocument`, `DidDocumentBuilder` |
| Multi-party aggregation (MuSig2) and transport | `@did-btcr2/aggregation` (separate package) |

## Quick Start

### Create a DID

```typescript
import { DidBtcr2 } from '@did-btcr2/method';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

// Deterministic (k-type): the identifier IS the public key
const keys = SchnorrKeyPair.generate();
const did = DidBtcr2.create(keys.publicKey.compressed, {
  idType  : 'KEY',
  network : 'mutinynet',
});
// did:btcr2:k1q5p...
```

### Resolve a DID

`DidBtcr2.resolve()` returns a sans-I/O state machine. The caller drives resolution by fulfilling typed data needs (beacon signals, CAS announcements, signed updates).

```typescript
import { DidBtcr2 } from '@did-btcr2/method';

const resolver = DidBtcr2.resolve(did, { sidecar });
let state = resolver.resolve();

while (state.status === 'action-required') {
  for (const need of state.needs) {
    const data = await fetchData(need);  // your I/O goes here
    resolver.provide(need, data);
  }
  state = resolver.resolve();
}

const { didDocument, metadata } = state.result;
```

See [`src/core/resolver.ts`](./src/core/resolver.ts) for the full `DataNeed` union and phase transitions.

Resolution processes a beacon signal only if its transaction has at least `minConf` confirmations. The default is `6` (`DEFAULT_MIN_CONF`), the value the specification mandates. A signal below the threshold is excluded as if it did not exist yet; the other signals are processed. Pass `{ minConf: 1 }` to see a fresh update after one block, at a higher exposure to a block reorganization. `metadata.confirmations` reports the depth of the last applied signal. A `minConf` that is not a positive integer fails with a `ResolveError` of type `INVALID_OPTIONS`. Indexer signal discovery skips a mempool transaction before the threshold applies.

The `metadata` of the result is the DID document metadata of the specification. `versionId`, `confirmations`, and `deactivated` are always present. `confirmations` is `0` and `versionId` is `"1"` when the resolver applied no update. `updated` is present after the resolver applies an update. `confirmations` and `updated` report the block of the last applied update; a duplicate re-announcement and a tuple that stops the resolution do not change them. An identifier that does not decode fails with an `IdentifierError` of type `INVALID_DID`, also when the Bech32m decoder rejects the body. A sidecar genesis document whose hash is not the genesis bytes of the identifier fails with a `ResolveError` of type `INVALID_DID`.

Two resolution options select a version. `versionId` is an ASCII string of an integer, for example `"2"`. The resolver stops before it applies the update that yields the next version, so `"1"` returns the genesis document also when updates exist. A version that the history does not reach, also a version after a deactivation, fails with a `ResolveError` of type `NOT_FOUND`. `versionTime` is an XML Datetime in UTC with the `Z` designator and no fraction, for example `"2026-07-01T00:00:00Z"`. The resolver applies each update whose block `mediantime` (median time past) is at or before that instant, and stops at the first update whose block `mediantime` is after it. Every conformant resolver reads the same `mediantime` from the block chain, so every resolver selects the same version. The two options are mutually exclusive. A request with both, or with a value that does not parse, fails with `INVALID_OPTIONS` before any data need.

The resolver processes one update per pass, as the specification describes. After each applied update it scans the beacon addresses that the document now carries and that it did not scan yet, then it continues with the next update. A `BeaconSignal` carries the block `height`, the header `time`, the `mediantime`, and the `confirmations` of its block. Both discovery paths fill `mediantime`: the indexer path reads the Esplora block record once per distinct block, the fullnode path reads the RPC block.

### Update a DID

`DidBtcr2.update()` returns a sans-I/O state machine: the counterpart to the Resolver. The caller drives the update by fulfilling typed data needs (signing key, funding confirmation, broadcast).

```typescript
import { DidBtcr2, Updater } from '@did-btcr2/method';
import { LocalSigner } from '@did-btcr2/keypair';
import { BitcoinConnection } from '@did-btcr2/bitcoin';

// Build a Signer from a raw secret key. For KMS-backed keys use KeyManagerSigner
// from '@did-btcr2/key-manager' instead.
const signer = new LocalSigner(secretKeyBytes);
const bitcoin = new BitcoinConnection({ network: 'mutinynet' });

// Ids are resolved against the source document before matching, so either the
// absolute DID URL (`${did}#initialKey`) or the relative one (`#initialKey`)
// works, whichever the document itself uses. Documents this package generates
// write the absolute spelling.
const updater = DidBtcr2.update({
  sourceDocument,
  patches              : [{ op: 'add', path: '/service/-', value: newService }],
  sourceVersionId      : 1,
  verificationMethodId : `${sourceDocument.id}#initialKey`,
  beaconId             : sourceDocument.service[0].id,
});

let state = updater.advance();
while (state.status === 'action-required') {
  for (const need of state.needs) {
    switch (need.kind) {
      case 'NeedSigningKey':
        updater.provide(need, signer);
        break;
      case 'NeedFunding':
        // Check UTXOs at need.beaconAddress, fund if needed
        updater.provide(need);
        break;
      case 'NeedBroadcast': {
        // Capture the BroadcastResult: broadcast.txid, plus broadcast.announcement
        // (CAS beacons) and broadcast.proof (SMT beacons; must be retained, the
        // proof's nonce exists nowhere else).
        const broadcast = await Updater.announce(
          need.beaconService, need.did, need.signedUpdate, signer, bitcoin
        );
        updater.provide(need);
        break;
      }
    }
  }
  state = updater.advance();
}

const { signedUpdate } = state.result;
```

See [`src/core/updater.ts`](./src/core/updater.ts) for the full `UpdaterDataNeed` union and phase transitions.

An update carries the `@context` array that the specification pins, in this order: `https://w3id.org/json-ld-patch/v1`, `https://w3id.org/zcap/v1`, `https://w3id.org/security/data-integrity/v2`, `https://btcr2.dev/context/v1`. `Updater.construct()` writes the array, and the proof of the signed update repeats it. The package exports the array as `BTCR2_UPDATE_CONTEXT`. The array is inside the hashed and signed bytes, so an update with a different array is a different update. The resolver rejects an update with a different array, or with a proof `@context` that differs from the update `@context`, with a `ResolveError` of type `INVALID_DID_UPDATE`.

### Update Aggregation (Multi-Party MuSig2)

Aggregation lets multiple DID controllers coordinate a single Bitcoin transaction that announces all of their updates at once, signed n-of-n with MuSig2. That subsystem now ships as its own package, [`@did-btcr2/aggregation`](https://github.com/dcdpr/did-btcr2-js/tree/main/packages/aggregation), which builds on this one. Its high-level `Runner` API hides the message routing and decision plumbing:

```typescript
import { AggregationServiceRunner } from '@did-btcr2/aggregation/service';
import { TransportFactory } from '@did-btcr2/aggregation';

// Pick a transport. Nostr (relay-based) or HTTP/REST (operator-hosted).
const transport = TransportFactory.establish({
  type   : 'nostr',
  relays : ['wss://relay.damus.io'],
});
// Or for HTTP: { type: 'http', role: 'server' } on the operator side,
//              { type: 'http', role: 'client', baseUrl: '...' } on the participant side.

transport.registerActor(serviceDid, serviceKeys);
transport.start();

const runner = new AggregationServiceRunner({
  transport,
  did    : serviceDid,
  keys   : serviceKeys,
  config : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },
  onProvideTxData: async ({ beaconAddress, signalBytes }) => buildBeaconTx(beaconAddress, signalBytes),
});

runner.on('signing-complete', (result) => console.log('done'));
const result = await runner.run();
```

The full step-by-step protocol walkthrough (service flow, participant flow, decision callbacks, events, the low-level state machine API, and production deployment notes) is in [`docs/aggregation.md`](./docs/aggregation.md). The HTTP/REST transport has its own walkthrough in [`docs/http-transport.md`](./docs/http-transport.md). See the [`@did-btcr2/aggregation`](https://github.com/dcdpr/did-btcr2-js/tree/main/packages/aggregation) package for the runnable APIs those guides describe.

## Architecture Principles

- **Sans-I/O core.** The Resolver (read path) and Updater (write path) state machines perform zero I/O. They compute state transitions and emit typed needs. Callers handle all network operations. The aggregation state machines in `@did-btcr2/aggregation` follow the same pattern.
- **Layered APIs.** High-level facades encapsulate boilerplate; low-level state machines stay available for tests, custom transports, and fine-grained control.
- **Pluggable transport.** The `@did-btcr2/aggregation` package decouples protocol logic from the wire format via a `Transport` interface, shipping Nostr (relay-based) and HTTP/REST (framework-agnostic, browser-compatible) adapters, plus a DIDComm stub. Add your own for libp2p or anything else.
- **Browser-compatible.** All code targets both Node.js (>= 22) and modern browsers. No Node-only APIs in the core.

## Build & Test

```bash
# From packages/method/
pnpm build              # Compile ESM + CJS + browser bundle
pnpm build:tests        # Compile tests to tests/compiled/
pnpm test               # Run the test suite with coverage
pnpm lint               # ESLint (zero warnings tolerated)
```

Tests run from compiled JS, so run `pnpm build:tests` before `pnpm test` after any test changes.

## Documentation

- **Package docs on btcr2.dev** [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **[`docs/beacon-system-overview.md`](./docs/beacon-system-overview.md)** Beacon architecture, Singleton / CAS / SMT behavior, signal discovery
- **[`docs/aggregation.md`](./docs/aggregation.md)** Multi-party aggregation protocol, Runner and state machine APIs, e2e examples (the runnable APIs live in `@did-btcr2/aggregation`)
- **[`docs/http-transport.md`](./docs/http-transport.md)** HTTP/REST transport: wire protocol, signed envelopes, SSE subscriptions, Hono/Node framework mount example, permissive CORS (shipped by `@did-btcr2/aggregation`)
- **[`docs/test-vectors.md`](./docs/test-vectors.md)** CLI tool for generating did:btcr2 test vectors via a stepped workflow, plus the cross-implementation harness that resolves another implementation's vectors through ours
- **Source reference** See JSDoc comments on public classes; the most important entry points are `DidBtcr2` (facade), `Resolver` (read path), and `Updater` (write path).

## License

[MPL-2.0](https://github.com/dcdpr/did-btcr2-js/blob/main/LICENSE)
