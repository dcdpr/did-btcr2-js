/**
 * Recovery policy for aggregate beacon outputs.
 *
 * An aggregate beacon UTXO is a Taproot output whose key path is the cohort's
 * n-of-n MuSig2 aggregate key. A key-path-only output can be spent only with a
 * signature from every cohort member, so a single missing signer would lock the
 * funds forever. To prevent that, the output commits to a script tree with two
 * leaves:
 * - a k-of-n fallback leaf (`p2tr_ms`, BIP-342 CHECKSIGADD): any k cohort members
 *   can still push the announcement through if some signers go missing, so the
 *   beacon stays live without waiting out the timelock.
 * - a CSV recovery leaf: after a relative-timelock delay the funder can reclaim
 *   the UTXO unilaterally with its own recovery key, so funds are never
 *   permanently stranded even if fewer than k members remain.
 *
 * This module is the seam between the funding model and the concrete script
 * leaves. Only `operator-funded` is implemented today (the k-of-n fallback leaf
 * plus one CSV leaf keyed to the operator's recovery key). A future
 * `participant-funded` model can be added as another case returning
 * per-participant refund leaves, without touching the cohort, service, or
 * signing code. See ADR 042.
 */

import { schnorr } from '@noble/curves/secp256k1.js';
import { concatBytes } from '@noble/hashes/utils';
import { Script, p2tr_ms } from '@scure/btc-signer';
import { sortKeys } from '@scure/btc-signer/musig2';
import { AggregationCohortError } from './errors.js';

/**
 * Who funds the beacon UTXO and holds the recovery path.
 * - `operator-funded`: the service operator funds the UTXO and holds a single
 *   CSV recovery key. Implemented.
 * - `participant-funded`: reserved for per-participant funding with
 *   per-participant refund leaves. Not implemented.
 */
export type FundingModel = 'operator-funded' | 'participant-funded';

/** Default funding model when an advert/config leaves it unspecified. */
export const DEFAULT_FUNDING_MODEL: FundingModel = 'operator-funded';

/**
 * Default relative-timelock (in blocks) before operator recovery is spendable.
 * About one day at 10-minute blocks. Operators set their own per-cohort value;
 * this is only a convenience default for callers.
 */
export const DEFAULT_RECOVERY_SEQUENCE = 144;

/**
 * Maximum allowed `recoverySequence`, 0xffff (65535 blocks, about 455 days).
 *
 * The value is a BIP-68 block-based relative timelock and is placed directly in
 * the spending input's nSequence. BIP-68 only uses the low 16 bits as the value
 * when the type flag (bit 22) is clear, so constraining to [1, 0xffff] keeps the
 * timelock block-based and, critically, leaves the disable flag (bit 31) clear.
 * A value with bit 31 set would disable CHECKSEQUENCEVERIFY entirely, letting the
 * recovery key spend with no delay; an upper bound of 0xffff makes that
 * unrepresentable.
 */
export const MAX_RECOVERY_SEQUENCE = 0xffff;

/** Inputs needed to build the CSV recovery leaf. */
export interface RecoveryPolicyParams {
  /** Operator recovery key, x-only (32 bytes). Spends the recovery leaf via CHECKSIG. */
  recoveryKey: Uint8Array;
  /**
   * Relative-timelock value (BIP-68 nSequence) the recovery spend must wait,
   * encoded into the leaf as `<recoverySequence> CHECKSEQUENCEVERIFY`.
   */
  recoverySequence: number;
}

/** Inputs needed to build the k-of-n fallback leaf. */
export interface FallbackPolicyParams {
  /**
   * The cohort's participant public keys (compressed secp256k1, 33 bytes each).
   * Sorted internally per BIP-327 and reduced to x-only so the leaf is
   * deterministic regardless of the order keys are supplied in.
   */
  cohortKeys: Uint8Array[];
  /**
   * Number of signers (k) the fallback leaf requires, 1..n. This is the
   * resolved threshold; callers that carry an advertised-or-default value should
   * resolve it with {@link resolveFallbackThreshold} first.
   */
  fallbackThreshold: number;
}

/** All inputs the beacon output's script tree commits to (fallback leaf + recovery leaf). */
export interface BeaconLeafParams extends RecoveryPolicyParams, FallbackPolicyParams {}

/** A single Taproot script-tree leaf, spent at the default tapscript leaf version (0xc0). */
export interface TaprootScriptLeaf {
  script: Uint8Array;
}

/** BIP-341 default tapscript leaf version. */
export const TAPROOT_LEAF_VERSION = 0xc0;

/** BIP-340 compact-size (varint) prefix for a byte length (scripts stay well under 2^32). */
function compactSize(n: number): Uint8Array {
  if(n < 0xfd) return new Uint8Array([ n ]);
  if(n <= 0xffff) return new Uint8Array([ 0xfd, n & 0xff, (n >> 8) & 0xff ]);
  return new Uint8Array([ 0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff ]);
}

/**
 * BIP-341 tapleaf hash: `taggedHash("TapLeaf", leafVersion || compactSize(len) || script)`.
 * Used to key a script-path signature to its leaf when assembling the witness
 * for a script-path spend (the fallback and recovery spend builders).
 */
