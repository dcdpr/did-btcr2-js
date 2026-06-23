---
title: "ADR 043: k-of-n Fallback Signing Protocol for Aggregate Beacons"
---

# ADR 043: k-of-n Fallback Signing Protocol for Aggregate Beacons

**Status:** Accepted

**Date:** 2026-06-24

**Branch / PR:** `feat/aggregation-non-inclusion`

**References:** [ADR 027](027-aggregation-security-hardening.md), [ADR 038](038-musig2-key-custody.md), [ADR 039](039-cohort-condition-model.md), [ADR 040](040-multi-cohort-service-runner.md), [ADR 041](041-cooperative-non-inclusion-signaling.md), [ADR 042](042-fault-tolerant-beacon-output.md)

## Context

[ADR 042](042-fault-tolerant-beacon-output.md) replaced the key-path-only aggregate beacon output with a hybrid Taproot output: an internal key (the cohort's n-of-n MuSig2 aggregate) committing to a script tree of a k-of-n fallback leaf (leaf A, a BIP-342 `OP_CHECKSIGADD` multisig) and a CSV recovery leaf (leaf B). ADR 042 delivered the first increment (the recovery leaf, the Merkle-root tweak, and the recovery spend) and specified the second: add leaf A and the path-selection cascade so that when the optimistic n-of-n key path stalls, any k present members can still complete the announcement.

ADR 042 fixed the on-chain output shape and the funding model but deliberately left the **runtime protocol** for the fallback unspecified: how k is chosen and advertised, how members authorize the fallback spend, how the coordinator assembles it, and how the cohort guarantees it never finalizes two competing spends of its single UTXO. This ADR records those decisions, made while implementing the fallback increment, plus two output-construction facts that the fallback (and the existing optimistic path) depend on for an on-chain-spendable transaction.

The threat model is unchanged from [ADR 027](027-aggregation-security-hardening.md) and [ADR 038](038-musig2-key-custody.md): the coordinating service is untrusted (it never holds a signing secret and only aggregates public material), individual cohort members may defect or go offline, and a member must never be induced to authorize something it did not agree to.

## Decision

### 1. The fallback threshold k is an advertised cohort condition, defaulting to n-1

k is added to the cohort conditions of [ADR 039](039-cohort-condition-model.md) as an optional `fallbackThreshold`. When a cohort advertises it, it is validated as a positive integer not exceeding the advertised maximum participant count; the binding upper bound against the actual finalized cohort size n is enforced when the beacon address is computed (k must be in `[1, n]`). When unadvertised, k resolves to `max(1, n-1)`: tolerate one missing or defecting signer, the smallest useful fallback witness. The service and every participant resolve k from the same advertised-or-default rule against the same n, so all parties derive the identical script tree and beacon address. k is part of what the funded address commits to: a different k is a different leaf A and a different address.

### 2. Leaf A is a `p2tr_ms` over the BIP-327-sorted x-only cohort keys, in a fixed leaf order

Leaf A is built from the cohort's own independent BIP-340 keys (no new key material, consistent with [ADR 038](038-musig2-key-custody.md)): the compressed cohort keys are sorted per BIP-327 (the same ordering the MuSig2 internal key uses) and reduced to x-only, and `p2tr_ms(k, xOnlyKeys)` produces the k-of-n `OP_CHECKSIGADD` leaf. The script tree's leaf order is canonical: fallback (leaf A) then recovery (leaf B). For the current two-leaf tree the Merkle root is invariant to leaf order (a TapBranch sorts its two child hashes), but fixing the order keeps the construction deterministic and reviewable and is consensus-affecting should the tree ever grow past two leaves, so the order is asserted at the single seam that builds the leaves.

### 3. Fallback signing is a dedicated two-message exchange of standalone signatures, with no nonce round

The fallback uses two new messages distinct from the MuSig2 step:

- **Fallback authorization request** (service to members): carries the unsigned announcement transaction, the spent output's script and value, and the fallback leaf script. The service reuses the in-flight signing session's transaction, so the announcement and all its outputs are identical to the optimistic attempt; only the witness path differs.
- **Fallback signature** (member to service): a single standalone BIP-340 signature over the BIP-341 script-path sighash (`SIGHASH_DEFAULT`, leaf version 0xc0), plus the signer's x-only key.

Unlike MuSig2, a script-path `OP_CHECKSIGADD` signature is an independent per-signer signature, so there is **no nonce-commitment round**: a member signs in one shot. The coordinator collects signatures, binds each to its sender (the signature must verify against the sighash and the carried key must be the sender's own cohort key), and once it holds k valid distinct signatures it assembles the witness. A `k`-of-`n` `OP_CHECKSIGADD` leaf is satisfied by **exactly k** signatures (the trailing `<k> NUMEQUAL` fails for any other count), so the assembler injects exactly k and the coordinator holds no signing secret at any point. This per-signer one-shot signature is also HSM/KeyManager-drivable, the property [ADR 038](038-musig2-key-custody.md) found impossible for MuSig2.

Two new protocol phases mark the fallback on each side (a service "fallback requested" phase and a participant "awaiting fallback signature" phase), siblings of the existing signing phases.

### 4. A single committed path per UTXO, enforced by a latch set only after the state machine accepts the transition

The optimistic key-path spend and the fallback script-path spend are two valid spends of the **same** beacon UTXO; broadcasting both is a double-spend attempt. The coordinator's runner therefore commits each cohort to exactly one path. The commitment is a latch on the cohort's run context:

- Triggering the fallback first asks the state machine to transition (which is synchronous and rejects if signing has not started), and only on success sets the latch, still before any asynchronous send. A rejected transition (for example a premature operator request before signing) leaves the latch untouched, so the optimistic path remains free to complete. The latch must never be set speculatively ahead of a transition that can fail, or a valid optimistic completion would be silently stranded.
- The optimistic completion handler stands down if the cohort has already committed to the fallback, and otherwise marks itself the committed path before resolving. The state machine's own phase guards already prevent a late optimistic signature from completing once the fallback round has begun; the latch is the coordinator-side guarantee at the broadcast boundary.

A member that already contributed its optimistic partial signature (and is locally "complete") is still allowed to sign the fallback: the cohort has not finalized (the coordinator only falls back before optimistic completion), those members are exactly the k the fallback needs, and signing both authorizes the same outputs of which at most one witness can ever confirm. The trigger may be driven by an operator decision or wired to the per-cohort stall timer of [ADR 040](040-multi-cohort-service-runner.md); falling back on stall is opt-in, since it trades the cheaper, more private key-path spend for the larger fallback witness.

### 5. A member signs only a transaction that anchors the signal it validated

Both signing approvals (the optimistic nonce approval and the fallback approval) sign with `SIGHASH_DEFAULT`, which commits to every output, while the untrusted coordinator drives output selection. A member therefore refuses to sign unless the transaction carries an `OP_RETURN` output whose 32-byte payload equals the signal the member validated when the aggregated data was distributed. This binds the member's signature to the exact announcement it approved (the CAS Announcement Map hash or the SMT root), so a coordinator cannot collect signatures and then anchor a different signal (a stale one, or one whose root omits a victim's update) under those signatures. The member also recomputes the fallback leaf from its own cohort state rather than trusting the leaf script in the request, binding the script path as well as the outputs. The check is applied to **both** approvals so the optimistic and fallback paths offer the same guarantee.

### 6. The aggregation result names its spend path

The final result distinguishes the two outcomes: a key-path result carries the aggregated MuSig2 signature, and a script-path result carries the finalized fallback transaction (whose witness embeds k separate signatures, with no single aggregate signature). Callers that broadcast the result therefore know which path was taken without inspecting the witness.

### 7. The funded output script is derived from the funded address, and the beacon transaction is parsed permissively

Two construction facts the fallback (and the optimistic path) require for an on-chain-spendable transaction:

- The transaction's spent-output script must be the script-tree scriptPubKey the cohort actually funded, derived from the funded beacon address, not a key-path-only output recomputed from the internal key. A key-path-only script would not match the funded UTXO and would invalidate both the key-path sighash and the fallback script-path sighash.
- A beacon transaction carries an `OP_RETURN` signal output, which is not a standard spendable output type, so re-parsing a serialized beacon transaction must permit unknown outputs.

These correct the integration of [ADR 042](042-fault-tolerant-beacon-output.md)'s script-tree output into the transaction builder and the participant's re-parse; they were latent because the only signing path exercised against funded UTXOs to date does not use the MuSig2 aggregate output.

## Consequences

- **Liveness without permanent cost.** The common case is unchanged: a cheap, private n-of-n key-path spend. The fallback's larger witness is paid only when the optimistic round stalls. Funds remain recoverable via leaf B even when k cannot be reached.
- **The beacon address changes once more.** Adding leaf A changes every aggregate beacon's script tree and therefore its address, on top of the change from [ADR 042](042-fault-tolerant-beacon-output.md). Both land in a single breaking release so the address derivation stabilizes once.
- **Custody is unchanged.** Independent keys throughout; the coordinator holds no secret on either path. The fallback per-signer signature is additionally HSM-drivable.
- **The output-signal binding hardens both paths.** Members now refuse a transaction that does not anchor their validated signal, closing a coordinator-driven output-substitution vector on the optimistic path as well as the new fallback path.
- **k is a published cohort property.** Joining members see k in the advert and can decline a cohort whose fallback tolerance they dislike.

## Rejected alternatives

- **A nonce round for the fallback (MuSig2-style aggregation of the k signatures).** Unnecessary: `OP_CHECKSIGADD` verifies independent per-signer signatures, so a single standalone signature per member suffices. A nonce round would add a round trip and reintroduce the MuSig2 nonce-reuse hazard for no benefit.
- **Letting the coordinator choose any k of the collected signatures, accepting more than k.** A k-of-n `OP_CHECKSIGADD` leaf is satisfied by exactly k signatures; supplying more fails `NUMEQUAL`. The assembler injects exactly k.
- **Committing to the fallback path before the state-machine transition succeeds.** Setting the latch speculatively strands a valid optimistic completion if the transition is rejected (for example a premature trigger). The latch is set only after the transition is accepted.
- **Trusting the leaf script and outputs supplied in the fallback request.** A member recomputes the leaf from its own cohort and requires the transaction to anchor its validated signal, so a malicious coordinator cannot redirect the signature to a different script or a different announcement.
- **Per-cohort separate fallback keys or a DKG (FROST).** Held in reserve by [ADR 042](042-fault-tolerant-beacon-output.md); the fallback reuses each member's existing independent key, preserving the [ADR 038](038-musig2-key-custody.md) custody model.
