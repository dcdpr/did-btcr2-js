---
title: "ADR 002: Sans-I/O Resolver State Machine"
---

# ADR 002 — Sans-I/O Resolver State Machine

**Status:** Accepted
**Date:** 2026-03-25
**Branch / PR:** `refactor/resolve-session`

## Context

The original `DidBtcr2.resolve()` implementation was a monolithic async function that directly performed:

- Bitcoin REST calls to Esplora to fetch beacon signal transactions
- HTTP fetches to CAS (IPFS via Helia) to resolve announcement hashes
- Network-dependent control flow interleaved with spec-compliant resolution logic
- Tight coupling to Node.js I/O primitives (Helia, `fetch`, a specific Esplora URL)

This shape had several concrete problems:

1. **Untestable without mocks.** Every test had to stub Bitcoin clients, HTTP executors, IPFS nodes, and then assert against mock call sequences. The mocks tended to diverge from real behavior over time.

2. **Not browser-safe.** Helia imports dragged in libp2p and native modules that can't run in a browser. Consumers wanting to resolve DIDs in the browser had to reimplement resolution themselves.

3. **Not reproducible.** Given the same DID and the same on-chain data, the resolver's output depended on which CAS gateway happened to respond first, whether a connection timed out, and other non-deterministic network effects.

4. **Violated the sans-I/O spec model.** The `did:btcr2` spec itself is written as a deterministic algorithm that takes a DID and a bundle of already-fetched data (genesis doc, beacon signals, CAS announcements, updates) and produces a resolution result. The implementation was conflating "fetching data" with "applying the algorithm."

The refactor goal was to make `DidBtcr2.resolve()` return a **state machine** that the caller drives — one that embodies exactly the spec algorithm, with zero I/O.

## Decision

We rewrote `DidBtcr2.resolve()` to return a `Resolver` instance that contains a pure state machine. The state machine is a synchronous, iterative function that progresses through five phases:

```
GenesisDocument → BeaconDiscovery → BeaconProcess → ApplyUpdates → Complete
```

At each step, if the state machine needs data it doesn't have, it emits a typed `DataNeed` request and suspends. The caller reads the requests, fetches the data via whatever I/O mechanism they choose, and passes the results back via `resolver.provide(need, data)`. Then the caller calls `resolver.resolve()` again, which picks up where it left off.

The `DataNeed` discriminated union is:

- `NeedGenesisDocument` — for EXTERNAL identifiers, the state machine needs the genesis DID document that hashes to the identifier's 32-byte signature
- `NeedBeaconSignals` — the state machine needs all Bitcoin transactions at a specific set of beacon addresses
- `NeedCASAnnouncement` — the state machine needs the JSON CAS announcement identified by a canonical hash
- `NeedSignedUpdate` — the state machine needs a signed update identified by its canonical hash

The caller's loop looks like:

```typescript
const resolver = DidBtcr2.resolve(did, options);
let state = resolver.resolve();

while (state.status === 'action-required') {
  for (const need of state.needs) {
    const data = await fetchData(need);   // caller's I/O — could be HTTP, worker message, test fixture, anything
    resolver.provide(need, data);
  }
  state = resolver.resolve();
}

return state.result;  // state.status === 'resolved'
```

Three significant design choices inside the state machine:

1. **Multi-round beacon discovery.** After applying updates, the state machine loops back to `BeaconDiscovery` to find any new beacon services added by those updates. This is bounded by a future `maxDiscoveryRounds` safety cap (Track 5 5A in the roadmap).

2. **Sidecar data bundle.** The `ResolutionOptions.sidecar` field lets the caller pre-populate the state machine with data it already has (e.g., a signed update fetched out-of-band). The state machine checks the sidecar first before emitting a `DataNeed`, which means callers that already have the full data bundle never see any `DataNeed` requests at all.

3. **Structural equality for `provide()`.** The `provide()` method accepts a `DataNeed` and its corresponding data. To match needs across reads, the caller doesn't need to keep the exact `DataNeed` object reference — they just need to supply the same discriminant + identifier (e.g., the same `updateHash`). The state machine looks up pending needs by hash.