export function tapLeafHash(script: Uint8Array, leafVersion: number = TAPROOT_LEAF_VERSION): Uint8Array {
  return schnorr.utils.taggedHash(
    'TapLeaf',
    concatBytes(new Uint8Array([ leafVersion ]), compactSize(script.length), script)
  );
}

/**
 * Resolve the effective fallback threshold k from an advertised value and the
 * cohort size n. When unadvertised it defaults to n-1 (tolerate one missing or
 * defecting signer, the cheapest useful fallback witness), floored at 1. Both
 * the service and every participant resolve this identically so they derive the
 * same beacon address.
 */
export function resolveFallbackThreshold(advertised: number | undefined, n: number): number {
  return advertised ?? Math.max(1, n - 1);
}

function assertFallbackParams({ cohortKeys, fallbackThreshold }: FallbackPolicyParams): void {
  const n = cohortKeys.length;
  if(n === 0) {
    throw new AggregationCohortError(
      'Cannot build fallback leaf: no cohort keys.',
      'NO_COHORT_KEYS'
    );
  }
  for(const key of cohortKeys) {
    if(key.length !== 33) {
      throw new AggregationCohortError(
        `Cohort key must be a 33-byte compressed public key, got ${key.length} bytes.`,
        'INVALID_COHORT_KEY', { length: key.length }
      );
    }
  }
  if(!Number.isInteger(fallbackThreshold) || fallbackThreshold < 1 || fallbackThreshold > n) {
    throw new AggregationCohortError(
      `Fallback threshold must be an integer in [1, ${n}] (k-of-n), got ${fallbackThreshold}.`,
      'INVALID_FALLBACK_THRESHOLD', { fallbackThreshold, n }
    );
  }
}

/**
 * Build the k-of-n fallback leaf script: a BIP-342 `p2tr_ms` CHECKSIGADD
 * multisig over the cohort's x-only keys. Any k members can spend this leaf to
 * push the announcement through when the optimistic n-of-n key path stalls.
 *
 * The keys are sorted per BIP-327 (matching the MuSig2 internal-key ordering)
 * and reduced to x-only, so the leaf is identical for every party that builds it.
 */
export function buildFallbackLeaf(params: FallbackPolicyParams): Uint8Array {
  assertFallbackParams(params);
  const xOnlyKeys = sortKeys(params.cohortKeys).map(k => k.slice(1));
  return p2tr_ms(params.fallbackThreshold, xOnlyKeys).script;
}

function assertRecoveryParams({ recoveryKey, recoverySequence }: RecoveryPolicyParams): void {
  if(recoveryKey.length !== 32) {
    throw new AggregationCohortError(
      `Recovery key must be a 32-byte x-only public key, got ${recoveryKey.length} bytes.`,
      'INVALID_RECOVERY_KEY'
    );
  }
  if(!Number.isInteger(recoverySequence) || recoverySequence < 1 || recoverySequence > MAX_RECOVERY_SEQUENCE) {
    throw new AggregationCohortError(
      `Recovery sequence must be a block-based BIP-68 relative timelock in [1, ${MAX_RECOVERY_SEQUENCE}], got ${recoverySequence}.`,
      'INVALID_RECOVERY_SEQUENCE'
    );
  }
}

/**
 * Build the CSV recovery leaf script:
 * `<recoverySequence> CHECKSEQUENCEVERIFY DROP <recoveryKey> CHECKSIG`.
 *
 * After `recoverySequence` blocks (relative to the UTXO's confirmation) the
 * holder of `recoveryKey` can spend the output via the script path.
 */
export function buildRecoveryScript(params: RecoveryPolicyParams): Uint8Array {
  assertRecoveryParams(params);
  return Script.encode([
    params.recoverySequence,
    'CHECKSEQUENCEVERIFY',
    'DROP',
    params.recoveryKey,
    'CHECKSIG',
  ]);
}

/**
 * Build the Taproot script-tree leaves for a funding model. The returned leaves
 * are the script tree the beacon output key commits to alongside the cohort's
 * MuSig2 internal key.
 *
 * Canonical leaf order is fallback (k-of-n, leaf A) then CSV recovery (leaf B).
 * For the current two-leaf tree the Merkle root is order-invariant (a TapBranch
 * sorts its two child hashes), but fixing the order keeps the construction
 * deterministic and reviewable, and is consensus-affecting should the tree ever
 * grow past two leaves.
 *
 * @throws {AggregationCohortError} when the funding model is reserved (e.g.
 * `participant-funded`) or unknown, or when the fallback/recovery params are
 * invalid.
 */
export function buildRecoveryLeaves(
  fundingModel: FundingModel,
  params: BeaconLeafParams
): TaprootScriptLeaf[] {
  switch(fundingModel) {
    case 'operator-funded':
      return [
        { script: buildFallbackLeaf(params) },
        { script: buildRecoveryScript(params) },
      ];
    case 'participant-funded':
      throw new AggregationCohortError(
        'Funding model \'participant-funded\' is reserved and not yet implemented.',
        'UNSUPPORTED_FUNDING_MODEL', { fundingModel }
      );
    default:
      throw new AggregationCohortError(
        `Unknown funding model: ${fundingModel}.`,
        'UNKNOWN_FUNDING_MODEL', { fundingModel }
      );
  }
}
