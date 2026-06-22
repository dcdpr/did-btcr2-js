---
title: "ADR 040: Multi-Cohort Aggregation Service Runner"
---

# ADR 040: Multi-Cohort Aggregation Service Runner

**Status:** Accepted

**Date:** 2026-06-22

**Branch / PR:** `feat/aggregation-multi-cohort`

**References:** [ADR 008](008-aggregation-subsystem-inception.md), [ADR 020](020-aggregation-layered-architecture.md), [ADR 027](027-aggregation-security-hardening.md), [ADR 038](038-musig2-key-custody.md), [ADR 039](039-cohort-condition-model.md)

## Context

The goal is **one Aggregation Service advertises many cohorts simultaneously, and a participant subscribes across several of them with per-cohort opt-in.** Today the high-level Runner facade drives exactly one cohort to completion and exits. This ADR records how multi-cohort is delivered and, just as importantly, where it is *not* needed.

**The state machines and transport are already N-cohort.**

- `AggregationService` keeps all per-cohort state in `#cohortStates: Map<string, ServiceCohortState>` (`service.ts:139`). `receive(message)` extracts `message.body.cohortId`, looks up that cohort's state, and dispatches to a per-cohort handler; every public action and getter is `cohortId`-parameterized (`createCohort`, `advertise`, `acceptParticipant`, `finalizeKeygen`, `buildAndDistribute`, `startSigning`, `sendAggregatedNonce`, `getResult`, `getCohortPhase`, `getCohort`, `removeCohort`, `drainRejections`).
- `AggregationParticipant` mirrors this with `#cohortStates: Map<string, ParticipantCohortState>` (`participant.ts:114`) and the same per-message demux.
- `AggregationCohort` is a pure per-instance data object; `phases.ts` is enums only.
- The transport routes by `(actorDid, messageType)` only (`transport.ts`); `cohortId` is a required field on every message body ([ADR 039](039-cohort-condition-model.md) wire format), so a single registered actor already multiplexes many cohorts. Demux is entirely a runner-layer concern.

**Every single-cohort assumption lives in `AggregationServiceRunner`.** The facade ([ADR 020](020-aggregation-layered-architecture.md) layer-3 runner) hard-wires one cohort through:

- a single `#cohortId?` field that handlers dereference as `this.#cohortId!` instead of reading `msg.body.cohortId` (`service-runner.ts:154` and ~20 use sites);
- one `#resolveRun` / `#rejectRun` promise pair that settles the whole runner on the first cohort's completion (`164-165`, resolved at `553`, rejected at `583`);
- `run()` creating exactly one cohort and never another (`214-240`);
- a single `#finalizing` opt-in-race guard (`163`);
- singular timers and phase tracking - `#cohortTtlTimer`, `#phaseTimer`, `#lastObservedPhase` (`166-168`) - so a stall in one cohort would fail the runner;
- a single `#stopAdvertRepeat` advert-republish handle (`170`);
- completion that unregisters the **shared** DID-scoped transport handlers (`551`), which would tear down delivery for any sibling cohort still in flight.

**The participant runner is already multi-subscription.** `AggregationParticipantRunner` holds no per-cohort fields, delegates to its session, and demuxes by `msg.body.cohortId` in every handler. Only the static convenience `joinFirst()` (`participant-runner.ts:180-200`) collapses it to one cohort via a single `once('cohort-complete')`. The structural capability is present; only a multi-join *entry point* is missing.

**Where this subsystem is headed** (the lens for the choices below):

- **A long-running service deployment:** a runnable service+participant demo over HTTP transport, then a web application. That is a **long-lived daemon**: an operator stands up one service and advertises cohorts continuously while participants come and go.
- **Extracting this subsystem into a standalone package:** the subsystem becomes `@did-btcr2/aggregation` with a stable, general public surface. The runner shape chosen here becomes that package's headline API.
- **Non-inclusion signaling and the [ADR 039](039-cohort-condition-model.md) conditions:** per-epoch opt-in, non-inclusion signaling (where cohorts persist across signing rounds), and the modeled timing/trigger conditions (`maxSecondsBetweenAnnouncements`, `pendingUpdateTrigger`) only make sense for a recurring service running cohorts across epochs.

