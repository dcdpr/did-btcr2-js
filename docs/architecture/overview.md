---
title: Architecture Overview
---

# Architecture Overview

`did-btcr2-js` is a 9-package pnpm workspace monorepo implementing the [`did:btcr2` DID method specification](https://dcdpr.github.io/did-btcr2/) in TypeScript. This page gives a high-level tour of the architecture; for the precise dependency graph between packages see the [Package Graph](package-graph.md).

## What `did:btcr2` is (in one paragraph)

`did:btcr2` is a censorship-resistant decentralized identifier method that uses the Bitcoin blockchain as a verifiable data registry. DIDs can be created offline (no Bitcoin transaction required) and updates are announced on-chain via small "beacon" transactions. The method supports three beacon types: **Singleton** (single-party, one address per DID), **CAS** (content-addressed store, batches multiple DID updates into a single Bitcoin tx by referencing an off-chain announcement), and **SMT** (Sparse Merkle Tree aggregation, multi-party signing). Resolution is private — the resolver fetches data from public sources but the controller's identity is not leaked.

## Design principles

The codebase is organized around a small number of architectural commitments. Understanding these is the fastest way to make sense of the code.

### 1. Sans-I/O state machines for protocol logic

The two most important components — the **Resolver** and the **Updater** — are written as **sans-I/O** state machines. They contain zero network calls, file reads, or system clock access. Instead, they emit typed `DataNeed` requests that the *caller* must fulfill, then resume processing once the data is provided.

This pattern (popularized by [Hynek Schlawack's "Sans-I/O" talk](https://sans-io.readthedocs.io/)) enables:

- **Trivial unit testing** — no mocks required; just call the state machine and provide canned responses to its `DataNeed` requests.
- **Pluggable I/O backends** — the same state machine works in Node, browsers, React Native, or workers, because the I/O is the caller's problem.
- **Deterministic resolution** — given the same inputs, the resolver always produces the same output. No hidden state.

The `Resolver` (`packages/method/src/core/resolver.ts`) is the canonical example. It progresses through five phases:

```
GenesisDocument → BeaconDiscovery → BeaconProcess → ApplyUpdates → Complete
```

At each step it may emit one of:

- `NeedGenesisDocument` — requires the genesis DID document (for EXTERNAL identifiers)
- `NeedBeaconSignals` — requires beacon transactions for a list of addresses
- `NeedCASAnnouncement` — requires a CAS announcement object by its hash
- `NeedSignedUpdate` — requires a signed update by its hash

The caller drives a loop:

```typescript
const resolver = DidBtcr2.resolve(did, options);
let state = resolver.resolve();
while (state.status === 'action-required') {
  for (const need of state.needs) {
    const data = await fetchData(need);  // caller's I/O
    resolver.provide(need, data);
  }
  state = resolver.resolve();
}
return state.result; // status === 'resolved'
```

### 2. Pure functional core, side-effects at the edges

Aside from the state machines, the rest of the code is divided into:

- **Pure modules** — functions that take inputs and return outputs with no side effects. Canonicalization, hashing, encoding, JSON patch, BIP-340 signature math, identifier encoding/decoding, document construction. These are heavily unit tested in isolation.
- **I/O drivers** — adapters that connect the pure core to real systems (Bitcoin REST/RPC clients, key managers, communication transports, CAS publishers). These are kept thin and well-bounded.

The boundary is intentional. Most contributor work happens in the pure modules; only a small surface area touches actual I/O.

### 3. Bitcoin connection abstraction

Rather than hard-coding a Bitcoin client, the `bitcoin` package provides a `BitcoinConnection` wrapper with **sans-I/O protocol layers** (`EsploraProtocol`, `JsonRpcProtocol`) that build request descriptors. A pluggable `HttpExecutor` interface handles the actual network calls. The default executor uses `fetch`, but consumers can supply their own (for example, a worker-based executor in a browser sandbox).

This means the `method` package can be tested against the Bitcoin protocols without ever making a real HTTP request — the protocol layer just produces request descriptors that the test harness inspects.

### 4. Three beacon types, one Beacon abstraction

All three beacon types — `SingletonBeacon`, `CASBeacon`, `SMTBeacon` — extend a single abstract `Beacon` class with a `processSignals()` method. They differ only in how they interpret signals and what data they need from the caller. The `Resolver` doesn't know which beacon type it's processing — it just calls `beacon.processSignals(signals)` and the beacon returns either applied updates or new `DataNeed` requests.

The `BeaconFactory.establish(service)` factory takes a `BeaconService` from a DID document and returns the correct typed beacon, parsed from a BIP21 Bitcoin URI (`bitcoin:<address>`).

### 5. Aggregation as a separate concern

Multi-party SMT beacon coordination (MuSig2 key aggregation, cohort message routing, signing sessions) is implemented as a **layered architecture**:

- **State machines** (`AggregationService`, `AggregationParticipant`) handle protocol logic with explicit action methods. Power users drop down to this layer for fine-grained control.
- **Runner facade** (`AggregationServiceRunner`, `AggregationParticipantRunner`) provides a higher-level event-driven API that wires state machines to a `Transport` and exposes decision callbacks. This is the default API for callers.
- **Transport adapters** (Nostr today; DIDComm stub) handle on-the-wire message delivery.

This is the standard **Facade + Strategy + Observer** pattern combination. The state-machine layer is sans-I/O; the runner layer is the convenient default; the transport layer is pluggable.

## Cross-cutting design choices

### Canonicalization is everywhere

Every place where we hash a DID document, an update payload, a CAS announcement, or a signature input, we use **JCS** (JSON Canonicalization Scheme, RFC 8785) followed by SHA-256. Encoding defaults to base64url. The implementation lives in `common/src/canonicalization.ts` as standalone functions: `canonicalize`, `hash`, `encode`, `decode`, `canonicalHash`.

The canonicalization step uses `JSON.parse(JSON.stringify(value))` round-tripping before JCS to normalize class instances with `toJSON()` methods (e.g., `Btcr2DidDocument`). This is intentional — it ensures that identical document content always produces identical hashes, regardless of which class instances were used to construct it.

### Hierarchical errors

All errors extend a single `MethodError` base class from `@did-btcr2/common`. Subtypes (`BeaconError`, `SingletonBeaconError`, `CASBeaconError`, `SMTBeaconError`, `KeyManagerError`, `CommunicationServiceError`, etc.) preserve the same shape: a message, a `type` discriminator, optional `data`. Consumers can pattern-match on `error.type` for specific handling, or just use the `instanceof` chain for broad categories.

### Verbatim type imports

Every type-only import in the codebase uses `import type { ... }` syntax. This is enforced by `verbatimModuleSyntax: true` in the shared tsconfig and by ESLint's `@typescript-eslint/consistent-type-imports` rule. The reason: it makes the ESM emit deterministic (no implicit type-elision) and ensures the codebase can be consumed by transpilers like esbuild and swc without runtime surprises.

### Browser compatibility

All packages except `bitcoin`, `kms`, and `cli` are **browser-compatible** at runtime. They have no Node-specific imports (`fs`, `path`, `process`, etc.) and use only universal APIs (`fetch`, `URL`, `crypto`, `TextEncoder`, `structuredClone`, all available in both Node 22+ and modern browsers). The `method` and `api` packages also ship pre-bundled browser builds via esbuild for use in environments that can't run a Node bundler.

`bitcoin`, `kms`, and `cli` are Node-only and explicitly declare `lib: ["ES2022"]` and `types: ["node"]` in their tsconfigs to enforce that constraint at compile time.

## What lives where

| Concern | Package |
|---|---|
| Types, errors, canonicalization, JSON patch, encoding utilities | `common` |
| Secp256k1 key pairs, BIP-340 Schnorr signatures, multikey | `keypair` |
| Data Integrity proof suite (`bip340-jcs-2025`) | `cryptosuite` |
| Bitcoin REST + RPC clients, sans-I/O protocol layers | `bitcoin` |
| Key management interface and default in-memory implementation | `kms` |
| Sparse Merkle Tree (proof generation + verification) | `smt` |
| Resolver, Updater, beacons, identifier encoding, DID document utilities | `method` |
| High-level SDK facade with sub-facades for crypto/did/kms/btc/method/cas | `api` |
| Commander-based CLI binary wrapping `api` | `cli` |

For the precise inter-package dependency arrows, see [Package Graph](package-graph.md).

## Where to read next

- [Package Graph](package-graph.md) — exact dependencies between packages
- [Build System](../contributing/build-system.md) — how the monorepo is compiled, tested, and published
- API Reference (sidebar) — auto-generated from each package's `src/index.ts`
