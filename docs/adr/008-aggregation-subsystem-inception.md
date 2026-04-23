---
title: "ADR 008: Aggregation Subsystem Inception"
---

# ADR 008: Aggregation Subsystem Inception

**Status:** Accepted

**Date:** 2025-11-12

**Commit:** [`1539e71`](https://github.com/dcdpr/did-btcr2-js/commit/1539e71)

## Context

did:btcr2 defines three beacon types: singleton (single-party), CAS (content-addressed-store aggregate), and SMT (Sparse Merkle Tree aggregate). Singleton is straightforward: one controller, one beacon address, one signature per update. The aggregate beacons are fundamentally multi-party: *many* controllers' updates share a single on-chain signal, announced by a single transaction output signed by a single aggregated signature. Someone: something: has to coordinate that.

Three questions had to be answered together before any code was worth writing:

1. **Should the reference implementation ship aggregation at all, or just the singleton beacon?** The spec describes aggregate beacons normatively, but implementing them is a large piece of work. Deferring aggregation would let the library ship a singleton-only MVP. But singleton-only pushes the multi-party coordination problem onto every service operator, each of whom would reinvent the protocol.
2. **What signing scheme?** Aggregate beacons need one on-chain signature that represents N participants' authorization. Options include a k-of-n multisig (Bitcoin-script), a threshold Schnorr (FROST), a plain Schnorr aggregate (MuSig2), or Taproot key-path with MuSig2. Each has dramatically different security, setup, communication, and bandwidth profiles.
3. **What coordination model?** Fully decentralized peer-to-peer, a coordinator-orchestrated model, or something between? And how do participants actually *talk* to each other: over what transport, with what message shape, with what trust model?

The early code in `method/src/core/beacon/aggregation/` had partial answers from the spec-draft era, but they were scattered across a handful of files, the coordinator was half-written, the participant was a stub, and messages were loosely typed. The decision window was: either continue the incremental path: which had already drifted enough that the `beacon-aggregation` branch couldn't be cleanly merged back to main: or commit to a structured subsystem with clear protocol shape.

## Options considered

**On shipping aggregation at all:**

1. **Defer.** Ship singleton-only; leave aggregate beacons for a future release. Operators of aggregate beacons build their own coordination layer. The reference library stays smaller.
2. **Ship now.** The reference implementation implements what the spec defines, end-to-end. Operators who want aggregate beacons get a working reference, and downstream spec work can compare against real code.

**On signing scheme (assuming we ship aggregation):**

1. **k-of-n P2SH/P2WSH multisig.** Well-established, Bitcoin-native. But: each signature on-chain (or the script revealing n pubkeys) reveals the cohort size and structure, ballooning transaction size and identifying participants.
2. **FROST / threshold Schnorr.** True threshold signing; any t-of-n subset can sign. Cutting-edge but still stabilizing in 2025-2026; protocol implementations are in flux.
3. **MuSig2 (BIP-327) over Taproot key-path.** All n participants must sign (no threshold). Aggregates to a single Schnorr signature indistinguishable from a single-signer Schnorr. Well-specified, reviewed, implementable today.

**On coordination model:**

1. **Fully decentralized P2P.** Every participant talks to every other participant; no coordinator. Maximally trust-minimized; worst scaling and worst UX for participant discovery.
2. **Coordinator-orchestrated.** A designated coordinator builds the cohort, collects nonces/signatures, and aggregates the result. The coordinator can be self-hosted by the service operator or anyone else; participants stay self-custodial. Good scaling, recognizable UX, but requires clear trust boundaries.

**On communication transport:**

1. **Bespoke protocol over TCP/WebSockets.** Full control, no external dependencies; but reinvents message delivery, storage, relay, and participant identity.
2. **Leverage an existing messaging substrate.** Nostr (relay-based, keyed identity, encrypted DMs) and DIDComm (DID-keyed, relay-agnostic, more formal) are both viable. Both have existing client libraries and relay/mediator infrastructure.

## Decision

**Ship aggregation now (Option 2 on the first question).** The reference implementation implements what the spec defines. Downstream implementations (Rust, Python, others) compare against real TypeScript code. Operators wanting aggregate beacons run something rather than improvising.

**MuSig2 (BIP-327) over Taproot key-path (Option 3 on scheme).** Unique aggregated Schnorr signatures; indistinguishable on-chain from single-signer Schnorr (cohort size and participant set are private); well-specified; implementable with `@noble/curves` primitives. The "all n must sign" constraint is acceptable for aggregate beacons because a controller who won't sign simply isn't in the cohort: participation is opt-in per update round, not per lifetime.

**Coordinator/participant model (Option 2 on coordination).** One coordinator role, many participant roles. Coordinator builds the cohort from inbound participant opt-ins, distributes the aggregated data for validation, runs the MuSig2 nonce and signing rounds, and broadcasts the resulting Bitcoin transaction. Participants sign only for their own updates, validate the coordinator's aggregation before authorizing, and contribute MuSig2 nonces and partial signatures. The coordinator holds no signing authority over participants' keys: participants can refuse to sign if they don't like what the coordinator assembled. This matches [ADR 027](027-aggregation-security-hardening.md)'s trust model (don't trust the coordinator with custodial authority).

**Pluggable communication (Option 2 on transport).** The initial implementation carries two adapters behind a `Transport` / communication-service interface:

- **Nostr**: fully implemented. Uses kind 1 / 1059 events, NIP-44 encryption later adopted for directed messages. Relay-based, well-understood participant discovery via public keys.
- **DIDComm**: stub at inception; formal DID-keyed messaging for use cases that require it. Full implementation deferred.

The `Transport` seam means a third transport (HTTP, WebSocket, bespoke) can slot in without touching the protocol state machines: which is later exercised by [ADR 028](028-http-transport-additive.md).

**Subsystem layout at inception:**

- `method/src/core/beacon/aggregation/coordinator.ts`: cohort formation, aggregation, signing rounds on the coordinator side.
- `method/src/core/beacon/aggregation/participant.ts`: discovery, opt-in, validation, nonce contribution, signature authorization.
- `method/src/core/beacon/aggregation/cohort/messages/`: typed message classes grouped by protocol phase (`keygen/`, `sign/`), each a small class with explicit fields.
- `method/src/core/beacon/aggregation/communication/adapter/{nostr,did-comm}.ts`: transport adapters.
- `method/src/core/beacon/aggregation/session/`: MuSig2 session state.

The protocol has four sequenced phases: **keygen** (cohort formation, opt-in, aggregated pubkey), **update distribution** (participants submit updates, coordinator assembles aggregate), **signing** (MuSig2 nonce to partial sig to aggregated sig), **broadcast** (final Bitcoin transaction). Each message type in the protocol has its own class; each phase has its own state tracking.

This is the design that [ADR 020](020-aggregation-layered-architecture.md) later rewrites into the layered `AggregationService` / `AggregationParticipant` / `AggregationCohort` / `BeaconSigningSession` state machines, and that [ADR 027](027-aggregation-security-hardening.md) later hardens. The core shape: coordinator + participants, MuSig2 signing, pluggable transport: was committed to here and survived both rewrites.

## Consequences

**Positive**
- The reference implementation is spec-complete in scope (three beacon types, all working end-to-end eventually). Downstream implementations and spec reviewers have a concrete TypeScript baseline.
- MuSig2 gives on-chain indistinguishability. An aggregate-beacon transaction looks like a single-signer Taproot spend. Cohort size and participant identities are not revealed on-chain.
- The coordinator/participant split matches real deployment scenarios: a service operator runs the coordinator; individual controllers (the spec's "DID controllers") run participants. The trust boundary is clear.
- Pluggable transport means the subsystem can migrate substrates without re-doing the protocol. The `Transport` seam is validated later by HTTP transport ([ADR 028](028-http-transport-additive.md)) slotting in alongside Nostr.

**Negative**
- Large surface area for a v0.1.0. Coordinator + participant + four message phases + two transport adapters + MuSig2 session management is a lot to land at once. The initial commit is explicit about this being reconstructed from a drifted branch.
- MuSig2 requires two signing rounds (nonce commit + nonce reveal + partial sig). More complex than a single-round scheme; participants must stay online across the rounds. A participant dropping out mid-session is a real failure mode that has to be handled.
- "All n must sign" is unforgiving. A single participant who goes offline during signing blocks the whole cohort. This is accepted as a trade-off (see below) but is worth naming clearly.
- Nostr as a dependency carries its own operational considerations: relay availability, NIP-44 crypto correctness, public-key identity semantics. The initial implementation uses relays as simple transport, not as a source of truth.

**Explicitly accepted trade-offs**
- **No threshold signing.** FROST would allow t-of-n partial signing: a participant can drop out and the cohort can still sign. MuSig2 cannot. Accepting this because: FROST is not as stable; MuSig2 has simpler security proofs and broader library support; the aggregate-beacon use case is opt-in-per-round, so a participant going offline just isn't in that round's cohort: they join the next one.
- **Coordinator is trusted for liveness, not authority.** A malicious coordinator can censor (refuse to include an update), stall, or mis-aggregate. It cannot forge signatures, steal funds, or change participants' updates. Participants validate the aggregated data before authorizing the signing round. This trust model is formalized in [ADR 027](027-aggregation-security-hardening.md).
- **Two transport adapters at inception, but one fully implemented.** Nostr is complete; DIDComm is a stub. The asymmetry was accepted to ship a working end-to-end path; DIDComm full implementation was deferred. Shipping two half-finished adapters would have been worse than one working one plus a clear stub.
- **Subsystem lives inside `method`, not its own package.** Aggregation is tightly coupled to beacon types and the update flow. Carving it into `@did-btcr2/aggregation` was considered but deferred: the internal coupling is still high at inception, and premature package-boundary work would lock in interfaces that hadn't stabilized.
- **No incentive mechanism.** The reference implementation doesn't address how coordinators get paid or how participants are incentivized to include others' updates. That's an operational-layer problem; the protocol makes the cryptography possible without mandating an economic model.

## References

- `packages/method/src/core/aggregation/`: the subsystem that originated here.
- Commit `1539e71` (2025-11-12): inception of the cohort/messages/communication/session structure.
- [BIP-327](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki): MuSig2 specification.
- [ADR 018](018-beacon-hierarchy.md): beacon-type hierarchy that aggregate beacons plug into.
- [ADR 020](020-aggregation-layered-architecture.md): later rewrite into layered state-machine architecture (`AggregationService`, `AggregationParticipant`, `AggregationCohort`, `BeaconSigningSession`).
- [ADR 027](027-aggregation-security-hardening.md): later hardening pass over the trust model committed to here.
- [ADR 028](028-http-transport-additive.md): HTTP transport that plugged in alongside Nostr via the `Transport` seam defined here.