The destination is a long-lived, multi-cohort service that gets extracted. In each decision below that pulls toward the more general and more consistent option, and the cost is modest because the state machines already support it: the runner facade is only being made to express generality that already exists underneath.

## Decision

Refactor `AggregationServiceRunner` into a **long-lived multiplexer** keyed by `cohortId`. The multi-cohort orchestration leaves the state machines and `transport/*` structurally unchanged; the only state-machine edit is one additive read accessor (point 6) that fixes a pre-existing participant-completion gap. Add a participant-side multi-join convenience so multi-cohort works end to end, and make every event carry a top-level `cohortId`.

1. **Per-cohort `RunContext`, stored in `#contexts: Map<string, RunContext>`.** Each advertised cohort owns its state: `cohortId`, its `CohortConfig`, the deferred `resolve` / `reject` and the `completion` promise handed back to the caller, a per-cohort `finalizing` guard, its own `ttlTimer` / `phaseTimer` / `lastObservedPhase`, its `stopAdvertRepeat` handle, and a `settled` flag so a late timer or trailing message cannot double-settle it. Every singular `#`-field enumerated in Context moves into this struct.

2. **`advertiseCohort(config): { cohortId; completion }` is the additive multi-cohort entry point.** It calls `session.createCohort(config)`, builds the `RunContext`, starts that context's timers, sends the advert (and its republish loop), and returns the cohort id plus a per-cohort completion promise. It is callable many times on one runner. Transport handler registration is a one-time, idempotent setup independent of any cohort (the handlers are already cohort-agnostic).

3. **Per-cohort completion is the load-bearing primitive; the runner is a long-lived multiplexer.** Each `RunContext.completion` resolves with that cohort's `AggregationResult` (which already carries `cohortId`) when its signing authorization lands, and rejects via a per-cohort failure path. A caller awaits one cohort via the returned `completion`. A thin `runAll(): Promise<AggregationResult[]>` convenience drains the **currently outstanding** contexts; its semantics are explicitly **dynamic** - new cohorts may be advertised between calls, and `runAll()` settles when the live set empties, not against a frozen snapshot. The runner is a persistent service, not a one-shot batch.

4. **Failure and teardown are per-cohort, never global-by-accident.** A TTL or phase-stall expiry calls `#failCohort(cohortId, err)`, which clears only that context's timers and advert loop, `removeCohort`s its state, rejects its `completion`, and emits `cohort-failed` with the `cohortId`. It does **not** touch sibling contexts and does **not** unregister the shared transport handlers. `stopCohort(cohortId)` is the deliberate single-cohort teardown; `stop()` becomes stop-all (iterate contexts, then unregister the shared handlers once). A separate runner-fatal path handles transport-level failures by failing all contexts. The runner reclaims its own per-cohort bookkeeping (timers, advert loop, `RunContext`) on **every** settle, but removes the cohort from the state machine (`session.removeCohort`) on **failure and stop only**: a successfully completed cohort is left in `session` so callers can still read its beaconAddress / cohort via `session.getCohort(result.cohortId)` and reclaim it explicitly when done.

5. **`run()` and `solo()` are preserved as thin wrappers.** `run(): Promise<AggregationResult>` becomes `advertiseCohort(constructorConfig).completion` - byte-for-byte behavior for the single-cohort case - so `AggregationRunner.solo()` and every existing `await runner.run()` call site keep working unchanged. The constructor's `config` becomes optional (required only for the `run()` convenience path; omit it when driving via `advertiseCohort`).

6. **Add a participant multi-join convenience now, and fix the completion sidecar.** `AggregationParticipantRunner` gains `joinMatching(options, count)` - the bounded N-cohort generalization of `joinFirst` - to deliver participant multi-subscription (one participant subscribing across several cohorts) and to write this change's end-to-end test (one service running two cohorts end to end, a participant joining both), which `joinFirst()` cannot express. Open-ended subscription is already the constructor + `shouldJoin` + `start()` path, so no never-resolving `joinAll()` is added; `joinFirst()` stays as the single-cohort convenience. Folded in: the participant's `cohort-complete` could not surface its sidecar (CAS Announcement map / SMT inclusion proof) because it read the phase-filtered `pendingValidations` (which lists only the `AwaitingValidation` phase) and so returned nothing once the cohort reached `Complete`. A small additive `AggregationParticipant.getValidation(cohortId)` accessor returns the retained validation regardless of phase, so the participant receives its sidecar at completion. This is the only state-machine touch and it is purely additive.

