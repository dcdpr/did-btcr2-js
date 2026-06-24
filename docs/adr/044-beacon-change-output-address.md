---
title: "ADR 044: Beacon Change Output - Caller-Supplied Address to End Beacon-Address Reuse"
---

# ADR 044: Beacon Change Output - Caller-Supplied Address to End Beacon-Address Reuse

**Status:** Accepted (implementation pending)

**Date:** 2026-06-24

**Branch / PR:** `feat/aggregation-privacy-fees`

**Implementation status:** This record fixes the design ahead of the change on this branch. At the time of writing the builders still return change to the beacon address unconditionally; the `changeAddress` parameter described below is the accepted target, not yet present in the code.

**References:** [ADR 037](037-single-party-beacon-and-two-axis-model.md), [ADR 038](038-musig2-key-custody.md), [ADR 039](039-cohort-condition-model.md), [ADR 040](040-multi-cohort-service-runner.md), [ADR 042](042-fault-tolerant-beacon-output.md), [ADR 043](043-k-of-n-fallback-protocol.md)

## Context

Every beacon broadcast spends a UTXO from the beacon address and returns its change to that **same** address. This is true of all four beacon paths: the single-party singleton, CAS, and SMT beacons (which share `SinglePartyBeacon.buildSignAndBroadcast`) and the multi-party aggregation builder (`buildAggregationBeaconTx`). Each builder adds the change output first, then a trailing `OP_RETURN` carrying the 32-byte signal, and the change output's recipient is hard-coded to the address the transaction just spent from.

Reusing the beacon address for change links a beacon's entire announcement history into a single walkable UTXO chain: the change of one signal becomes the input of the next, all at one address. An observer needs no off-chain data to enumerate every past and future signal of a beacon, to cluster all of a controller's (single-party) or a cohort's (aggregation) announcements under one persistent on-chain identity, and to read the announcement cadence as an activity side channel. For a method whose value proposition is censorship resistance, a permanent self-advertising on-chain address is a censorship target (a miner or relay can blacklist or watch the address) and a deanonymization vector. This is the load-bearing privacy weakness in the broadcast path.

The did:btcr2 specification fixes the beacon transaction's spend source (the beacon address) and its signal output (an `OP_RETURN` carrying the update or aggregator hash, which the spec requires to be the **last** transaction output, the output resolution reads the signal bytes from), but it is silent on the change output and silent on transaction fees. Where the spec is silent the implementation decides, and improving the change output does not violate any normative requirement as long as the signal stays the last output.

Two structural facts constrain how far this decision can go:

- **Single-party.** The signer's public key *is* the beacon address (enforced by the `SIGNER_KEY_MISMATCH` guard), so the transaction's input address cannot move per broadcast. The three deterministic singleton beacons of a `did:btcr2:k...` document are additionally locked to the genesis public key, and resolution depends on signals appearing at exactly those addresses. Input-address rotation is therefore not a property of the broadcast builder; it is achieved at the document layer, by adding new singleton beacon services backed by other keypairs the controller manages in a wallet, and the encouraged cost-and-privacy path is to move to aggregate beacons.
- **Aggregation.** The input is the cohort's MuSig2 address, not tied to any one party, so the cohort *could* send change elsewhere, but "who owns the change" is the advertise-only economics question that [ADR 039](039-cohort-condition-model.md) deliberately leaves to the funder. A transient n-of-n cohort that may dissolve after one round also cannot safely lock change to anything that requires all n signers to reconvene.

## Decision

### 1. The change destination becomes a caller-supplied address, defaulting to the beacon address

Both builders gain an optional change address: a `changeAddress` field on the single-party `BroadcastOptions` and on the `buildAggregationBeaconTx` options. When omitted, change goes to the beacon address exactly as today, so every existing caller, test, and vector is unchanged. A privacy-conscious caller supplies a fresh address it controls, and the change-chain re-link is broken at the source.

### 2. Privacy is a caller-pulled policy lever, not an automatic guarantee

