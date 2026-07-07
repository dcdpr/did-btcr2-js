---
title: "ADR 071: A CAS Publication Policy for the API Update Path (publishToCas), Writable-CAS Capability Detection, and Enriched Update Results"
---

# ADR 071: A CAS Publication Policy for the API Update Path (publishToCas), Writable-CAS Capability Detection, and Enriched Update Results

**Status:** Accepted

**Date:** 2026-07-07

**Branch / PR:** `feat/cas-first-broadcast`

**References:** [ADR 023](023-cas-read-path.md), [ADR 069](069-fetch-based-cas-executors-drop-helia.md), [ADR 070](070-broadcast-result-and-cas-first-ordering.md)

## Context

The api package's read path already treats a CAS as a first-class resolution source: `DidMethodApi.resolve` fulfills `NeedGenesisDocument`, `NeedCASAnnouncement`, and `NeedSignedUpdate` by fetching canonical JCS blocks from the configured `CasApi`. The write path, however, was fully unwired:

- `DidMethodApi.update` called `broadcastSignal` with no options, so the CAS beacon's `casPublish` seam was never supplied and `CasApi.publish` had zero call sites in the workspace.
- Nothing ever published the signed update itself, even though every beacon type's OP_RETURN hash (directly for Singleton beacons, indirectly via the announcement for CAS beacons) resolves to a canonical update block a CAS could serve.
- There was no way to tell whether the configured CAS could accept writes at all. The default CAS is a read-only HTTP gateway whose `publish()` throws; the failure would have surfaced mid-update, after signing.
- `broadcastSignal`'s `BroadcastOptions` (fee estimator, change address) were unreachable through the api, so api and cli users could not set fees.
- A latent defect: `resolve()`'s need-dispatch switch had no `NeedSMTProof` case and no default. Because the resolver re-emits unfulfilled needs on every `resolve()` call, any SMT beacon signal without a matching sidecar proof spun the driver loop forever instead of failing.

The did:btcr2 spec does not require CAS publication (sidecar-only distribution is expressly permitted), so the wiring must be optional and policy-driven, not mandatory.

## Decision

1. **`CasExecutor` gains an optional capability flag, `canPublish?: boolean`, where `undefined` MUST be treated as `true`.** Existing custom executors remain writable-by-default with no code change. The read-only `HttpGatewayCasExecutor` declares `canPublish = false`. `CasApi` exposes the derived `writable` getter.

2. **`DidMethodApi.update` (and `UpdateBuilder`, and `DidBtcr2Api.updateDid`) gain `publishToCas: 'auto' | 'always' | 'never'`, defaulting to `'auto'`:**

   | Policy | Writable CAS | Read-only / no CAS |
   |---|---|---|
   | `'auto'` | publish update (+ announcement for CAS beacons) | Singleton/SMT: skip silently. CAS beacon: **throw up-front** |
   | `'always'` | publish update (+ announcement for CAS beacons) | **throw up-front**, all beacon types |
   | `'never'` | publish nothing | publish nothing |

   The CAS-beacon asymmetry under `'auto'` is deliberate: a Singleton or SMT update that skips CAS publication is still resolvable via sidecar with no surprises, but a CAS beacon signal points at an announcement that must be retrievable somewhere, so silently publishing it nowhere manufactures resolution failures. Callers who intend sidecar-only distribution state it explicitly with `'never'` and receive the announcement in the result. The policy check runs before the update is constructed or signed, so a misconfiguration costs nothing.

3. **Publication order is update, then announcement, then transaction broadcast.** The api publishes the canonical signed update, hands the beacon a `casPublish` callback (CAS beacons only) that publishes the announcement, and only then does the beacon spend the UTXO (pre-spend ordering per ADR 070). Content addressing makes every step idempotent under retry.

4. **`update()` returns a `DidUpdateResult`** instead of the bare `SignedBTCR2Update`: `{ signedUpdate, txid, announcement?, proof?, publishedToCas: { update, announcement } }`. Sidecar-only users capture the artifacts they must distribute; auditing callers see exactly what reached the CAS.

5. **`broadcastOptions` (fee estimator, change address) pass through** `update()`, `UpdateBuilder.broadcastOptions()`, and `updateDid()` to the beacon transaction, closing the api-cannot-set-fees gap.

6. **`resolve()` handles `NeedSMTProof` and unknown needs by failing fast.** SMT proofs are nonce-blinded and not content-addressed by anything on-chain, so no CAS fetch can fulfill the need; the error directs the caller to `options.sidecar.smtProofs`. A `default` case guards against future need kinds an older api cannot fulfill. Both replace an infinite loop.

7. **The cli passes `publishToCas: 'never'` explicitly.** Its CAS configuration is currently gateway-only (read-only), so `'auto'` would make CAS-beacon updates fail with advice (set `'never'`) the cli offers no flag for yet. With `'never'`, cli CAS-beacon updates keep working sidecar-only and now print the announcement, txid, and proof for manual distribution. A follow-up change adds writable-CAS configuration and a `--publish-to-cas` flag, at which point the explicit `'never'` is replaced by the exposed knob.

## Consequences

- With a writable CAS configured, `'auto'` makes every OP_RETURN update hash fetchable from the CAS at resolution time: resolvers need no sidecar for Singleton and CAS beacon updates. This is the feature's goal.
- **Privacy:** under `'auto'`, canonical signed updates (and announcements) are published to the configured, possibly public, CAS **before** the on-chain anchor. Controllers with privacy requirements should use `'never'` and distribute via sidecar, which matches the spec's guidance that privacy-conscious controllers keep update data off public stores. This trade-off is documented on the option itself.
- CAS beacon updates through an api instance whose CAS is the default read-only gateway now throw up-front instead of silently producing a broadcast whose announcement the caller never sees (the old behavior additionally discarded the announcement entirely, pre-ADR 070). This is a deliberate behavior change: the old flow was a resolution failure deferred.
- The `update()` return-type change is breaking for callers using the returned `SignedBTCR2Update` directly; at 0.x it ships as a minor bump, and the update is available as `result.signedUpdate`.
- SMT-beacon resolution through the api now fails with an actionable error when the proof is absent, instead of hanging the process. Single-party SMT updates surface their proof through `DidUpdateResult.proof` (from ADR 070), which is the only channel that proof can reach a resolver by.

## Rejected alternatives

- **Silently skip CAS publication for CAS beacons under `'auto'` with a read-only CAS.** Symmetric with Singleton/SMT, but it turns a configuration gap into a future resolution failure for exactly the beacon type whose signals depend on retrievable announcements.
- **Probe writability by attempting a publish.** A live probe costs a network round-trip, can leave junk in the store, and still races the real publish. A declared capability flag is free and exact; `undefined`-means-writable keeps it non-breaking for custom executors.
- **Publish inside the `Updater` state machine.** The state machine is sans-I/O by design (its value is that broadcast and publication are the caller's I/O); the api layer is precisely the caller that owns I/O policy.
- **Fulfill `NeedSMTProof` from the CAS.** The proof's root is nonce-blinded; there is no content address derivable from the on-chain signal, so a CAS lookup is impossible by construction. Failing fast with the sidecar pointer is the only honest behavior.