7. **Every event carries a top-level `cohortId`.** Add `cohortId` to the service events that structurally lack it (`participant-accepted`, `update-received`, `validation-received`, `signing-started`, `nonce-received`) and surface a top-level `cohortId` uniformly on the participant events whose id is currently only nested. This establishes one invariant - *every aggregation event payload identifies its cohort* - which a service-monitoring dashboard and the extracted package both rely on. The additions are receive-only fields (a listener reads a subset), so they are source-compatible for consumers.

8. **The multi-cohort orchestration requires no state-machine or transport changes.** Because `AggregationService` / `AggregationParticipant` already demux by `cohortId` and the transport already multiplexes per actor, the concurrency work is confined to the runner facade plus `events.ts`. The sole state-machine edit is the additive `getValidation` accessor in point 6 - a pre-existing participant-completion fix, not multi-cohort plumbing; `cohort.ts`, `phases.ts`, `signing-session.ts`, `messages/*`, and `transport/*` are untouched. Any *structural* change forced into the demux logic would signal a missed coupling and is out of scope.

### Lifecycle model considered

| Model | Long-term fit | Cost / risk |
| --- | --- | --- |
| **Multiplexer** - per-cohort `completion` + dynamic `runAll()` *(chosen)* | Matches the long-lived service daemon and cohorts persisting across signing rounds directly; the extracted API is the general one | Runner is stateful: must reclaim each `RunContext` on settle and must not unregister shared transport handlers until `stop()`; `runAll()` needs an explicit drain contract |
| **One-shot batch** - `runAll()` over a frozen set, no advertising after | Simplest for a single script | Dead end for the daemon: cannot advertise after `runAll()`, forcing a second refactor once the service deployment lands - the churn is paid twice |
| **Per-cohort only** - no aggregate method | Cleanest primitive, maximally composable | Every caller (CLI, demo, tests) re-hand-rolls "wait for this batch," repeatedly |

"Batch vs long-lived" and "ship `runAll()` or not" are nearly orthogonal: even the per-cohort-only option is long-lived. The load-bearing primitive in all three is the per-cohort `completion` promise; `runAll()` is only a convenience on top of it. The chosen model is the multiplexer built on that primitive.

### Rejected alternatives

- **One-shot batch runner.** Rejected because the project's destination is a long-lived service daemon. A batch contract cannot advertise after `runAll()` and would be re-written within this same line of work. The simple "advertise N, await once" case is preserved as a usage pattern on the multiplexer, not a separate contract.
- **Per-cohort completion only, no `runAll()`.** The minimal surface, but it pushes the same "wait for all" composition into every consumer. `runAll()` is a small, clearly-scoped convenience that pays for itself in the CLI and demos; per-cohort `completion` remains the primitive beneath it.
- **Defer the participant multi-join to later work.** Rejected because this effort already scopes participant multi-subscription (one participant subscribing across several cohorts), the helper is thin (the runner is already multi-capable), and the flagship end-to-end test cannot be written without it. Splitting it out would orphan ~20 lines plus the integration test that belongs here, which fragments one coherent deliverable rather than focusing it.
- **Minimal event enrichment (service-side only).** Rejected in favor of uniform `cohortId` because a split model - some events top-level, others nested - is a permanent papercut for the extracted package and a service-monitoring dashboard. Since the participant runner is already being edited for the multi-join helper, uniform enrichment is marginal additional cost.
- **Change the state machines to "support" multi-cohort.** Unnecessary and rejected: `AggregationService` / `AggregationParticipant` already key state by `cohortId`. Touching them would add risk for no gain and is treated as a red flag during implementation.

## Consequences