The default still reuses the beacon address. This decision exposes a lever; it does not flip privacy on for everyone. The reason is deliberate: the only designs that make privacy automatic require the builder itself to hold or derive a spendable change key, which collides with three established constraints. The builders are sans-I/O and hold no I/O or key material of their own; the single-party `Signer` abstraction exposes no derivation surface; and the aggregation coordinator holds only public key material, never a secret (the custody model of [ADR 038](038-musig2-key-custody.md)). The wallet, which already manages keys beyond the beacon key in order to add non-deterministic beacons, is the correct layer to mint a fresh change address and hand it in. Pushing key custody into the builder to win an automatic default would be a worse architecture than letting the caller name where change goes.

### 3. The scope is the change output only; input-address rotation lives elsewhere

This decision changes where change goes, nothing else. For the single-party path it does not, and cannot, rotate the beacon input address: that is a document-update concern (adding new beacon services backed by wallet-managed keys) and a deployment choice (preferring aggregate beacons), both outside the broadcast builder. Single-party privacy from this decision is therefore partial by construction: it stops the change-chain re-link but the beacon input addresses themselves remain visible. The decision states that plainly rather than implying a stronger guarantee.

### 4. The signal output stays last; change is placed before it

The spec requires the signal to be the last output of the beacon transaction (resolution reads the signal bytes from the last output), so the `OP_RETURN` signal output remains final and the change output is placed before it. Changing the change recipient never reorders the outputs, leaving signal discovery and the spec's last-output requirement unaffected.

### 5. Aggregation change ownership tracks the advertised funding model

For an operator-funded cohort, the operator funded the input and the caller supplies the operator's funding-wallet address as the change destination, so ownership is explicit and external to the protocol, matching the advertise-only stance of [ADR 039](039-cohort-condition-model.md). The reserved participant-funded model (which would imply per-participant refunds across multiple change outputs) stays out of scope: a single change output, owned by whoever the caller names.

## Consequences

- **Backward-compatible by default.** Omitting the change address reproduces today's behavior exactly, so no existing test or test vector changes. Privacy is opt-in.
- **Privacy is deployment-tunable.** The wallet (single-party) or the operator (aggregation) decides whether to rotate change, and to where, without any change to the builders' custody posture.
- **Single-party privacy is partial.** This decision breaks the change-chain re-link but leaves the beacon input addresses visible; full single-party unlinkability is reached by adding new beacon services or moving to aggregate beacons, which this decision documents but does not implement.
- **The change-output script kind is now variable.** A caller-supplied change address may be a different script type than the beacon address, which changes the transaction vsize the fee is computed over. The fee decision that follows ([ADR 045](045-analytical-vsize-aggregation-fees.md)) is sized over this variable change output, which is why the change-output decision is settled first.
- **The "change equals beacon address" assumption is generalized.** The transaction plan that previously documented its change recipient as identical to the beacon address now records the actual change recipient, since the two can differ.

## Rejected alternatives

- **Builder-derived fresh change address (a BIP-32 child minted inside the builder).** This wins an automatic default but forces secret-key custody and derivation into a sans-I/O builder, breaking the single-party `Signer` abstraction and the coordinator-holds-only-public-key model of [ADR 038](038-musig2-key-custody.md). The wallet is the correct layer to derive change keys.
- **Rotating, per-cohort or per-announcement deterministic change address.** Best on paper for never reusing an address, but it carries the same custody problem and adds a liveness hazard for aggregation: a transient n-of-n cohort cannot reconvene to spend change locked to a rotated cohort key.
- **Hard cutover (require an explicit change address, no default).** Maximizes default privacy but breaks every existing caller, test, and vector for a property that is a deployment choice. Defaulting to the beacon address keeps adoption frictionless while still offering the lever.
- **Folding single-party input-address rotation into this decision.** Rotating the beacon input address is a document-update concern (adding beacon services backed by wallet-managed keys), not a property of the broadcast builder; bundling it here would conflate the write path with beacon transaction construction and pull in a much larger change for partial benefit.
