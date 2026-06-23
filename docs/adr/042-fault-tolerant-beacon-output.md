---
title: "ADR 042: Fault-Tolerant Aggregate Beacon Output (Hybrid Taproot)"
---

# ADR 042: Fault-Tolerant Aggregate Beacon Output (Hybrid Taproot)

**Status:** Accepted (supersedes [ADR 041](041-cooperative-non-inclusion-signaling.md))

**Date:** 2026-06-23

**Branch / PR:** `feat/aggregation-non-inclusion`

**References:** [ADR 008](008-aggregation-subsystem-inception.md), [ADR 017](017-optimized-smt-core-primitive.md), [ADR 037](037-single-party-beacon-and-two-axis-model.md), [ADR 038](038-musig2-key-custody.md), [ADR 039](039-cohort-condition-model.md), [ADR 040](040-multi-cohort-service-runner.md), [ADR 041](041-cooperative-non-inclusion-signaling.md)

## Context

An aggregate beacon is a cohort of n participants who jointly control one Bitcoin Taproot address (the beacon address) and collaboratively sign a single transaction that spends a UTXO there and writes an OP_RETURN committing to a batch of their DID updates (a CAS Announcement Map, or a Sparse Merkle Tree root). Today the cohort signs with n-of-n MuSig2 (BIP-327) over a **key-path-only** Taproot output: `p2tr(aggPubkey, undefined, network)` with the key-path tweak `taggedHash("TapTweak", aggPubkey)` (`cohort.ts:127`, `cohort.ts:131`).

**That output has one fatal property.** A key-path-only Taproot UTXO can be spent in exactly one way: a single Schnorr signature under the tweaked aggregate key, which mathematically requires all n MuSig2 partial signatures. One missing or defecting signer makes that signature unobtainable, and with no script-path escape the funded UTXO is then **permanently locked**. Liveness and fund-safety both hinge on 100% signer availability for the life of every funded UTXO, which is untenable for a cohort whose members come and go.