**Positive**
- One `AggregationService` operator drives many cohorts concurrently over a single transport, with independent per-cohort completion and failure isolation - the model a long-running service deployment (a service daemon, and eventually a web application) and non-inclusion signaling (cohorts persisting across signing rounds) need.
- A stalled or failed cohort fails only its own `RunContext`; siblings continue and the runner stays alive. Completion no longer tears down shared transport delivery.
- The public surface is purely additive (`advertiseCohort`, `runAll`, `stopCohort`, `joinMatching`, `getValidation`, optional `config`, receive-only `cohortId` event fields); `run()`, `solo()`, and `joinFirst()` are preserved verbatim.
- "Every aggregation event identifies its cohort" becomes a uniform invariant, which the extracted standalone package and a multi-cohort UI build on directly.
- Participants receive their resolution sidecar (CAS Announcement map / SMT inclusion proof) at `cohort-complete`, closing a pre-existing gap where the phase-filtered `pendingValidations` returned nothing at the `Complete` phase.
- `cohort.ts`, `phases.ts`, the signing session, `messages/*`, and `transport/*` are untouched; the blast radius is the runner facade, `events.ts`, and one additive `participant.ts` accessor, plus tests.

**Negative**
- `service-runner.ts` is substantially rewritten (per-cohort handler bodies, the `RunContext` map, per-cohort timers, completion, and teardown). It is a faithful re-scoping rather than new mechanism, but it is not a field rename.
- A long-lived runner reclaims each `RunContext` on every settle, but **completed** cohorts remain in `session` (so callers can read their beaconAddress post-completion); an operator running very many cohorts should `session.removeCohort(cohortId)` once it has consumed a result, or session state grows.
- Test fragility: existing single-cohort specs assert a fixed event sequence; under concurrent cohorts events interleave, so assertions become `cohortId`-aware matchers.
- Lib call sites that read `service.session.cohorts[0]` inside `onProvideTxData` are latent single-cohort bugs under concurrency (no type error). All such closures switch to `info.cohortId -> session.getCohort(info.cohortId)`.

**Accepted**
- The change is additive at runtime; widening receive-only event payloads is source-compatible for consumers, so the final `method` version bump is decided at release time under the project's pre-1.0 convention (the only updates required are this repo's own tests). `api` and `cli` take no change - neither imports the aggregation runners.
- `runAll()` is a dynamic drain, not a frozen-snapshot batch. Callers wanting batch semantics await a known set of `completion` promises explicitly.
- Best-effort GC of settled contexts and a runner that intentionally outlives individual cohorts are the accepted operational shape for a service daemon.

## References

- [`packages/method/src/core/aggregation/runner/service-runner.ts`](../../packages/method/src/core/aggregation/runner/service-runner.ts): the single-cohort facade rewritten to the `RunContext` map (`#cohortId`, `#resolveRun`/`#rejectRun`, `run()`, `#finalizing`, the singular timers, `#stopAdvertRepeat`, and the completion-time handler unregister).
- [`packages/method/src/core/aggregation/runner/participant-runner.ts`](../../packages/method/src/core/aggregation/runner/participant-runner.ts): already multi-subscription; gains `joinMatching(options, count)` beside `joinFirst`, and reads the completion sidecar via `getValidation`.
- [`packages/method/src/core/aggregation/runner/events.ts`](../../packages/method/src/core/aggregation/runner/events.ts): service and participant event payloads gaining a top-level `cohortId`.
- [`packages/method/src/core/aggregation/runner/aggregation-runner.ts`](../../packages/method/src/core/aggregation/runner/aggregation-runner.ts): `solo()` preserved unchanged over the new `run()` wrapper.
- [`packages/method/src/core/aggregation/service.ts`](../../packages/method/src/core/aggregation/service.ts), [`cohort.ts`](../../packages/method/src/core/aggregation/cohort.ts): the already-multi-cohort state machines (`#cohortStates` maps) this ADR deliberately does **not** change.
- [`packages/method/src/core/aggregation/participant.ts`](../../packages/method/src/core/aggregation/participant.ts): unchanged for multi-cohort, plus the one additive `getValidation(cohortId)` accessor that surfaces the retained sidecar (CAS Announcement / SMT proof) at completion.
- [ADR 008](008-aggregation-subsystem-inception.md): the coordinator-liveness-only trust model a multi-cohort operator inherits. [ADR 020](020-aggregation-layered-architecture.md): the three-layer architecture; this ADR refactors layer 3 only. [ADR 027](027-aggregation-security-hardening.md): the Cohort TTL the per-cohort timers generalize. [ADR 038](038-musig2-key-custody.md): the pubkey-only coordinator narrowing the multiplexer preserves. [ADR 039](039-cohort-condition-model.md): the `CohortConfig` / `COHORT_ADVERT` conditions each advertised cohort now carries independently.
