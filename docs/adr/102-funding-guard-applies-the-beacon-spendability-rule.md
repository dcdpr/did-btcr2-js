# ADR 102: The funding guard applies the beacon's spendability rule

- **Status:** Accepted
- **Date:** 2026-09-03
- **Packages:** `@did-btcr2/api`

## Context

`DidMethodApi.update` drives the sans-I/O `Updater` state machine from the method package. In the Fund phase, the machine emits `NeedFunding` with the beacon address. The facade fulfils the need with one check: the address must list at least one UTXO. Any UTXO passes the check.

The beacon does not spend any UTXO. The method package's `selectSpendableUtxo` (ADR 063) spends only a confirmed UTXO with a value above the 546-sat dust limit. An unconfirmed input is not safe against a reorg or a replacement. If no UTXO satisfies the rule, the beacon throws `NO_SPENDABLE_BEACON_UTXO`.

The two rules disagree on the most common state of the fund step: the faucet transaction is in the mempool and not yet confirmed. The facade reports the address as funded and continues to the Broadcast phase. Under `publishToCas` `'auto'` or `'always'`, the facade publishes the signed update to the CAS before the spend, and for a CAS beacon it hands the announcement callback to the beacon (ADR 070, ADR 071). The beacon then throws. The signed update is on the CAS with no signal that points to it, and the user reads a beacon error for a problem the facade said was absent.

The Sign phase precedes the Fund phase, so no funding check can save the signature. The check can save the publication, and it can name the reason at the layer the user calls.

## Decision

**The funding guard applies the beacon's rule through the beacon's own selector.** After the existing empty-listing check, the guard calls `selectSpendableUtxo` on the listed UTXOs. If the selector throws a `BeaconError`, the guard throws an `UpdateError` of type `INVALID_DID_UPDATE`. The message names the beacon address, carries the selector's sentence (all UTXOs unconfirmed, or all confirmed UTXOs at or below the dust limit), and tells the caller what to do next. The error data carries the address and the UTXO count. Any other throw from the selector passes through unchanged, so a malformed listing does not read as a funding problem.

**The empty listing keeps its own message.** The selector also throws for an empty listing, but the facade's message tells the caller to send BTC to the address. That check stays in front of the selector call, and its message does not change.

**The facade calls the rule; it does not copy it.** This decision rejects a local copy of the filter that uses the exported dust constant. A copy can drift from the beacon's rule. The selector is the single source of the policy, and the guard is one more caller of it.

**The guard stays at the facade.** This decision rejects two other placements. The first removes the facade check and lets the beacon throw. That placement keeps the orphaned CAS publication. The second moves CAS publication after the on-chain broadcast. That order contradicts ADR 070 and ADR 071: publication before the spend keeps the beacon UTXO intact if the CAS fails, and content addressing makes a retry safe. The guard is the one placement that keeps the publication order and gives the reason first.

## Scope boundary

**The facade does not pass a `FundingProof`.** The `Updater` accepts an optional proof with a UTXO count. The proof asserts only that the count is at least one, so it adds nothing to the guard. The facade continues to provide the need without a payload.

**The rule itself is unchanged.** The confirmation requirement and the dust limit belong to the method package (ADR 063). This decision changes which layer applies them first, not what they are. The beacon still selects its own input at broadcast from a fresh listing.

**The cli inherits the guard.** Its `update` and `deactivate` commands call `DidMethodApi.update()` directly, so they receive the new refusal and its message.

**Documentation is part of the branch-wide sync.** The api demo quotes the beacon's sentence as the error a user sees if the update runs too early, and says the broadcast path refuses. The funding guard now refuses first, and the message the user sees wraps that sentence. The branch's documentation pass updates the quote and the troubleshooting row.

## Consequences

**Positive.** An update on a funded but unspendable address fails at the guard, before any CAS publication, with the beacon's reason. The message tells the user to wait for a confirmation or to fund the address above the dust limit. The facade and the beacon agree on what "funded" means.

**Negative.** Behaviour changes for a caller whose address listed only unconfirmed or dust UTXOs. That call already failed inside the beacon. It now fails earlier, with a different error type and message. The change is part of the api MINOR that this branch already takes. The changeset names the change.

**Neutral.** An address with at least one confirmed UTXO above the dust limit sees no change. A UTXO that confirms between the guard and the broadcast is still eligible at the broadcast, because the beacon reads a fresh listing there.

## Implementation

- `packages/api/src/method.ts`: the `NeedFunding` handler calls `selectSpendableUtxo` after the empty-listing check and wraps a `BeaconError` in an `UpdateError`. The `update()` documentation gains a Funding bullet.
- Tests: an unconfirmed-only address is refused under `publishToCas` `'always'` with a writable CAS, before any publication and with the documented type and data. A dust-only address is refused with the dust limit named. An empty listing keeps the unfunded message. A confirmed UTXO listed after an unconfirmed one proceeds to broadcast.

## References

- ADR 063 (harden beacon UTXO selection): the spendability rule the guard now applies.
- ADR 070 (CAS publication precedes the on-chain spend) and ADR 071 (CAS publication policy for the api update path): the ordering that makes the earlier guard matter.
- ADR 094 (deactivation is an ordinary update) and ADR 100 (update path refuses a deactivated source): the write paths that pass through `update()` and inherit the guard.
- `docs/api-crud-review-2026-09-01.md`: the second-round review that surfaced this, as gap G11.
