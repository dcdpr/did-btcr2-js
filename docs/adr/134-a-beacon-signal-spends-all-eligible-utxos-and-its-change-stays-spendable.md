# ADR 134: A Beacon Signal Spends All Eligible UTXOs of the Beacon Address, and Its Change Stays Spendable

- **Status:** Accepted
- **Date:** 2026-09-30
- **Packages:** `@did-btcr2/method` (MINOR, breaking: removed exports and the shape of `BeaconTxPlan`), `@did-btcr2/api` (PATCH), `@did-btcr2/aggregation` and `@did-btcr2/cli` (PATCH, dependency uptake)

## Context

A single-party beacon signal (singleton, CAS, or SMT beacon) spends UTXOs of the beacon address. `selectSpendableUtxo` (ADR 063) chose one confirmed UTXO with a value above 546 sats (`SPENDABLE_DUST_LIMIT_SATS`), deepest first. The builder spent that one UTXO and refused the signal if its value did not cover the fee.

A demo test on mutinynet (2026-09-29) found three problems.

1. **One input for each signal.** A beacon address held 2 confirmed UTXOs of 500 sats. Neither UTXO passed the 546-sat floor, and one input cannot spend both. The update failed, but the user had funded the address.
2. **The error dropped the reason.** With no `beaconId`, the api derives the beacon (ADR 104). The derivation called `selectSpendableUtxo` for each beacon, discarded each `BeaconError`, and then said `No beacon of DID ... holds a spendable UTXO`. The user could not see why the 2 UTXOs did not count.
3. **Stranded change.** The builders create a change output at or above `DUST_LIMIT_SATS` of its kind (p2pkh 546, p2wpkh 294, p2tr 330). The selector spent only a UTXO above 546. Two updates spent a 2000-sat UTXO at a p2wpkh beacon: 2000 - 775 - 775 = 450. The builder created the 450-sat change output (450 >= 294), and no later signal could spend it (450 <= 546).

The funding guard of the api (ADR 102) had one more gap. It called the selector with no fee rate. An address that had a spendable UTXO but not enough value for the fee passed the guard. The beacon then refused at the broadcast, after the CAS publication. ADR 102 puts the refusal before any publication.

### Specification position

The specification sets no rule for the inputs of a beacon signal. The non-normative section "Funding a Beacon Signal" (`src/operations/update.md`) takes `prevouts` (plural): "One of them is a UTXO that the Beacon Address controls." The resolver reads each `vin` of a signal (`signal-discovery.ts`), so a signal with several inputs resolves. ADR 063 gives no reason for one input. The input rule is thus a local policy.

## Decision

### One function gives the rule

`selectBeaconFunding(utxos, { beaconAddress, network, feeEstimator?, changeAddress?, maxInputs? })` in `packages/method/src/core/beacon/beacon.ts` selects the UTXOs, the vsize, the fee, and the change. It returns `{ utxos, kind, changeAddress, changeKind, vsize, valueSats, feeSats, changeSats }`. It is deterministic for one UTXO set and one fee rate. The rule needs the fee rate, and the `FeeEstimator` interface gives only `estimateFee(vsize)`, so the function is async. These callers use it:

| Caller | Package |
|--------|---------|
| `SinglePartyBeacon.buildSignAndBroadcast` (through `fetchBeaconFunding`) | method |
| `buildAggregationBeaconTx` (with `maxInputs: 1`) | method |
| The `NeedFunding` guard of `DidMethodApi.update` | api |
| `#deriveBeaconId` of `DidMethodApi` | api |

### A UTXO is eligible if it adds value

A UTXO is eligible if both conditions are true:

1. It is confirmed (ADR 063 stays).
2. Its value is more than the fee of its own input: `estimateFee(BEACON_INPUT_VBYTES[kind])`.

An eligible UTXO always adds value to the transaction. The new constant `BEACON_INPUT_VBYTES` gives the conservative size of one more input:

