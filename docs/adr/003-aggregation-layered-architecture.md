---
title: "ADR 003: Aggregation Layered Architecture"
---

# ADR 003 — Aggregation Layered Architecture (Facade + State Machine + Transport)

**Status:** Accepted
**Date:** 2026-04-06
**Branch / PR:** `beacon-system`

## Context

The aggregation subsystem in `@did-btcr2/method` implements multi-party SMT beacon coordination: a group of DID controllers agree on an aggregated MuSig2 public key (a taproot Bitcoin address), collect update announcements from their members, build a Sparse Merkle Tree root, and jointly sign a single Bitcoin transaction that anchors the root on-chain. This is the most complex protocol in the codebase — it involves identity management, message routing, key aggregation, nonce exchange, and threshold signing.

An earlier attempt put all of this behind a single `AggregationCoordinator` / `AggregationParticipant` API modeled after the `Resolver` state machine (see [ADR 002](002-sans-io-resolver.md)). The reasoning was "we already have a sans-I/O state machine pattern, so use it again." In practice this produced a terrible API:

- Resolution is a **request-response** problem (fetch data, return it). Aggregation is a **multi-party event-driven coordination** protocol. The two have different shapes.
- The `advance() / provide()` loop from the Resolver pattern doesn't map onto aggregation. Aggregation has long-lived peer connections, asynchronous incoming messages, decision points where the caller has to choose whether to accept a cohort member, and several cross-cutting concerns (signing session state, nonce bookkeeping, partial signature aggregation).
- Forcing aggregation into the `advance() / provide()` mold produced code that was verbose and unintuitive to use. The e2e demo scripts read like "call advance, fish out the right need, provide it, call advance, handle this other thing, provide that, call advance, repeat for 40 lines." Nobody would understand what the code was actually doing without reading the Resolver's source.
- Documenting the API was painful. Every example had to first explain the sans-I/O pattern, then the aggregation-specific needs, then the caller's obligation to route messages between peers. A new contributor would bounce off immediately.

The user feedback was: "matching the aggregation state machine to the resolver state machine EXACTLY one-for-one feels like the wrong engineering decision. I don't want to fall into the trap of 'everything is a nail because all I have is a hammer.'"

The rewrite goal was to keep the sans-I/O state machine for power users and correctness, but provide a much more intuitive default API that hides the boilerplate.

## Decision

We adopted a **three-layer architecture** for the aggregation subsystem:

### Layer 1 — Transport (pluggable)

The `Transport` interface abstracts on-the-wire message delivery between participants. It takes no keys in its constructor (pure passthrough), exposes `registerActor`, `registerPeer`, `registerMessageHandler`, and `sendMessage` methods, and is implemented by adapters like `NostrTransport` (NIP-44 encrypted Nostr events) and a stub `DIDCommTransport`. Multi-actor transports support multiple participants running in the same process (useful for tests and demos).

Keys and identities live **outside** the transport, in the wrapper classes (layer 2) that register them with the transport at startup.

### Layer 2 — State Machine (sans-I/O, explicit actions)

Two classes live here:

- `AggregationService` — the state machine for the service operator (the party running the aggregated beacon). It has explicit action methods: `createCohort()`, `advertise()`, `acceptParticipant()`, `finalizeKeygen()`, `buildAndDistribute()`, `startSigning()`, `sendAggregatedNonce()`, etc. It exposes state via getters: `pendingOptIns`, `collectedUpdates`, `validationProgress`, `getResult()`, `getCohortPhase()`, `getCohort()`, `cohorts`. It has a `receive()` method that dispatches an incoming message to the appropriate state update.

- `AggregationParticipant` — the state machine for an individual cohort member. Action methods: `joinCohort()`, `submitUpdate()`, `approveValidation()`, `rejectValidation()`, `approveNonce()`, `generatePartialSignature()`. State getters: `discoveredCohorts`, `joinedCohorts`, `pendingValidations`, `pendingSigningRequests`, `getCohortPhase()`.

Both classes are completely I/O-free. They hold in-memory protocol state and expose explicit actions. Power users who want fine-grained control can use these directly, the same way a user could drive the `Resolver` state machine by hand instead of using `DidBtcr2Api.resolve()`.

### Layer 3 — Runner facade (default API)

Two wrapper classes provide the high-level default API:

- `AggregationServiceRunner` — extends a custom `TypedEventEmitter` class. Takes a state machine, a transport, and a set of decision callbacks (`onProvideTxData`, `onOptInReceived`, `onReadyToFinalize`). Has a `run()` method that returns `Promise<AggregationResult>`. Emits events: `cohort-advertised`, `opt-in-received`, `participant-accepted`, `keygen-complete`, `update-received`, `data-distributed`, `validation-received`, `signing-started`, `nonce-received`, `signing-complete`, `error`.

- `AggregationParticipantRunner` — same pattern for the participant side. Long-running listener. Callbacks: `shouldJoin` (default rejects all), `onProvideUpdate` (required), `onValidateData`, `onApproveSigning`. Has `start()`, `stop()`, and a static `joinFirst()` convenience helper for tests and demos.

