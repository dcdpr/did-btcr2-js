# ADR 143: The Beacon Transaction Checks Each UTXO Against Its Previous Transaction

- **Status:** Accepted
- **Date:** 2026-10-08
- **Packages:** `@did-btcr2/method` (PATCH: the beacon transaction refuses a UTXO that does not agree with its previous transaction, with the new error `PREVOUT_MISMATCH`); `@did-btcr2/api` (PATCH: the browser bundle holds the method package)

## Context

A beacon signal spends the UTXOs of the beacon address (ADR 134). `fetchBeaconFunding` reads the UTXO listing of the address from the REST (Esplora) endpoint. `selectBeaconFunding` selects UTXOs from the listing and calculates the change: the sum of the listed values minus the fee. `fetchBeaconFunding` then reads the raw previous transaction of each selected UTXO, because a PSBT input needs it.

The builders take the input values from the listing:

1. `buildSinglePartyTx` sets `witnessUtxo.amount` and `prevOutValues` from `utxo.value`.
2. `buildAggregationBeaconTx` does the same for the one cohort UTXO.

The code did not compare the listing with the previous transaction. It did not check that the transaction hashes to `utxo.txid`, or that the output at `utxo.vout` pays `utxo.value` to the beacon script. scure-btc-signer 1.8.1 does not do these checks in `addInput`. It does them only in `validateInput`, from `fromPSBT` and `toPSBT`.

A legacy (P2PKH) sighash does not commit to the input values. Thus a listing that reports a low value makes a P2PKH beacon signal pay the difference as fee, and the signature stays valid. Example: the listing reports 20000 sats, and the output holds 1000000 sats. The transaction pays the change of 20000 sats minus the fee, and the miner gets the rest. A P2WPKH sighash (BIP 143) and a P2TR sighash (BIP 341) commit to the input values, so a node refuses such a transaction. But the node gives a broadcast error that does not name the cause.

The specification (Update, "Funding a Beacon Signal") is non-normative. It takes `prevouts` as an input, "each with its value", and does not say where the value comes from. Thus this change is a robustness change, not a specification gap.

## Decision

### 1. Each selected UTXO must agree with its previous transaction

After the `getHex` reads, `fetchBeaconFunding` checks each selected UTXO against its previous transaction:

1. The transaction must decode.
2. The transaction must hash to `utxo.txid`. The txid is the double SHA-256 of the serialization without the witness, in reverse byte order. Thus an endpoint can give the transaction in the witness serialization.
3. The transaction must have an output at `utxo.vout`.
4. The output must pay the script of the beacon address.
5. The output value must be `utxo.value`.

The check runs on the selected UTXOs only, because the transaction spends only these UTXOs. It runs before the builder signs, so no transaction goes to the network.

### 2. A difference stops the signal

At the first difference, `fetchBeaconFunding` throws a `BeaconError` with the type `PREVOUT_MISMATCH`. The message names the UTXO, the beacon address, and the difference. The data holds `address`, `txid`, `vout`, and `reason`.

The code does not correct the value from the previous transaction. The selection and the fee came from the listing. A listing that does not agree with the chain is wrong or hostile. Thus the spent state and the confirmations in the listing are not reliable either.

### 3. `PREVOUT_MISMATCH` is not a funding error

The api `FUNDING_ERROR_TYPES` (`UNFUNDED_BEACON_ADDRESS`, `NO_SPENDABLE_BEACON_UTXO`, `INSUFFICIENT_FUNDS`) does not get the new type. A funding error tells the caller to fund the beacon address. `PREVOUT_MISMATCH` tells the caller that the endpoint gives bad data. The api funding guard reads only the listing, so it does not see this error.

## Alternatives

- **Correct the value from the previous transaction and continue.** Rejected. The selection, the fee, and the change came from a listing that the chain does not confirm. The signal then spends UTXOs from a source that is not reliable.
- **Add `PREVOUT_MISMATCH` to the api `FUNDING_ERROR_TYPES`.** Rejected. More funds do not fix bad endpoint data, and the funding guard does not read the previous transactions.
- **Check each listed UTXO, not only the selected UTXOs.** Rejected. The check needs one `getHex` read for each UTXO. The transaction does not spend a UTXO that the code does not select, so a wrong value of that UTXO has no effect.

## Consequences

- A P2PKH beacon signal does not pay a hidden fee if the listing reports a low value.
- A P2WPKH or P2TR beacon signal with a wrong listing fails before the broadcast, with an error that names the cause.
- An endpoint that gives a previous transaction that does not hash to the txid makes the signal fail with `PREVOUT_MISMATCH`.
- A test fixture must give the full bytes of the previous transaction. scure `Transaction.toBytes()` drops the scriptSig, so the fixtures use `toBytes(true)`.
- The aggregation package builds its P2TR transactions from caller data. A P2TR sighash commits to all input values, so the aggregation package does not change.
- The check does not change the CAS publication order of a CAS beacon. The CAS publication still runs before the check.

## Implementation

- `packages/method/src/core/beacon/beacon.ts`: the function `prevoutMismatch` and the check in `fetchBeaconFunding`; the `@throws` texts of `buildAggregationBeaconTx` and `buildSignAndBroadcast`.
- `packages/method/tests/beacon-prevout-check.spec.ts`: the tests "beacon UTXO check against the previous transaction (ADR 143)".
- `packages/method/tests/beacon-broadcast.spec.ts`, `beacon-multi-input.spec.ts`, `beacon-change-output.spec.ts`, and `packages/api/tests/support/update-fixtures.ts`: the fixtures use `toBytes(true)`.

## References

- [did:btcr2 specification, Update, Funding a Beacon Signal](https://dcdpr.github.io/did-btcr2/operations/update.html).
- [BIP 143](https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki) and [BIP 341](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki): the sighash commits to the input values.
- [ADR 134](134-a-beacon-signal-spends-all-eligible-utxos-and-its-change-stays-spendable.md): a beacon signal spends all eligible UTXOs of the beacon address.
