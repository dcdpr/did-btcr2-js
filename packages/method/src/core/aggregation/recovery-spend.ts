/**
 * Recovery spend builder for aggregate beacon outputs.
 *
 * An aggregate beacon UTXO is a Taproot output whose key path is the cohort's
 * n-of-n MuSig2 aggregate key and whose script path carries a timelocked
 * recovery leaf (see {@link ./recovery-policy.ts} and ADR 042). When the
 * optimistic cooperative key-path spend cannot complete (a missing or defecting
 * signer), the funder reclaims the UTXO via the recovery leaf after the
 * relative-timelock delay.
 *
 * This module builds and signs that script-path spend. It is pure with respect
 * to the network: it takes a UTXO reference plus the cohort and recovery
 * parameters and returns a finalized {@link Transaction}; broadcasting and
 * confirmation are the caller's concern. The recovery key path is a single
 * BIP-340 Schnorr signature, so unlike the MuSig2 key path it can be driven by
 * an opaque or HSM-backed signer.
 *
 * The relative timelock is enforced by consensus (BIP-68/112): the spend is only
 * valid once the UTXO has `recoverySequence` confirmations, and the input's
 * nSequence is set accordingly. The transaction version is 2 so BIP-68 applies.
 */

import { getNetwork } from '@did-btcr2/bitcoin';
import { schnorr } from '@noble/curves/secp256k1.js';
import { p2tr, Transaction } from '@scure/btc-signer';
import { keyAggExport, keyAggregate, sortKeys } from '@scure/btc-signer/musig2';
import { AggregationCohortError } from './errors.js';
import type { FundingModel } from './recovery-policy.js';
import { DEFAULT_FUNDING_MODEL, buildRecoveryLeaves, resolveFallbackThreshold } from './recovery-policy.js';

/** Reference to the beacon UTXO being recovered. */
export interface BeaconUtxoRef {
  /** Transaction id (Esplora display-order hex), as returned by the REST UTXO endpoint. */
  txid: string;
  /** Output index within that transaction. */
  vout: number;
  /** Value of the beacon UTXO in satoshis. */
  value: bigint;
}

/** Inputs to {@link buildRecoverySpend}. */
export interface RecoverySpendParams {
  /**
   * The cohort's participant public keys (compressed secp256k1). Sorted
   * internally per BIP-327 so the reconstructed internal key matches the one the
   * beacon address was derived from.
   */
  cohortKeys: Uint8Array[];
  /** Operator recovery secret key (32 bytes). Its x-only public key must equal {@link recoveryKey}. */
  recoverySecretKey: Uint8Array;
  /** Operator recovery key, x-only (32 bytes), as committed in the recovery leaf. */
  recoveryKey: Uint8Array;
  /** Relative-timelock (BIP-68 nSequence) the recovery leaf enforces. */
  recoverySequence: number;
  /**
   * The advertised k of the k-of-n fallback leaf the beacon output also commits
   * to, or omit to use the same n-1 default the cohort applies. Resolved against
   * `cohortKeys.length` exactly as the cohort does, so the reconstructed script
   * tree and control block match the funded address.
   */
  fallbackThreshold?: number;
  /** Funding model governing the recovery leaves. Defaults to 'operator-funded'. */
  fundingModel?: FundingModel;
  /** Bitcoin network name (bitcoin/mainnet, mutinynet, signet, testnet, regtest). */
  network: string;
  /**
   * The beacon UTXO being recovered.
   *
   * Precondition: the on-chain output at this `txid:vout` MUST have been funded
   * to the beacon address derived from these same `cohortKeys`, `recoveryKey`,
   * `recoverySequence`, and `fundingModel`. If it was funded under different
   * parameters the reconstructed `witnessUtxo.script` will not match the chain,
   * the signature will be invalid, and the spend will be rejected. Pass
   * {@link beaconAddress} to assert this reconstruction up front.
   */
  utxo: BeaconUtxoRef;
  /** Address receiving the recovered funds. */
  destinationAddress: string;
  /** Absolute fee (satoshis) deducted from the recovered value. */
  fee: bigint;
  /**
   * Optional: the cohort's funded beacon address. When provided, the builder
   * asserts that the address it reconstructs from the cohort and recovery params
   * equals it, catching a caller mismatch before producing an unspendable tx.
   */
  beaconAddress?: string;
}

/**
 * Conservative dust floor (satoshis). The standard p2pkh dust limit; a generic
 * floor below which the recovered output would not be relayable regardless of
 * the destination script type.
 */
