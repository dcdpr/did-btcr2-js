/**
 * Fallback spend builder for aggregate beacon outputs.
 *
 * An aggregate beacon UTXO is a Taproot output whose key path is the cohort's
 * n-of-n MuSig2 aggregate key and whose script path carries a k-of-n fallback
 * leaf (`p2tr_ms` CHECKSIGADD) plus a CSV recovery leaf (see
 * {@link ./recovery-policy.ts} and ADR 042). When the optimistic n-of-n key path
 * stalls (a missing or defecting signer), the cohort can still push the SAME
 * announcement transaction through the fallback leaf with any k members'
 * signatures, instead of abandoning the round or waiting out the recovery
 * timelock.
 *
 * Unlike the MuSig2 key path, the fallback is a plain k-of-n script-path spend:
 * each signer produces a standalone BIP-340 signature over the script-path
 * sighash (no nonce round), and the coordinator assembles k of them into the
 * witness. The coordinator never holds a participant secret - it injects the
 * collected signatures and finalizes.
 *
 * This module is pure with respect to the network: it takes the beacon
 * transaction, the cohort and recovery parameters, the spent output, and the
 * collected signatures, and returns a finalized {@link Transaction}.
 * Broadcasting is the caller's concern.
 */

import { getNetwork } from '@did-btcr2/bitcoin';
import { schnorr } from '@noble/curves/secp256k1.js';
import type { Transaction} from '@scure/btc-signer';
import { SigHash, p2tr } from '@scure/btc-signer';
import { keyAggExport, keyAggregate, sortKeys } from '@scure/btc-signer/musig2';
import { AggregationCohortError } from './errors.js';
import type { FundingModel } from './recovery-policy.js';
import {
  DEFAULT_FUNDING_MODEL,
  TAPROOT_LEAF_VERSION,
  buildFallbackLeaf,
  buildRecoveryLeaves,
  resolveFallbackThreshold,
  tapLeafHash,
} from './recovery-policy.js';

/** A single member's standalone signature over the fallback script-path sighash. */
export interface FallbackSignature {
  /** Signer's x-only public key (32 bytes). Must be one of the cohort's keys. */
  pubKey: Uint8Array;
  /** 64-byte BIP-340 Schnorr signature over the script-path sighash. */
  signature: Uint8Array;
}

