---
title: "ADR 070: Beacon Broadcasts Return Structured Artifacts and CAS Publication Precedes the On-Chain Spend"
---

# ADR 070: Beacon Broadcasts Return Structured Artifacts and CAS Publication Precedes the On-Chain Spend

**Status:** Accepted

**Date:** 2026-07-07

**Branch / PR:** `feat/cas-first-broadcast`

**References:** [ADR 037](037-single-party-beacon-and-two-axis-model.md), [ADR 056](056-beacon-signal-format-validation.md), [ADR 069](069-fetch-based-cas-executors-drop-helia.md)

## Context

Every single-party beacon broadcast (`SinglePartyBeacon.broadcastSignal` on the Singleton, CAS, and SMT beacons) returned only the `SignedBTCR2Update` the caller had passed in. Everything else the broadcast produced was discarded:

- **The transaction id.** `buildSignAndBroadcast` returns the txid of the signal transaction; every beacon dropped it. Callers could not record which on-chain transaction anchors their update without re-querying the chain.
- **The SMT inclusion proof and its nonce.** The SMT beacon built a single-entry Merkle tree with a freshly generated 32-byte nonce, broadcast the root, and threw both the tree and the nonce away. The did:btcr2 SMT proof-verification algorithm blinds each leaf with that nonce, and the nonce exists nowhere but in the broadcasting process's memory. Discarding it made **every single-party SMT beacon signal permanently unresolvable**: no resolver could ever link the on-chain root back to the update.
- **The CAS Announcement.** The CAS beacon constructed the announcement (the DID-to-update-hash map whose canonical hash rides in OP_RETURN), broadcast its hash, and returned without exposing the announcement. A controller not using the optional `casPublish` callback (the sidecar-only flow the spec explicitly permits) had no way to capture the very object they are required to retain and distribute for resolution.

Separately, the CAS beacon invoked the optional `casPublish` callback **after** the transaction broadcast. A CAS publish failure therefore surfaced only after the beacon UTXO was irrevocably spent, leaving an on-chain signal pointing at an announcement that never reached the store. The spec's data-retention requirement is that update data be available at resolution time; it mandates no publish-versus-broadcast ordering, so the ordering is an implementation-quality decision, and publishing after the spend is the strictly worse of the two orders.

Finally, `Updater.announce` (the static utility wrapping `BeaconFactory.establish` plus `broadcastSignal`) accepted no options parameter, so callers going through it could not supply a fee estimator, change address, or `casPublish` callback at all.

## Decision

1. **`broadcastSignal` returns a structured `BroadcastResult`** on all three beacons (and on the abstract base signature):

   ```typescript
   interface BroadcastResult {
     signedUpdate: SignedBTCR2Update;
     txid: string;
     announcement?: CASAnnouncement; // CAS beacons
     proof?: SMTProof;               // SMT beacons
   }
   ```

   The Singleton beacon returns `{ signedUpdate, txid }`. The CAS beacon adds the announcement. The SMT beacon serializes the inclusion proof from the tree it just built (`BTCR2MerkleTree.proof(did)`, which embeds the leaf nonce and the update hash) and returns it, fixing the unresolvable-signal defect. The nonce is not returned as a separate field: the serialized proof already carries it in the wire format the resolver consumes.

2. **The CAS beacon publishes before it spends.** `casPublish(announcement)` runs before `buildSignAndBroadcast`. A publish failure aborts the operation while the beacon UTXO is still unspent. Because the announcement is content-addressed, the ordering is retry-safe in both failure directions: a publish that succeeded before a failed broadcast re-publishes the same bytes to the same address on retry, and an orphaned announcement in the store (published, never anchored) is inert.

3. **`Updater.announce` gains an options parameter and returns the `BroadcastResult`.** The parameter is typed as `CASBroadcastOptions` (the widest single-party options shape); non-CAS beacons ignore `casPublish`.

4. **`CasPublishFn` documentation is made executor-neutral** (it referenced a specific IPFS implementation) and now states the pre-spend invocation contract.

## Consequences

- Single-party SMT beacon broadcasts become resolvable for the first time: the caller receives the proof whose nonce previously died with the broadcast, and can distribute it via sidecar (`sidecar.smtProofs`). A regression test broadcasts against a mocked Bitcoin connection and round-trips the returned proof through `SMTBeacon.processSignals`.
- Sidecar-only CAS beacon controllers can now capture the announcement they must distribute; the same round-trip is pinned by test.
- The return-type change from `Promise<SignedBTCR2Update>` to `Promise<BroadcastResult>` is breaking for callers that used the return value directly; at 0.x this ships as a minor version bump. Callers that ignored the return value are unaffected.
- The CAS publish-then-spend ordering is a semantic change for existing `casPublish` users: the callback now runs earlier, and its failure now prevents the spend instead of following it. This is called out in the changelog as the intended new contract.
- The `Updater` state machine itself is unchanged: `NeedBroadcast` fulfillment and `UpdaterResult` keep their shapes. The caller driving the machine performs the broadcast and holds the `BroadcastResult`; threading it through `provide()` into the machine's result would grow the state machine's surface for data the caller already has.
- A residual remains on the SMT path: the retry-safety argument above is content-addressing's, and an SMT root is not content-addressed (the nonce is generated per call). If the broadcast fails **ambiguously**, the send throws after the node actually accepted the transaction, the thrown path discards the proof and a retry builds a different tree, so the originally-propagated root can confirm on-chain as an unresolvable signal. Callers needing stronger guarantees should treat a broadcast timeout as possibly-sent and confirm before retrying; making the nonce injectable (so a retry rebuilds the identical tree) is deliberately deferred until a consumer needs it.

## Rejected alternatives

- **Return the SMT nonce as a separate `BroadcastResult` field.** The serialized proof already embeds the nonce in the format `processSignals` verifies; a second copy would be redundant state that could drift from the proof.
- **Keep publishing after the broadcast.** No ordering is spec-mandated, but publish-after-spend converts a transient CAS outage into an on-chain signal with no retrievable announcement; publish-before-spend converts it into a clean, retryable abort. The only cost is a possible orphaned (published, never anchored) announcement, which is harmless.
- **Have the beacons publish the signed update too.** The beacons' responsibility is the signal transaction and its immediate artifacts. Which stores receive the update, under what policy, is an application concern; the api layer implements it (ADR 071) via the `casPublish` seam and its own pre-broadcast publish step.