const DUST_LIMIT_SATS = 546n;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Build and sign a script-path recovery spend of an aggregate beacon UTXO.
 *
 * Reconstructs the same Taproot output the cohort funded (MuSig2 internal key +
 * recovery script tree), spends it through the recovery leaf with the operator's
 * recovery key, and finalizes the witness (signature + leaf script + control
 * block). The returned transaction is ready to broadcast once the UTXO has
 * `recoverySequence` confirmations.
 *
 * @throws {AggregationCohortError} when the recovery secret key does not match
 * the committed recovery key, when there are no cohort keys, or when the fee
 * exceeds the UTXO value.
 */
export function buildRecoverySpend(params: RecoverySpendParams): Transaction {
  const {
    cohortKeys, recoverySecretKey, recoveryKey, recoverySequence, fallbackThreshold,
    fundingModel, network, utxo, destinationAddress, fee, beaconAddress,
  } = params;

  if(cohortKeys.length === 0) {
    throw new AggregationCohortError(
      'Cannot build recovery spend: no cohort keys.',
      'NO_COHORT_KEYS'
    );
  }

  // The recovery leaf commits to recoveryKey; signing it requires the matching
  // secret. Fail loudly here rather than producing a transaction that cannot
  // finalize (btc-signer would throw an opaque "No taproot scripts signed").
  const derivedPub = schnorr.getPublicKey(recoverySecretKey);
  if(!bytesEqual(derivedPub, recoveryKey)) {
    throw new AggregationCohortError(
      'Recovery secret key does not correspond to the committed recovery key.',
      'RECOVERY_KEY_MISMATCH'
    );
  }

  const out = utxo.value - fee;
  if(out <= 0n) {
    throw new AggregationCohortError(
      `Recovery fee ${fee} exceeds UTXO value ${utxo.value}.`,
      'FEE_EXCEEDS_VALUE', { fee: fee.toString(), value: utxo.value.toString() }
    );
  }
  if(out < DUST_LIMIT_SATS) {
    throw new AggregationCohortError(
      `Recovered output ${out} is below the dust limit ${DUST_LIMIT_SATS}; the spend would not relay.`,
      'DUST_OUTPUT', { output: out.toString(), dustLimit: DUST_LIMIT_SATS.toString() }
    );
  }

  // Reconstruct the funded output. sortKeys mirrors the cohort's key ordering so
  // the aggregate internal key (and therefore the address and control block)
  // match the UTXO being spent.
  const internalKey = keyAggExport(keyAggregate(sortKeys(cohortKeys)));
  const leaves = buildRecoveryLeaves(fundingModel ?? DEFAULT_FUNDING_MODEL, {
    recoveryKey, recoverySequence, cohortKeys,
    fallbackThreshold : resolveFallbackThreshold(fallbackThreshold, cohortKeys.length),
  });
  const net = getNetwork(network);
  // allowUnknownOutputs: the CSV recovery leaf is a custom script (see cohort.ts).
  const payment = p2tr(internalKey, leaves, net, true);

  // Catch a caller mismatch up front: if the reconstructed address does not match
  // the cohort's funded address, the witnessUtxo script would not match the chain
  // and the spend would be unspendable.
  if(beaconAddress !== undefined && payment.address !== beaconAddress) {
    throw new AggregationCohortError(
      `Reconstructed beacon address ${payment.address} does not match the cohort's funded address ${beaconAddress}.`,
      'BEACON_ADDRESS_MISMATCH', { reconstructed: payment.address, expected: beaconAddress }
    );
  }

  // allowUnknownInputs: the CSV recovery leaf is a custom (non-template) script,
  // so btc-signer's finalizer treats it as 'unknown' and will only assemble the
  // witness for it under this flag (it then signs "what we can": our single
  // recovery signature). version 2 activates BIP-68 relative timelocks.
  const tx = new Transaction({ version: 2, allowUnknownInputs: true });
  // Only tapLeafScript is set (no tapInternalKey): btc-signer then skips the
  // key-path branch and signs the recovery leaf with recoverySecretKey. The
  // input nSequence carries the BIP-68 relative timelock the leaf enforces.
  tx.addInput({
    txid          : utxo.txid,
    index         : utxo.vout,
    witnessUtxo   : { script: payment.script, amount: utxo.value },
    tapLeafScript : payment.tapLeafScript,
    sequence      : recoverySequence,
  });
  tx.addOutputAddress(destinationAddress, out, net);
  tx.signIdx(recoverySecretKey, 0);
  tx.finalize();
  return tx;
}