/** Inputs to {@link buildFallbackSpend}. */
export interface FallbackSpendParams {
  /**
   * The beacon announcement transaction to finalize. Input {@link inputIndex}
   * spends the beacon UTXO; its key-path witness must not be set (the fallback
   * assembles a script-path witness instead).
   */
  pendingTx: Transaction;
  /** Index of the beacon input within {@link pendingTx}. Defaults to 0. */
  inputIndex?: number;
  /**
   * The cohort's participant public keys (compressed secp256k1, 33 bytes).
   * Sorted internally per BIP-327 so the reconstructed tree matches the funded
   * output.
   */
  cohortKeys: Uint8Array[];
  /**
   * The advertised k of the k-of-n fallback leaf, or omit for the cohort's n-1
   * default. Resolved against `cohortKeys.length` exactly as the cohort does.
   */
  fallbackThreshold?: number;
  /** Operator recovery key, x-only (32 bytes). Needed to reconstruct the script tree. */
  recoveryKey: Uint8Array;
  /** Relative-timelock (BIP-68) the recovery leaf enforces. Needed to reconstruct the script tree. */
  recoverySequence: number;
  /** Funding model governing the leaves. Defaults to 'operator-funded'. */
  fundingModel?: FundingModel;
  /** Bitcoin network name (bitcoin/mainnet, mutinynet, signet, testnet, regtest). */
  network: string;
  /** scriptPubKey of the beacon UTXO being spent. Must equal the reconstructed tree output script. */
  prevOutScript: Uint8Array;
  /** Value of the beacon UTXO in satoshis. */
  prevOutValue: bigint;
  /**
   * Standalone signatures collected from cohort members. At least
   * {@link fallbackThreshold} valid, distinct-by-key signatures are required;
   * exactly k are injected (a k-of-n CHECKSIGADD leaf demands exactly k).
   */
  signatures: FallbackSignature[];
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Compute the BIP-341 script-path sighash a cohort member must sign to authorize
 * the fallback spend. The leaf is the k-of-n fallback leaf; signers produce a
 * standalone BIP-340 signature over this digest with SIGHASH_DEFAULT.
 */
export function fallbackSighash(
  tx: Transaction,
  inputIndex: number,
  prevOutScript: Uint8Array,
  prevOutValue: bigint,
  fallbackLeafScript: Uint8Array,
): Uint8Array {
  return tx.preimageWitnessV1(
    inputIndex,
    [ prevOutScript ],
    SigHash.DEFAULT,
    [ prevOutValue ],
    undefined,
    fallbackLeafScript,
    TAPROOT_LEAF_VERSION,
  );
}

/**
 * Assemble and finalize a k-of-n fallback spend of an aggregate beacon UTXO.
 *
 * Reconstructs the funded Taproot output (MuSig2 internal key + fallback/recovery
 * script tree), verifies each collected signature against the script-path
 * sighash and a cohort key, injects exactly k distinct valid signatures into the
 * fallback leaf, and finalizes the witness. The returned transaction is the same
 * announcement the optimistic path would have produced, signed via the script
 * path instead of the key path.
 *
 * @throws {AggregationCohortError} when there are no cohort keys, the spent
 * script does not match the reconstructed tree output, or fewer than k valid
 * distinct signatures were supplied.
 */
export function buildFallbackSpend(params: FallbackSpendParams): Transaction {
  const {
    pendingTx, cohortKeys, recoveryKey, recoverySequence,
    fundingModel, network, prevOutScript, prevOutValue, signatures,
  } = params;
  const inputIndex = params.inputIndex ?? 0;

  if(cohortKeys.length === 0) {
    throw new AggregationCohortError(
      'Cannot build fallback spend: no cohort keys.',
      'NO_COHORT_KEYS'
    );
  }

  // Resolve k the same way the cohort did, so the reconstructed leaf matches.
  const fallbackThreshold = resolveFallbackThreshold(params.fallbackThreshold, cohortKeys.length);

  // Reconstruct the funded output the same way the cohort derived its address.
  const internalKey = keyAggExport(keyAggregate(sortKeys(cohortKeys)));
  const leaves = buildRecoveryLeaves(fundingModel ?? DEFAULT_FUNDING_MODEL, {
    recoveryKey, recoverySequence, cohortKeys, fallbackThreshold,
  });
  const net = getNetwork(network);
  // allowUnknownOutputs: the CSV recovery leaf is a custom script (see cohort.ts).
  const payment = p2tr(internalKey, leaves, net, true);

  // The output we are spending must be the cohort's funded beacon output; if the
  // reconstructed tree script differs, the witness would not match the chain.
  if(!bytesEqual(payment.script, prevOutScript)) {
    throw new AggregationCohortError(
      'Reconstructed beacon output script does not match the spent prevout script.',
      'PREVOUT_SCRIPT_MISMATCH'
    );
  }

  const fallbackLeaf = buildFallbackLeaf({ cohortKeys, fallbackThreshold });
  // Locate the fallback leaf's tapLeafScript entry: each entry is
  // [controlBlock, script || leafVersion]; strip the trailing version byte to
  // compare the script.
  const leafEntry = payment.tapLeafScript?.find(([ , scriptVer ]) => {
    const script = scriptVer.slice(0, scriptVer.length - 1);
    return bytesEqual(script, fallbackLeaf);
  });
  if(!leafEntry) {
    throw new AggregationCohortError(
      'Could not locate the fallback leaf in the reconstructed beacon output.',
      'FALLBACK_LEAF_NOT_FOUND'
    );
  }

  // Validate the collected signatures against the script-path sighash. The leaf
  // is keyed by x-only cohort keys, so a valid signature must verify against one
  // of them. Keep only distinct, valid signatures (first occurrence per key).
  const cohortXOnly = sortKeys(cohortKeys).map(k => k.slice(1));
  const tx = pendingTx;
  const sighash = fallbackSighash(tx, inputIndex, prevOutScript, prevOutValue, fallbackLeaf);

  const leafHash = tapLeafHash(fallbackLeaf);
  const accepted = new Map<string, Uint8Array>(); // x-only hex to signature
  for(const { pubKey, signature } of signatures) {
    if(pubKey.length !== 32 || signature.length !== 64) continue;
    const isCohortKey = cohortXOnly.some(k => bytesEqual(k, pubKey));
    if(!isCohortKey) continue;
    const hex = Array.from(pubKey, b => b.toString(16).padStart(2, '0')).join('');
    if(accepted.has(hex)) continue;
    let ok = false;
    try { ok = schnorr.verify(signature, sighash, pubKey); } catch { ok = false; }
    if(ok) accepted.set(hex, signature);
  }

  if(accepted.size < fallbackThreshold) {
    throw new AggregationCohortError(
      `Not enough valid fallback signatures: have ${accepted.size}, need ${fallbackThreshold}.`,
      'NOT_ENOUGH_FALLBACK_SIGNATURES', { have: accepted.size, need: fallbackThreshold }
    );
  }

  // A k-of-n CHECKSIGADD leaf demands EXACTLY k satisfied signatures (the final
  // <k> NUMEQUAL fails if the running count differs), so inject exactly k.
  const chosen = cohortXOnly
    .filter(k => accepted.has(Array.from(k, b => b.toString(16).padStart(2, '0')).join('')))
    .slice(0, fallbackThreshold);

  tx.updateInput(inputIndex, {
    tapLeafScript : [ leafEntry ],
    tapScriptSig  : chosen.map(pubKey => {
      const hex = Array.from(pubKey, b => b.toString(16).padStart(2, '0')).join('');
      return [ { pubKey, leafHash }, accepted.get(hex)! ];
    }),
  });
  tx.finalize();
  return tx;
}
