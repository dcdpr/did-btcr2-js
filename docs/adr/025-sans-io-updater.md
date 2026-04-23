---
title: "ADR 025: Sans-I/O Updater State Machine for the DID Write Path"
---

# ADR 025: Sans-I/O Updater State Machine for the DID Write Path

**Status:** Accepted

**Date:** 2026-04-13

**Commit:** [`d82a13f`](https://github.com/dcdpr/did-btcr2-js/commit/d82a13f)

## Context

[ADR 016](016-sans-io-resolver.md) introduced the sans-I/O state-machine pattern for the read path (`Resolver`). The DID write path: `DidBtcr2.update({...})`: was still a monolithic async function that directly:

- Built the unsigned update from a source document and JSON Patch operations.
- Asked the caller for a signing key (via an opaque callback).
- Checked UTXO availability at the beacon address (implicit Bitcoin RPC call).
- Broadcast the signal on the caller's behalf.

This had the same problems the Resolver pattern was created to solve: I/O and protocol logic interleaved, hard to test without mocks, and consumers couldn't insert their own key-handling semantics (hardware wallets, multisig prompts) without monkey-patching the library.

## Options considered

1. **Keep the monolithic async `update()`** and live with the coupling.
2. **Split `update()` into free functions** (`construct`, `sign`, `fund`, `broadcast`) the caller composes manually. Would work but puts the phase-sequencing burden on every caller.
3. **Sans-I/O state machine mirroring `Resolver`**: emit typed `DataNeed` requests for the caller to fulfill, sequence phases internally.

## Decision

**Option 3.** Add `Updater` in `packages/method/src/core/updater.ts`. It mirrors the Resolver pattern with a write-path-appropriate phase sequence and its own `DataNeed` discriminated union:

**Phases:** `Construct to Sign to Fund to Broadcast to Complete`.

**Data needs:**
- `NeedSigningKey`: caller provides the secret key bytes (or a KMS-backed signature). Includes the `unsignedUpdate` for inspection.
- `NeedFunding`: caller confirms the `beaconAddress` has a spendable UTXO (caller's choice how to check).
- `NeedBroadcast`: caller announces the `signedUpdate` via the chosen beacon service (singleton, CAS, or aggregation).

Static utility methods on `Updater`: `Updater.construct()`, `Updater.sign()`, `Updater.announce()`: expose each step individually for scripts that don't want the full state machine (e.g. test-vector generation in `lib/generate-vector.ts`).

**Factory validation.** `DidBtcr2.update({...})` validates that `verificationMethodId` is in `capabilityInvocation` and that `beaconId` matches a service in the source document before returning an `Updater`. Invalid inputs fail fast at the factory, not mid-state-machine.

## Consequences

**Positive**
- Write-path logic is testable without network, Bitcoin, or KMS stubs. Tests drive the state machine directly with synthetic `provide()` calls.
- Hardware-wallet and multisig key-handling integrate naturally by handling `NeedSigningKey` on the caller side.
- Symmetry with `Resolver` means anyone who understands the read path understands the write path immediately.
- Static methods give a quick path for scripts; the full state machine gives a safe path for production.

**Negative**
- Two sans-I/O state machines to maintain. Similar patterns but distinct state and needs; keeping them conceptually aligned is a review-time responsibility.
- Callers who want "just update this DID" have slightly more boilerplate than a single `await DidBtcr2.update({...})` call would have provided. Mitigated by a helper at the API façade layer, which `@did-btcr2/api` does offer.

**Explicitly accepted trade-offs**
- The Updater is independent of any specific beacon type. `NeedBroadcast` is the seam where the caller decides between `SingletonBeacon.broadcastSignal()` and the aggregation subsystem ([ADR 020](020-aggregation-layered-architecture.md)); the Updater state machine doesn't privilege either path.

## References

- [`packages/method/src/core/updater.ts`](../../packages/method/src/core/updater.ts): state machine.
- [`packages/method/tests/updater.spec.ts`](../../packages/method/tests/updater.spec.ts): test suite.
- [ADR 016](016-sans-io-resolver.md): the read-path counterpart this ADR mirrors.