| Kind | vB | Size |
|------|----|------|
| p2pkh | 149 | 36 outpoint + 1 length + 108 scriptSig (a 72-byte DER signature with its sighash byte, a 33-byte public key, 2 push bytes) + 4 sequence |
| p2wpkh | 69 | 41 non-witness bytes (164 WU) + 109 witness bytes = 273 WU, rounded up |
| p2tr | 58 | 41 non-witness bytes (164 WU) + 66 witness bytes (stack count, length, 64-byte signature) = 230 WU, rounded up |

`beaconTxVsize(kind, changeKind, inputs = 1)` adds `(inputs - 1) * BEACON_INPUT_VBYTES[kind]`. For 1 input, the value does not change, so the existing vsize constants and their tests stay.

This decision removes `SPENDABLE_DUST_LIMIT_SATS`. A fixed floor does not follow the fee rate. At 1 sat/vB a 500-sat p2wpkh UTXO adds 431 sats. At 10 sat/vB a 600-sat p2pkh UTXO adds nothing (its input costs 1490 sats).

### The signal spends all eligible UTXOs, up to 20

The transaction spends each eligible UTXO. The limit is `MAX_BEACON_TX_INPUTS = 20`. If more UTXOs are eligible, the transaction spends the 20 of the largest value. The ADR 063 order breaks a tie in value. The inputs sit in the transaction in the ADR 063 order: deepest first, then txid, then vout.

The reasons for all eligible UTXOs:

- Each eligible input has a positive effective value, so it only makes the change larger.
- The address converges to one UTXO: the change of the last signal.
- A UTXO that a signal leaves at the address can become useless if the fee rate rises. A signal that spends it now, at a lower rate, keeps its value.
- Inside the limit, the selection has the maximum total value. The rule thus fails only if no selection inside the limit can cover the fee.
- The largest-value cut stops an attacker who sends many small, deep UTXOs to the address. Those UTXOs cannot push a large UTXO out of the selection.

The reasons for the limit of 20:

- The builder reads the previous transaction of each input (PSBT `nonWitnessUtxo`). That is one REST request for each input. At the mutinynet limit of about 2 requests per second, 20 inputs take about 10 seconds.
- The input count stays below 253, so its varint stays 1 byte. `beaconTxVsize` assumes 1 byte, so it stays an upper bound.
- The worst transaction (p2pkh inputs, p2tr change) is 3080 vB. The standardness limit is 100000 vB.

### The total value must cover the fee

The total value of the selected UTXOs must be more than `estimateFee(beaconTxVsize(kind, changeKind, n))` for `n` inputs. The strict comparison of the old `value <= feeSats` guard stays.

### A change output is always spendable later

The transaction has a change output only if the change is at least the change floor:

```
changeFloor = max(DUST_LIMIT_SATS[changeKind], estimateFee(BEACON_INPUT_VBYTES[changeKind]) + 1)
```

If the change is below the floor, the remainder goes to the fee. A change output is thus eligible under the rule above at the same or a lower fee rate. At 5 sat/vB the floors are p2pkh 746, p2wpkh 346, and p2tr 330 sats. At 1 sat/vB they are the dust limits.

This guarantee applies to the address that gets the change. If the caller names a change address (ADR 044), the change goes there, and a signal of this beacon does not spend it. The floor still uses the kind of that address, so the output is not dust and not useless at that rate.

`BeaconFunding.changeSats` is `0n` if the transaction has no change output. `feeSats` is the estimate. The remainder that goes to the fee is not in it.

### Each error gives its reason

`selectBeaconFunding` throws a `BeaconError`. The message is `Beacon address <address> cannot fund a signal: <reason>.`, and `data.reason` holds the reason with no address.

| Type | Condition | Reason, for example |
|------|-----------|---------------------|
| `UNFUNDED_BEACON_ADDRESS` | The address has no UTXO. | `no UTXOs` |
| `NO_SPENDABLE_BEACON_UTXO` | No UTXO is eligible. | `2 UTXOs, none confirmed`, or `2 confirmed UTXOs, each at or below the fee of its own input (345 sats)` |
| `INSUFFICIENT_FUNDS` | The selected UTXOs do not cover the fee. | `2 spendable UTXOs, total value 1000 sats, fee 1120 sats (224 vB)` |

