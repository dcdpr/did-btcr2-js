---
title: "ADR 063: Harden Beacon UTXO Selection (Confirmed, Non-Dust, Deepest-First, Deterministic)"
---

# ADR 063: Harden Beacon UTXO Selection (Confirmed, Non-Dust, Deepest-First, Deterministic)

**Status:** Accepted

**Date:** 2026-07-01

**Branch / PR:** `fix/beacon-utxo-selection`

**References:** [ADR 018](018-beacon-hierarchy.md), [ADR 037](037-single-party-beacon-and-two-axis-model.md), [ADR 044](044-beacon-change-output-address.md), [ADR 056](056-beacon-signal-format-validation.md)

## Context

Every beacon broadcast, single-party and aggregated, funds its signal transaction from a
UTXO at the beacon address. That input was chosen by an internal helper,
`fetchSpendableUtxo` (`packages/method/src/core/beacon/beacon.ts`), shared by
`SinglePartyBeacon.buildSignAndBroadcast` and `buildAggregationBeaconTx`. It selected the
input like this:

```ts
const utxos = await bitcoin.rest.address.getUtxos(bitcoinAddress);
if (!utxos.length) throw new BeaconError('No UTXOs found, please fund address!', 'UNFUNDED_BEACON_ADDRESS', ...);
const utxo = utxos.sort((a, b) => b.status.block_height - a.status.block_height).shift();
```

This picks the **newest** confirmed-or-unconfirmed UTXO (highest block height first) and has
three problems:

1. **It can spend an unconfirmed UTXO.** The Esplora `getUtxos` response includes UTXOs still
   in the mempool (`status.confirmed === false`). A signal built on an unconfirmed input can be
   orphaned by a reorg or invalidated by an RBF replacement of the parent, silently un-anchoring
   the beacon transaction. Nothing filtered these out. The helper's own JSDoc claimed it returned
   "the most recent confirmed UTXO," which the code did not actually do.
2. **It is non-deterministic.** `sort` by block height alone leaves ties (multiple UTXOs in the
   same block, common when an address is funded and used repeatedly) in whatever order the REST
   API happened to return them, and "newest first" changes every time a newer UTXO appears. Two
   independent callers, or the same caller on a retry, could pick different inputs for the same
   address state. For a system whose value proposition is reproducible, verifiable resolution,
   input selection should be a pure function of the address's UTXO set.
3. **It can select a dust UTXO.** A trivially small output (for example the residue of a prior
   change output) could be the newest UTXO and would be selected, then rejected downstream by the
   `value <= feeSats` fee check, even when a larger, older, spendable UTXO was available.

### Specification position

The did:btcr2 specification is silent on beacon UTXO selection and on any confirmation-depth
requirement. This was verified against the beacon construction text (`src/beacons.md`), the
update / broadcast algorithms (`src/operations/update.md`), and the security considerations
(`src/appendix/security-considerations.md`). Only the security considerations touch the subject,
and only to observe that deeper confirmations reduce reorg risk; they set no rule and mandate no
depth. Selection is therefore an implementation policy decision, made here for safety and
reproducibility, not a conformance requirement. (Per the project's source-of-truth convention,
a policy is chosen locally only where the specification is genuinely silent.)

## Decision

### Extract a pure, exported `selectSpendableUtxo`