## Consequences

**Positive:**

- **Tests are trivial.** Every test is: construct a resolver, loop through its `DataNeed` requests, provide canned responses, assert on the final result. No mocks. No stubs. No async orchestration. See `packages/method/tests/resolver.spec.ts` for examples.

- **Browser-safe by design.** The state machine has no I/O imports. Browser consumers implement their own `fetchData(need)` function using browser-native `fetch`, a service worker, or whatever fits their app. Node consumers do the same with Node-native HTTP clients.

- **Reproducible.** Given the same DID, options, and sidecar data, the state machine produces the same result every time. No hidden network effects.

- **Spec-aligned.** The five-phase state machine maps directly onto the spec's resolution algorithm. A reviewer can check the code against the spec without untangling I/O.

- **Pluggable Bitcoin clients.** The state machine doesn't know about Esplora, Bitcoin Core RPC, or any specific client. Callers plug in whatever HTTP executor they want.

**Negative:**

- **API surface is more complex.** Callers have to write a driving loop. For the 90% case of "I just want to resolve this DID", that's extra boilerplate. The `api` package provides a `DidBtcr2Api.resolve()` convenience method that wraps the loop with a default HTTP-based I/O driver, so users of the high-level SDK don't have to write it themselves.

- **Debugging is more indirect.** When resolution fails, you have to inspect the state machine's phase and its last `DataNeed` to understand where it got stuck. Good error messages and a few well-placed logs mitigate this.

- **Sidecar shape is rigid.** The sidecar keys are fixed (`genesisDocument`, `updates`, `casMap`, `smtProofs`). Callers need to know the canonical hash format to populate them correctly.

## Alternatives considered

- **Callback-based I/O injection.** Keep `resolve()` async but take `{ fetchBeaconSignals, fetchCASAnnouncement, ... }` as parameters. Rejected because it's still async, still hard to test deterministically, and the call graph is still coupled to I/O ordering. Callers still have to keep their I/O logic synchronized with the state machine's internal flow.

- **Observable / event emitter pattern.** Emit events as the state machine progresses; callers subscribe and respond. Rejected because it leaks control-flow state into event ordering and introduces the same async-coupling problems as the callback approach.

- **Async generators.** Use `async function* resolve()` with `yield NeedGenesisDocument(...)` and `caller.next(data)`. Rejected because async generators aren't universally supported, debugging is harder than with explicit state, and the state machine benefits from being fully synchronous (it can be run inside a transaction, a worker, or any context that can't `await`).

## Verification

- `packages/method/tests/resolver.spec.ts` exercises the state machine directly with canned fixtures — 27 test cases covering deterministic and external identifier resolution, sidecar population, multi-round beacon discovery, and error paths.
- `DidBtcr2Api.resolve()` in the `api` package wraps the state machine with a default HTTP-based loop and is tested against real Bitcoin testnet data in `packages/api/tests/`.
- Browser bundle produced by esbuild for `@did-btcr2/method` is confirmed to be functional — no native module imports.

## Follow-ups

Tracked in the monorepo roadmap (Track 5 5A — Resolver Robustness):

- Cap resolver discovery rounds at 10 (`maxDiscoveryRounds` option) to prevent unbounded beacon discovery loops.
- Validate provided data matches the need's expected hash at `provide()` time.
- Add runtime type guards to `provide()` — validate data shape, not just TypeScript overloads.
- Mirror the same pattern for `Updater` (Track 3 — Sans-I/O Update Path).

## References

- [`docs/architecture/overview.md`](../architecture/overview.md) — broader architectural context
- [Sans-I/O design pattern (Hynek Schlawack)](https://sans-io.readthedocs.io/) — the general pattern this follows
- `packages/method/src/core/resolver.ts` — the state machine implementation
- `packages/method/src/did-btcr2.ts` — the `DidBtcr2.resolve()` factory