The data also holds the counts and the sats as numbers, so it is safe for JSON.

### The aggregation path keeps one input

`buildAggregationBeaconTx` calls the same function with `maxInputs: 1`. Each input has its own sighash, so each participant of the cohort must give one MuSig2 nonce and one partial signature for each input. Several inputs there need a change to the protocol, and this decision does not make it.

With `maxInputs: 1`, the aggregation builder spends the eligible UTXO of the largest value, not the deepest one. The largest value is the one input with the best chance to cover the fee.

### The api applies the rule with the fee rate of the broadcast

The guard and the derivation call `selectBeaconFunding` with the network of the Bitcoin connection, the fee estimator of the broadcast (after the `announce.feeRate` conversion, else `DEFAULT_FEE_ESTIMATOR`), and `announce.changeAddress`. The api converts only the three funding errors of the table above. Any other error (for example `INVALID_CHANGE_ADDRESS`) passes through unchanged.

- The guard keeps its empty-listing message. For a funding error, it throws `UpdateError` `INVALID_DID_UPDATE`: `Beacon address <address> cannot fund this update: <reason>. Before you broadcast the update, wait for a confirmation, fund the address, or set a lower `announce.feeRate`.` The data is `{ beaconAddress, utxos, reason }`.
- The derivation names each beacon, its address, and its reason. The message gives each id relative to the DID, which it names once. The data holds the full ids.

For the case of item 1 of the context, at the default 5 sat/vB, the message is one line. The lines below break it for the page:

```
No beacon of DID did:btcr2:k1q5p0kkmsh8nzcsp3p78zjjk99ueln4kvvltel8p6pmttqj26zt25zpcmln4eh can fund
the signal. The api cannot derive beaconId. #initialP2PKH (mwm9XdtfwXmu8VDiP9dinaZZLb6LTU4mci): no UTXOs;
#initialP2WPKH (tb1qkgcnd0d600pl4gjm7935kjwdlj7uc6s2lwnn26): 2 spendable UTXOs, total value 1000 sats,
fee 1120 sats (224 vB); #initialP2TR (tb1peu06twljsmunv5fuqgv2dt7y753m7wzsdkx6lfx3ectaacamwq4qeleflj):
no UTXOs. Wait for a confirmation, fund one beacon address, or set a lower `announce.feeRate`.
```

The data is `{ did, beacons: [{ id, type, address, reason }] }`. With `announce.feeRate: 1` the same address funds the update: 2 inputs, 224 vB, fee 224 sats, change 776 sats.

If several beacons can fund the signal, the message is `N beacons of DID <did> can fund the signal: <ids>. Pass beaconId to choose which one spends.`

## Relation to earlier ADRs

- **ADR 063** (beacon UTXO selection). This decision keeps the confirmation rule, the deterministic order, and the distinct error types. It replaces the fixed 546-sat floor with the fee of the input, and one input with all eligible inputs. `selectSpendableUtxo` and `SPENDABLE_DUST_LIMIT_SATS` are removed.
- **ADR 044** (beacon change output). The change destination does not change: the beacon address, or the caller's `changeAddress`. The change output stays before the OP_RETURN signal. The condition for a change output now includes the fee of the input that spends it later, not only the dust limit.
- **ADR 102** (the funding guard applies the spendability rule). The guard still calls the rule of the beacon and does not copy it. The rule now includes the fee, so the guard gets the fee estimator and the change address. A fee shortfall now fails at the guard, before any CAS publication, not at the broadcast. The derivation of ADR 104 uses the same call.

## Alternatives