**The premise that forced the prior approach was wrong.** [ADR 041](041-cooperative-non-inclusion-signaling.md) treated n-of-n MuSig2 as mandated by the specification and therefore deferred the liveness fix as structurally impossible (you cannot skip a signer in n-of-n without changing the aggregate key and the funded address). But the did:btcr2 specification only **RECOMMENDS** the MuSig2 example: "A full protocol definition is out of scope for this specification, but a RECOMMENDED example is provided for illustration" ([Aggregate Beacons](https://dcdpr.github.io/did-btcr2/beacons/aggregate-beacons.html)). The signing and recovery scheme is ours to choose. ADR 041 is superseded; its data-layer non-inclusion design (a member with no update is absent from the CAS map, or carries a non-inclusion leaf in the SMT) survives and is carried forward under this decision.

**A research spike compared four directions.** The findings that drive this decision:

| Option | Liveness (announcement completes despite missing signers) | Funds recoverable | Common-case on-chain cost | Privacy | Custody change vs [ADR 038](038-musig2-key-custody.md) | In current stack | Implementation depth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Today: n-of-n MuSig2, key-path only | none, one missing signer freezes it | no, permanent lock | best (~57 vB, flat in n) | best | - | shipped | - |
| A: MuSig2 + timelock recovery leaf | none, still n-of-n to announce | yes, after the timelock | best | best | tweak change only | yes | shallow |
| B: tapscript k-of-n (`OP_CHECKSIGADD`) + recovery | k-of-n | yes | worst, roughly 6 to 10 times the witness on every spend and it reveals membership | worst | none, independent keys | yes (helper flagged experimental) | moderate |
| C: FROST k-of-n key-path + recovery | k-of-n | yes | best (~57 vB, like MuSig2) | best | major, a DKG plus secret shares and re-sharing to change membership | partial, in `@noble/curves` v2 but unaudited and Bitcoin BIPs are draft | deep, plus self-implemented crypto risk |
| D: hybrid (MuSig2 key-path + k-of-n script leaf + timelock recovery) | k-of-n via fallback | yes | best in the common case; fallback cost paid only when used | best in the common case | none, independent keys, plus the tweak change | yes | moderate |

Decisive facts from the spike: the hybrid is **buildable today** with `@scure/btc-signer@1.8.1` (it already exports `p2tr(internalKey, tree)`, `p2tr_ms(k, pubkeys)` for the k-of-n `OP_CHECKSIGADD` leaf, the `CHECKSEQUENCEVERIFY`/`CHECKLOCKTIMEVERIFY` opcodes, control-block encoding, and the script-path sighash and finalizer) with no new crypto dependency. A relative-timelock (CSV, BIP-68/112) recovery leaf is the canonical pattern behind Lightning, Ark, and Bitcoin vaults, it composes with either signing scheme, and it costs nothing in privacy or fees unless it is actually used. FROST is reachable (`@noble/curves` v2 ships a Taproot-compatible `schnorr_FROST` with DKG, and the keypair package already depends on v2) but the module is explicitly unaudited, the Bitcoin FROST BIPs (445 signing, ChillDKG) are drafts, and the tree carries two `@noble/curves` majors (`@scure/btc-signer` bundles v1.9.7).

## Decision

Adopt the **hybrid Taproot beacon output (option D)** with three spend paths, delivered in two increments, with operator-funded recovery designed so participant-funded can be added later without restructuring.

1. **Beacon output becomes an internal key plus a script tree**, replacing the key-path-only output. The internal key `P` is the n-of-n MuSig2 aggregate of the cohort's independent BIP-340 keys (the optimistic cooperative key-path). The script tree carries a k-of-n fallback leaf and a timelock recovery leaf. The output key becomes `Q = P + taggedHash("TapTweak", P || merkleRoot) * G`, so the MuSig2 session tweak must now include the Merkle root. This is the one correctness-critical change to the existing signing path (`cohort.ts:127`/`131`, the session tweak in `signing-session.ts`): a wrong tweak silently produces an invalid key-path signature.

2. **Three spend paths, tried as an optimistic cascade:**
   - **Key-path MuSig2 (all n cooperate):** the cheapest, most private path, roughly 57 vB and indistinguishable on-chain from a single-signer spend, flat regardless of n. This is the common case and is unchanged on the wire from today.
   - **Script-path k-of-n fallback (leaf A, `OP_CHECKSIGADD` over the same independent keys):** when the optimistic round stalls at any step, any k present members each contribute a standalone BIP-340 signature and the announcement still finalizes. Tolerates up to n-k absent or defecting members. The larger witness cost is paid only on this path.
   - **Script-path timelock recovery (leaf B, relative CSV timelock):** when even k cannot be reached, the funder recovers the UTXO after the delay. Funds are never permanently locked.

3. **Operator-funded for now, with an extensible funding model.** The operator funds the beacon UTXO and holds the single CSV recovery key (leaf B is `<delay> CHECKSEQUENCEVERIFY DROP <operatorKey> CHECKSIG`). The `<delay>` is constrained at validation time to a BIP-68 block-based relative timelock in the range 1 to 0xffff: this keeps the nSequence disable bit (bit 31) and the type bit (bit 22) clear, so a misconfigured or hostile delay cannot silently disable the timelock (a value with bit 31 set turns CHECKSEQUENCEVERIFY into a no-op, which would let the recovery key spend with no wait). The bound is enforced in the recovery policy, in the cohort-condition validator, and in the advert wire guard, because a participant funds against the advert and never separately re-validates the conditions. This fits the advertise-only economics of [ADR 039](039-cohort-condition-model.md), where the operator fronts the on-chain cost and may charge enrollment or per-announcement fees. To keep the future open: add a `fundingModel` field to the cohort advert (`operator-funded` now, `participant-funded` reserved) and build the recovery leaf behind a small recovery-policy seam, so a participant-funded model (per-participant CSV refund leaves over separate per-participant UTXOs) can be added later as a new policy implementation rather than a re-architecture. Only operator-funded is implemented now.

4. **Fail-fast at any step.** The cascade detects non-progress at any point (the nonce round, the partial-signature round, or earlier) and transitions optimistic to fallback to recovery rather than hanging, generalizing the per-cohort failure isolation already present in the multi-cohort runner ([ADR 040](040-multi-cohort-service-runner.md)). The cascade must avoid signing two paths for one UTXO (a wasteful or hazardous double-spend attempt); a single point-of-no-return per round governs the switch.

5. **Custody is unchanged, with a bonus.** Independent participant keys throughout: the MuSig2 internal key and the k-of-n leaf both use each member's own BIP-340 key. No FROST, no DKG, no secret shares, so [ADR 038](038-musig2-key-custody.md)'s bounded-secret model and the liveness-only-coordinator invariant hold unchanged. Bonus: a fallback per-signer signature is a one-shot `digest -> signature`, so unlike MuSig2 it can be driven by an opaque or HSM-backed `KeyManager` (the case ADR 038 found mathematically impossible for MuSig2). The fallback path is custody-friendlier than the optimistic one.

6. **Phased delivery:**
   - **Increment 1:** the internal-key plus CSV recovery leaf (leaf B), the tweak fix, the recovery spend builder, and fail-fast. This establishes the script-tree output and immediately removes permanent fund-locking. The announcement still needs all n on the optimistic path at this stage, but funds are always recoverable.
   - **Increment 2:** add the k-of-n `p2tr_ms` fallback leaf (leaf A) and the path-selection cascade, delivering graceful liveness. De-risk the library's experimental `p2tr_ms` first with a regtest round-trip and our own test vectors before relying on it for value.

7. **FROST is held in reserve.** FROST is the only option that gives k-of-n at MuSig2's on-chain cost (a single Schnorr key-path signature), so it is the upgrade path if the tapscript fallback's witness bloat proves painful in practice. It is not adopted now: it requires a DKG and secret-share custody (a major departure from the independent-key model of [ADR 038](038-musig2-key-custody.md)), the available implementation is unaudited, the Bitcoin BIPs are drafts, and the `@noble/curves` v1.9.7-versus-v2.0.1 split in the dependency tree must be resolved first. Revisit gated on an audit and the BIPs settling.

8. **Non-inclusion becomes a pure data-commitment concern.** Because the hybrid handles liveness directly, "a member with no update this round" is no longer entangled with signing: such a member is simply absent from the CAS Announcement Map, or carries a non-inclusion leaf (`SHA-256(SHA-256(nonce))`, see [ADR 036](036-zero-hash-smt-model.md) and [ADR 041](041-cooperative-non-inclusion-signaling.md)) in the SMT. That data-layer work (the `SUBMIT_NONINCLUDED` message, the response gate, the slotted SMT tree) carries forward from the superseded ADR 041, proceeds underneath this output, and no longer needs any "defer because n-of-n" rationale.

### Rejected alternatives

- **Pure tapscript k-of-n (option B) as the default.** It pays the roughly 6 to 10 times witness cost and leaks the full cohort membership, the policy, and which members signed on every spend, even when everyone cooperates, which defeats the on-chain amortization that is the entire point of aggregation. The hybrid pays that cost only on the rare fallback.
- **FROST now (option C).** The right cryptographic answer to liveness at no on-chain cost, but the DKG and secret-share custody break the independent-key, self-custody model the subsystem is built on, membership churn requires re-sharing, the only in-stack implementation is unaudited, and the Bitcoin BIPs are unsettled. Held in reserve, not adopted.
- **MuSig2 plus recovery without the k-of-n leaf (option A) as the end state.** It recovers funds but never delivers graceful announcement liveness: a single defector still blocks the optimistic path and the cohort must wait out the timelock. Adopted as increment 1, not as the destination.
- **Removing a non-cooperating member from the cohort.** Changes the aggregate key and the beacon address, stranding the funded UTXO, and under n-of-n the member's signature is still required. The fallback leaf is the in-cohort way to tolerate them.
- **Participant-funded recovery now.** Deferred. The advertised `fundingModel` field and the recovery-policy seam are reserved so it is an additive change later.

## Consequences

**Positive**
- Funds are never permanently locked (the recovery leaf), the rare defector no longer freezes the cohort (the k-of-n fallback), and the common all-cooperate case keeps MuSig2's cheap, private, flat-in-n key-path spend.
- Independent-key custody ([ADR 038](038-musig2-key-custody.md)) is preserved, with no FROST or DKG, and the fallback path is even HSM/KMS-drivable.
- Buildable on the current stack (`@scure/btc-signer@1.8.1`) with no new cryptographic dependency.
- The funding model is an advertised, extensible cohort condition, so participant-funded recovery is an additive future change rather than a re-architecture.

**Negative**
- The beacon output format changes from key-path-only to internal-key plus a script tree, and the MuSig2 tweak must include the Merkle root. This is correctness-critical: a wrong tweak silently breaks the key-path signature. Address derivation, funding, and membership validation all move to the new output.
- All spend-path parameters (k, n, the participant keys, the timelock delay, the recovery key) are committed at funding time; changing any of them requires moving funds to a new address. The cohort-conditions model is per-epoch flexible, but the on-chain output freezes these parameters for the life of each UTXO.
- New protocol surface: a path-selection cascade that must not sign two paths for one UTXO, a fallback signature-collection round, recovery sequence and locktime plumbing, and fee/vsize handling for the script-path witness shapes.
- `p2tr_ms` is flagged experimental by the library; it needs our own test vectors and a regtest spend before it carries mainnet value.

**Accepted**
- v1 is operator-funded only; participant-funded is reserved (the field and the seam) and not implemented now. Under operator-funded recovery the operator could grief by waiting out the timelock, but it only wastes its own capital, so operator-only recovery is correct for this funding model.
- Delivery is two increments; increment 1 ships fund-recovery without graceful liveness.
- FROST is deferred, with the unaudited module, the draft BIPs, and the `@noble/curves` version split as the revisit-gates.
- This diverges from the specification's RECOMMENDED MuSig2 example, which is explicitly permitted because that example is illustrative and the full protocol is out of scope. Worth surfacing to the spec maintainers as a fault-tolerant variant.

## References

- [`packages/method/src/core/aggregation/cohort.ts`](../../packages/method/src/core/aggregation/cohort.ts): `computeBeaconAddress` (the key-path-only `p2tr(aggPubkey, undefined, ...)` to replace with a script tree) and the `tapTweak` (the key-only tweak to recompute with the Merkle root).
- [`packages/method/src/core/aggregation/signing-session.ts`](../../packages/method/src/core/aggregation/signing-session.ts): the MuSig2 `Session` tweak argument that must carry the Merkle-root-bearing tweak.
- [`packages/method/src/core/beacon/beacon.ts`](../../packages/method/src/core/beacon/beacon.ts): `buildAggregationBeaconTx` and the key-path vsize assumptions, to extend with the fallback and recovery spend builders and their fee handling.
- `@scure/btc-signer@1.8.1`: `p2tr(internalKey, tree)`, `p2tr_ms` (k-of-n `OP_CHECKSIGADD` leaf), the `OP.CHECKSEQUENCEVERIFY`/`OP.CHECKLOCKTIMEVERIFY` opcodes, `TaprootControlBlock`, and the script-path `preimageWitnessV1(..., leafScript, leafVer)` sighash, all already present.
- BIP-340 (Schnorr), BIP-341 (Taproot key-path and script-path, the TapTweak with Merkle root, the control block), BIP-342 (Tapscript and `OP_CHECKSIGADD`), BIP-327 (MuSig2), BIP-65 (CLTV), BIP-68 and BIP-112 (relative timelocks via `nSequence` and `OP_CHECKSEQUENCEVERIFY`). Prior art for optimistic-cooperative-with-fallback Taproot: Lightning simple-taproot channels, Ark VTXO unilateral exit, BitGo MuSig2 wallets, Bitcoin vaults.
- [ADR 008](008-aggregation-subsystem-inception.md): the cohort trust model. [ADR 017](017-optimized-smt-core-primitive.md): the SMT primitive that already supports non-inclusion. [ADR 037](037-single-party-beacon-and-two-axis-model.md): the broadcast-mode axis this refines. [ADR 038](038-musig2-key-custody.md): the independent-key custody model preserved here. [ADR 039](039-cohort-condition-model.md): the advertised cohort conditions the `fundingModel` field joins, and the advertise-only economics. [ADR 040](040-multi-cohort-service-runner.md): the multi-cohort runner this output runs underneath. [ADR 041](041-cooperative-non-inclusion-signaling.md): superseded here for the liveness framing; its non-inclusion data-commitment design carries forward.