Selection moves out of the I/O helper into a pure function
`selectSpendableUtxo(utxos, address?): AddressUtxo`, alongside the already-exported
`beaconTxVsize` and `resolveChangeAddress`. `fetchSpendableUtxo` now only performs I/O (fetch
the UTXO set, then fetch the chosen UTXO's parent transaction) and delegates the choice. The pure
function is directly unit-testable with crafted arrays, no Bitcoin mock required, and is the unit
the regression net exercises.

### Require at least one confirmation

`selectSpendableUtxo` keeps only UTXOs with `status.confirmed === true` (a strict equality, so a
UTXO with the flag absent, as Esplora returns for mempool entries, is treated as unconfirmed). A
fixed one-confirmation floor, not a configurable depth, is the meaningful safety line: it is the
boundary between "can be reorganised or RBF-replaced out of existence" and "is in a block." A
deeper, tunable policy is deliberately not added (see rejected alternatives).

### Filter dust with a fixed, conservative floor

UTXOs at or below `SPENDABLE_DUST_LIMIT_SATS` are discarded. This is a **new** exported constant
set to 546, the standard Bitcoin Core P2PKH dust threshold and the largest of the three singleton
beacon script kinds' dust limits (P2PKH 546, P2TR 330, P2WPKH 294), so a surviving UTXO is
non-dust under any beacon address kind. It is a coarse, script-kind-agnostic, fee-estimator-
independent pre-filter that skips trivially small inputs so selection can find a usable one rather
than fixating on a dust output; it is **not** the fee-coverage boundary. Whether a selected UTXO
actually covers the transaction fee remains a separate check against the live `FeeEstimator`, the
`value <= feeSats` guard in `buildSinglePartyTx` and `buildAggregationBeaconTx`, which is
unchanged. At the default 5 sat/vB rate that fee (roughly 775 to 1200 sats across the three
kinds) sits above the dust floor, so the two checks are independent by design.

The pre-existing per-kind `DUST_LIMIT_SATS` record is left untouched; it sizes the *outgoing
change output* by script kind (ADR 044) and is a different concern from bounding the *incoming*
funding UTXO. The new scalar is named `SPENDABLE_DUST_LIMIT_SATS` to keep the two distinct rather
than overloading one symbol.

### Select deepest-first, deterministically

Among the confirmed, non-dust survivors, selection sorts by ascending `block_height` (so the
most-confirmed UTXO comes first), breaking ties by ascending `txid` (`localeCompare`) and then by
ascending `vout`. The result is both the safest input (maximum confirmations) and a total,
stable order: the same address state always yields the same input, independent of REST response
ordering, across retries and across independent resolvers. The function copies the array before
sorting, so the caller's array is not mutated.

### Distinguish "no spendable UTXO" from "unfunded"

An empty UTXO set still throws `BeaconError` with type `UNFUNDED_BEACON_ADDRESS` ("please fund
address"). A non-empty set with no confirmed, non-dust survivor throws a **new** type,
`NO_SPENDABLE_BEACON_UTXO`, whose message distinguishes the all-unconfirmed case from the
all-dust case and whose data carries the counts (`total`, `confirmed`, `dustLimit`). This
replaces the prior code's second, misleadingly-typed `UNFUNDED_BEACON_ADDRESS` throw
("Beacon bitcoin address unfunded or utxos unconfirmed"), which conflated "you have no money"
with "your money is not yet spendable." `BeaconError.type` is a freeform string, so no error-type
union changes.

### Treat the change as a breaking, minor-version change

The helper now rejects inputs it previously accepted: an unconfirmed UTXO, or a UTXO at or below
the dust floor, that the old code would have selected now yields a thrown `BeaconError` instead of
a (frequently doomed) broadcast attempt. Under 0.x semantics (breaking changes signalled by a
minor bump) and the precedent of prior beacon and validation-tightening ADRs, `@did-btcr2/method`
takes a minor bump and this ADR serves as the release note.

## Consequences

- Beacon broadcasts no longer build on unconfirmed inputs, removing a reorg / RBF hazard that
  could silently un-anchor a signal.
- Input selection is a pure, deterministic function of the address's UTXO set. Retries and
  independent resolvers converge on the same input; selection is now unit-testable without a
  Bitcoin mock.
- A caller whose beacon address holds only unconfirmed UTXOs, or only dust, now receives an
  explicit `NO_SPENDABLE_BEACON_UTXO` error (with the reason and counts) instead of a newest-first
  pick that fails later, or a mis-typed "unfunded" error. A genuinely empty address still reports
  `UNFUNDED_BEACON_ADDRESS`.
- `selectSpendableUtxo` and `SPENDABLE_DUST_LIMIT_SATS` become part of the package's public
  surface (via the existing `export *` barrel), giving callers a reusable, testable selector and a
  named dust floor.
- The dust floor is a coarse pre-filter, independent of the fee estimator; the actual fee-coverage
  decision is unchanged and still lives in the transaction builders.
- The aggregation broadcast path (`buildAggregationBeaconTx`) inherits the same hardened selection
  for free, since it shares `fetchSpendableUtxo`.

## Rejected alternatives

- **A configurable confirmation depth (N-confirmations).** The specification mandates no depth,
  and the security-relevant threshold is the step from zero to one confirmation (mempool to
  block). A tunable depth adds API surface and a policy question the method layer should not own; a
  caller that wants a deeper floor can source or pre-filter UTXOs itself. One confirmation is the
  right default and the right fixed rule here.
- **Newest-first or largest-first selection.** Newest-first is what the code did and is
  non-reproducible (a newer UTXO changes the choice) and links each spend to the freshest change
  output. Largest-first optimises fee headroom but is likewise unstable under ties and unrelated to
  safety. Deepest-first maximises confirmations (the safest input) and, with the txid/vout
  tie-break, is fully deterministic.
- **Reusing the per-kind `DUST_LIMIT_SATS` record for input filtering.** That record is keyed by
  the *change output's* script kind and encodes a different decision (whether to emit change).
  Selection is kind-agnostic (it sees only `value`), so a single conservative scalar, the largest
  of the three limits, is clearer and guarantees the survivor is non-dust under any beacon kind.
  Overloading one symbol for both the incoming-UTXO floor and the outgoing-change floor would
  couple two unrelated policies.
- **No dust filter, relying solely on the downstream fee check.** Without an upfront skip, a
  deepest dust UTXO would be selected and the broadcast would throw `INSUFFICIENT_FUNDS` even when
  a shallower, spendable UTXO existed at the same address. The dust filter lets selection pass over
  trivially small inputs and find a usable one.
