# @did-btcr2/method

TypeScript reference implementation of the [did:btcr2 DID Method](https://dcdpr.github.io/did-btcr2/) — a censorship-resistant Decentralized Identifier method using Bitcoin as a verifiable data registry.

This package is the core of the `did-btcr2-js` monorepo. It implements DID create/resolve/update operations, the three beacon types (Singleton, CAS, SMT), multi-party aggregation over MuSig2, and a pluggable transport layer for peer-to-peer coordination.

## Installation

```bash
pnpm add @did-btcr2/method
```

## What's in the Box

| Feature | Entry point |
|---|---|
| Create a DID (offline, deterministic or external) | `DidBtcr2.create()` |
| Resolve a DID (sans-I/O state machine) | `DidBtcr2.resolve()` |
| Construct, sign, and announce updates | `Update.construct()`, `Update.sign()`, `Update.announce()` |
| Beacon types (Singleton, CAS, SMT) | `SingletonBeacon`, `CASBeacon`, `SMTBeacon` |
| Fee estimation (pluggable) | `FeeEstimator`, `StaticFeeEstimator` |
| Multi-party aggregation (MuSig2) | `AggregationServiceRunner`, `AggregationParticipantRunner` |
| Transport abstraction (Nostr, DIDComm stub) | `Transport`, `NostrTransport` |
| DID document types and builders | `Btcr2DidDocument`, `DidDocumentBuilder` |

## Quick Start

### Create a DID

```typescript
import { DidBtcr2 } from '@did-btcr2/method';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

// Deterministic (k-type) — the identifier IS the public key
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

### Construct and Sign an Update

```typescript
import { Update, Resolver } from '@did-btcr2/method';

const doc = Resolver.deterministic({ genesisBytes: keys.publicKey.compressed, /* ... */ });
const unsigned = await Update.construct(doc, [
  { op: 'add', path: '/service/-', value: { /* new service */ } },
], 1);
const signed = Update.sign(did, unsigned, doc.verificationMethod![0], keys.raw.secret!);
```

### Update Aggregation (Multi-Party MuSig2)

Aggregation lets multiple DID controllers coordinate a single Bitcoin transaction that announces all of their updates at once, signed n-of-n with MuSig2. The high-level `Runner` API hides the message routing and decision plumbing:

```typescript
import { AggregationServiceRunner, NostrTransport } from '@did-btcr2/method';

const transport = new NostrTransport({ relays: ['wss://relay.damus.io'] });
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

The full step-by-step protocol walkthrough — service flow, participant flow, decision callbacks, events, the low-level state machine API, and production deployment notes — is in [`docs/aggregation.md`](./docs/aggregation.md).

## Architecture Principles

- **Sans-I/O core.** Resolver, Updater, and aggregation state machines perform zero I/O. They compute state transitions and emit typed needs or messages. Callers handle all network operations.
- **Layered APIs.** High-level facades (like `AggregationServiceRunner`) encapsulate boilerplate; low-level state machines stay available for tests, custom transports, and fine-grained control.
- **Pluggable transport.** The `Transport` interface decouples protocol logic from the wire format. Ships with `NostrTransport`; add your own for DIDComm, libp2p, or anything else.
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

- **Package docs on btcr2.dev** — [btcr2.dev/impls/ts](https://btcr2.dev/impls/ts)
- **[`docs/beacon-system-overview.md`](./docs/beacon-system-overview.md)** — Beacon architecture, Singleton / CAS / SMT behavior, signal discovery
- **[`docs/aggregation.md`](./docs/aggregation.md)** — Multi-party aggregation protocol, Runner and state machine APIs, e2e examples
- **[`docs/test-vectors.md`](./docs/test-vectors.md)** — CLI tool for generating did:btcr2 test vectors via a stepped workflow
- **Source reference** — See JSDoc comments on public classes; the most important entry points are `DidBtcr2` (facade), `Resolver` (read path), `Update` (write path), and the aggregation runners.
