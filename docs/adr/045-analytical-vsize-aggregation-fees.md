---
title: "ADR 045: Analytical-vsize Dynamic Fees for the Aggregation Beacon Broadcast"
---

# ADR 045: Analytical-vsize Dynamic Fees for the Aggregation Beacon Broadcast

**Status:** Accepted (implementation pending)

**Date:** 2026-06-24

**Branch / PR:** `feat/aggregation-privacy-fees`

**Implementation status:** This record fixes the design ahead of the change on this branch. At the time of writing the aggregation builder still sizes the fee from a single fixed constant, and the service runner exposes no `FeeEstimator` injection point; the analytical vsize and the runner-level estimator described below are the accepted target, not yet present in the code.

**References:** [ADR 040](040-multi-cohort-service-runner.md), [ADR 042](042-fault-tolerant-beacon-output.md), [ADR 043](043-k-of-n-fallback-protocol.md), [ADR 044](044-beacon-change-output-address.md)

## Context

Both beacon builders compute the fee as the estimator's rate applied to a fixed vsize constant, with no probe-sign. The single-party builder uses a per-kind constant (it holds the secret but chooses a constant for determinism); the aggregation builder uses a single P2TR constant because at construction time it has no secret at all. The aggregation signature is produced downstream by a MuSig2 nonce-then-partial-signature round, so when the transaction is built there is nothing to sign with and nothing to measure. The constant of roughly 160 vbytes is the standing workaround, with an in-code comment recording exactly that reason.

The `FeeEstimator` interface already separates the two concerns a fee needs: the estimator supplies the **rate** (sat/vB) and the caller supplies the **size** (vsize). A "dynamic fee" in this context means responding to a live rate, for example a mempool or Bitcoin Core estimate, rather than a hard-coded rate. It does not mean measuring the size by signing, which the aggregation path still cannot do. The size must instead be computed analytically from public parameters, all of which are known at construction time: the spend is a P2TR key-path, the output set is one change output plus one `OP_RETURN` carrying the 32-byte signal, and the witness is a single 64-byte BIP-340 signature.

[ADR 044](044-beacon-change-output-address.md) makes the change output's script kind variable (a caller may send change to an address whose type differs from the beacon address). The single constant baked in "one P2TR change output," so it no longer describes every aggregation transaction. The vsize must be parameterized over the change-output kind, which is why the change-output decision is settled first.

## Decision

### 1. The aggregation key-path fee uses an analytical vsize, not a single constant

The fee for the optimistic key-path spend is the estimator's rate applied to a vsize computed from public parameters: the stripped base for a one-input P2TR key-path transaction with a trailing `OP_RETURN(32)` output, plus the change output's bytes for its actual script kind (derived from the [ADR 044](044-beacon-change-output-address.md) change address), plus the witness-weighted cost of one 64-byte BIP-340 signature. No secret is required, and no probe-sign round is performed; the number is derived, not measured. The previous P2TR constant is retained as the default change-output case, so a transaction whose change returns to the (P2TR) beacon address sizes exactly as before.

### 2. The scope is the optimistic key-path spend only

This decision sizes the fee for the key-path spend that the service constructs and signs first. The k-of-n fallback spend of [ADR 043](043-k-of-n-fallback-protocol.md) and the CSV recovery spend of [ADR 042](042-fault-tolerant-beacon-output.md) are heavier (their witnesses carry multiple signatures or a control block and leaf script), and they are built and broadcast by different actors at different times. They size their own fee from their own witness shape; the single fee the key-path builder returns does not cover them. This decision names that boundary rather than implying the key-path fee covers every spend of the funded output.

### 3. A FeeEstimator is threaded through the service runner's transaction-data boundary

Today the aggregation builder accepts an optional estimator, but the service runner's transaction-data callback (the hook a caller fills to return the unsigned transaction and its sighash inputs) has no channel to receive one, so an integrator wanting a live rate must hard-code it inside the callback. This decision surfaces a `FeeEstimator` as a runner option and passes it into the callback's input, giving production callers a single standard injection point for a dynamic (mempool or Bitcoin Core) estimator. The default remains the static 5 sat/vB estimator, preserving current behavior.

### 4. The analytical vsize is locked by a finalized-witness test

The vsize formula is guarded by a unit test that builds a finalized key-path witness with a dummy 64-byte signature and asserts the actual vsize is no greater than the formula and within a small slack, extending the existing beacon vsize lock-in test. This catches a formula that ever under-sizes the real transaction (which would under-pay the fee) without coupling the test to a live signing round.

## Consequences

- **Aggregation broadcasts can follow the fee market.** A caller can inject a live-rate estimator at a documented point, instead of being limited to the static default, without needing a probe-sign the MuSig2 round cannot provide.
- **The fee tracks the change-output choice.** Because the vsize includes the actual change output, a cheaper change kind (for example P2WPKH change on a P2TR beacon) lowers the fee correctly rather than over-paying against a P2TR assumption.
- **The estimator injection point is explicit.** Fee-rate selection moves from buried callback code to a named runner option, so every integrator solves it the same way.
- **The constant becomes a named default case.** The prior single constant survives as the default-change (P2TR) value, and the lock-in test guards against under-paying as output shapes vary.
- **Fallback and recovery fee sizing is deferred, not dropped.** Those spends keep their own sizing and are named as future work, to be standardized when they gain a dedicated fee path.

## Rejected alternatives

- **Probe-sign the aggregation transaction to measure its vsize.** Impossible at construction time: there is no secret until the downstream MuSig2 round completes. The absence of a secret is the entire reason an analytical vsize is required.
- **Keep a single hard-coded vsize constant.** It bakes in one P2TR change output, which [ADR 044](044-beacon-change-output-address.md) can overturn, and it cannot reflect a different change kind. It over-pays or under-pays as the output set varies.
- **Select the estimator only inside the operator's transaction-data callback.** It works but offers no standard injection point and forces every integrator to re-solve fee wiring; a runner option centralizes it and keeps the callback focused on transaction construction.
- **Standardize the fallback and recovery fees in this same decision.** Those spends have different witness shapes, different broadcasters, and a different timing; bundling them would couple unrelated fee paths and broaden the change surface with no current caller needing it.