- **The fewest UTXOs that cover the fee (largest first).** The fee of each signal is lower. But the small UTXOs stay at the address, and a rise in the fee rate can make them useless. The address never converges.
- **No input limit.** A beacon address with many small UTXOs gives a large transaction and many REST requests. Past 252 inputs the vsize formula is too small by 2 bytes.
- **Keep a fixed spendable floor, and set it to the dust limit of the kind.** A fixed floor ignores the fee rate. At a high rate, a UTXO just above the floor costs more than it adds. At a low rate, the floor refuses UTXOs that add value.
- **A fixed change floor of 546 sats for all kinds.** It closes the gap at the default rate for p2wpkh and p2tr. It does not follow the fee rate, so a rise in the rate strands the change again.
- **Several inputs on the aggregation path.** It needs one nonce and one partial signature per input from each participant. That is a change to the aggregation protocol, outside this decision.
- **The rule in the api.** ADR 102 rejects a copy of the rule in the facade. A copy can drift from the builder.

## Consequences

**Positive.**

- A beacon address with several small confirmed UTXOs funds a signal if their total covers the fee. The demo case of 2 UTXOs of 500 sats funds an update at 1 sat/vB.
- A change output that a signal creates is eligible for a later signal at the same or a lower fee rate. No stranded change.
- The derivation error names the reason for each beacon, in the message and in the data.
- The guard, the derivation, and the builder apply one rule with the same fee rate. A fee shortfall fails before the CAS publication.
- The address converges to one UTXO, so the next signal needs fewer REST requests.

**Negative.**

- A signal that consolidates pays more fee now: one input fee for each extra UTXO.
- A signal spends all eligible UTXOs of the beacon address, also UTXOs that the user did not plan to spend. A user who wants to keep a UTXO must keep it at another address.
- The inputs link all UTXOs of the address in one transaction. They are at one address already, so the link adds little.
- `@did-btcr2/method` removes `selectSpendableUtxo` and `SPENDABLE_DUST_LIMIT_SATS`. `BeaconTxPlan.utxo` is now `utxos`. The protected `buildSinglePartyTx` is synchronous and takes `{ signalBytes, beaconAddress, funding, prevTxs, signer, network }`. This is a breaking change of method (MINOR at 0.x).
- An invalid `announce.changeAddress` now fails at the guard or the derivation, before any CAS publication. Before, it failed at the broadcast.

**Neutral.**

- A signal with one eligible UTXO gives the same transaction as before, with one exception: the change floor can now send a small change to the fee. At 5 sat/vB, a p2wpkh change from 294 to 345 sats goes to the fee, and a p2pkh change from 546 to 745 sats goes to the fee.
- The default fee rate stays 5 sat/vB (ADR 132).

## Implementation

- `packages/method/src/core/beacon/beacon.ts`: `selectBeaconFunding`, `BeaconFunding`, `BeaconFundingOptions`, `BEACON_INPUT_VBYTES`, `MAX_BEACON_TX_INPUTS`, the third parameter of `beaconTxVsize`, `fetchBeaconFunding` (reads the previous transactions one at a time), a builder that signs each input, and `BeaconTxPlan.utxos`. `selectSpendableUtxo`, `fetchSpendableUtxo`, and `SPENDABLE_DUST_LIMIT_SATS` are removed.
- `packages/api/src/method.ts`: the `NeedFunding` guard and `#deriveBeaconId` call `selectBeaconFunding`. `FUNDING_ERROR_TYPES` and `isFundingError` select the errors that the api converts.
- Tests with crafted UTXO arrays (`packages/method/tests/beacon-utxo-selection.spec.ts`): 2 x 500 sats at p2wpkh fail at 5 sat/vB with the reason and pass at 1 sat/vB; a UTXO below the fee of its own input is not selected; the order is deterministic; over the limit, the largest 20 are selected; the change floor. `beacon-multi-input.spec.ts` signs and checks a transaction with 2 inputs of each kind. `packages/api/tests/did-method-api-cas-policy.spec.ts` checks the text and the data of the guard and the derivation errors, and that `announce.feeRate` reaches the rule.