The runner is the **default** API — 90% of callers will use it. They wire up a transport, pass in a few decision callbacks for business logic, and call `run()` or `start()`. Everything else (state transitions, message routing, nonce exchange, signing protocol) is handled by the runner internally.

This is the standard **Facade + Strategy + Observer** pattern from the Gang of Four:

- **Facade** — the Runner hides the state machine + transport behind a simple unified interface
- **Strategy** — decision callbacks are injected behaviors the runner invokes at specific points
- **Observer** — the event emitter lets the caller subscribe to progress updates without polling

It's also the standard shape used by popular Node libraries for long-running protocol clients: `http.Server`, `nats.connect()`, `WebSocket`, `pg.Client`, `mqtt.connect()`, etc.

## Consequences

**Positive:**

- **Intuitive default API.** The e2e demo script went from ~200 lines of `advance()/provide()` noise to ~40 lines of event handlers and decision callbacks. A new contributor can understand what's happening on first read.

- **Power users have an escape hatch.** If a caller needs fine-grained control — inspecting intermediate state, manually driving transitions, implementing custom orchestration — they can bypass the runner and call the state machine directly. Nothing is hidden from them.

- **Tests are straightforward.** State machines can still be unit-tested in isolation (passing canned messages, asserting on getter state). Runners are integration-tested with a MockTransport that delivers messages between in-process actors.

- **Decoupled key management.** Transport adapters take no keys in their constructor. Keys live in the wrapper classes that use the transport. This means the same transport implementation can serve multiple actors in the same process, and rotating keys doesn't require reconstructing a transport.

- **Event emitter is minimal.** We wrote our own small `TypedEventEmitter` class (~80 lines) instead of pulling in a third-party dependency. It's fully typed per event, supports `on`, `once`, `off`, `emit`, `removeAllListeners`, and `listenerCount`. Browser-compatible.

- **Spec-aligned naming.** The subsystem was renamed from `BeaconCoordinator`/`BeaconParticipant`/`AggregateBeaconCohort` to `AggregationService`/`AggregationParticipant`/`AggregationCohort` to match the naming in the `did:btcr2` specification.

**Negative:**

- **Two layers to maintain.** State machine changes have to propagate through the runner. Most changes are additive (new event, new callback, new action method), but occasionally a refactor touches both layers.

- **Event ordering subtlety.** The runner fires events as the state machine transitions. Early iterations had a bug where `signing-complete` would fire before `keygen-complete` because the keygen-complete event was being emitted after an `await sendAll()` that the signing-complete promise chain raced past. Fixed by emitting events **before** awaiting `sendAll`. This is called out in the runner source with a comment; future contributors should be aware of the pattern.

- **Runner tests are harder than state machine tests.** Integration-testing the runner requires a fake transport that routes messages between in-process actors. We built a `MockTransport` class for this; tests that use it are in `packages/method/tests/aggregation.spec.ts`.

## Alternatives considered

- **Single-class API with async generators.** Use `async function* runAggregation()` that yields events and accepts commands via `next()`. Rejected because async generators are awkward to compose and debug, and the "resume with a value" semantics don't map cleanly onto multi-party protocols where multiple things can happen between yields.

- **Actor model (per-actor mailboxes).** Each participant is a literal actor with an inbox; the scheduler routes messages. Rejected because it adds a runtime dependency (actor framework) and the coordination logic is already captured well by the state machine.

- **Callback hell (no state machine).** Just let the caller wire up message handlers and track state themselves. Rejected because the protocol is non-trivial (MuSig2 key aggregation, nonce exchange, partial signature aggregation, signing session bookkeeping) — callers would reimplement the protocol incorrectly.

- **Force the Resolver pattern.** What we initially tried. Rejected for the reasons in the Context section.

## Verification

- `packages/method/tests/aggregation.spec.ts` — 3 runner test blocks covering full round-trip, `shouldJoin` defaults, and the `joinFirst` convenience helper. 48 passing tests in the aggregation section.
- `packages/method/lib/operations/aggregation/e2e-shared-transport.ts` — runnable end-to-end demo using the Runner API with inline MockTransport (single process, no relay required). Verified to produce a valid 64-byte Schnorr signature.
- `packages/method/lib/operations/aggregation/e2e-per-actor-transport.ts` — runnable demo using per-actor NostrTransport instances against a live Nostr relay.

## References

- [`docs/architecture/overview.md`](../architecture/overview.md) — where this fits in the broader architecture
- `packages/method/src/core/aggregation/service.ts` — `AggregationService` state machine
- `packages/method/src/core/aggregation/participant.ts` — `AggregationParticipant` state machine
- `packages/method/src/core/aggregation/runner/service-runner.ts` — service-side Runner facade
- `packages/method/src/core/aggregation/runner/participant-runner.ts` — participant-side Runner facade
- `packages/method/src/core/aggregation/runner/typed-emitter.ts` — typed event emitter base class
- Gang of Four — [Facade pattern](https://en.wikipedia.org/wiki/Facade_pattern), [Strategy pattern](https://en.wikipedia.org/wiki/Strategy_pattern), [Observer pattern](https://en.wikipedia.org/wiki/Observer_pattern)
