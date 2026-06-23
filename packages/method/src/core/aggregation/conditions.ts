/**
 * Cohort conditions: the constraints an Aggregation Service advertises for a
 * cohort (did:btcr2 spec, "Step 1: Create Aggregation Cohort"). See ADR 039.
 *
 * The spec frames these as an optional menu ("the Aggregation Service can define
 * conditions such as ..."), so only `beaconType` and `minParticipants` are
 * required here; every other condition is optional and, when absent, means
 * unconstrained.
 *
 * Enforcement is staged (ADR 039): `beaconType` and the participant bounds are
 * enforced by the state machine now; DIDs-per-participant, timing/cadence, and
 * the pending-update trigger are modeled and advertised here but enforced when
 * the multi-cohort (AGG-4) and non-inclusion (AGG-5) tracks land. The two cost
 * conditions are advertised metadata only - the protocol performs no payment or
 * settlement (consistent with ADR 008).
 */

import type { FundingModel } from './recovery-policy.js';
import { MAX_RECOVERY_SEQUENCE } from './recovery-policy.js';

/** Beacon types that support aggregation (singleton is single-party only, per ADR 037). */
export const KNOWN_BEACON_TYPES = ['CASBeacon', 'SMTBeacon'] as const;

/** Funding models an operator may advertise. Only 'operator-funded' is implemented (ADR 042). */
export const KNOWN_FUNDING_MODELS = ['operator-funded', 'participant-funded'] as const;

/**
 * An advertised price. `unit` is operator-defined (the spec does not specify a
 * currency); `basis` distinguishes a per-DID from a per-participant charge for
 * "cost per announcement". Advertised only - never settled by the protocol.
 */
export interface CohortCost {
  amount: number;
  unit: string;
  basis?: 'per-did' | 'per-participant';
}

/** The seven spec cohort conditions. Only beaconType + minParticipants are required. */
export interface CohortConditions {
  /** 1. Beacon mechanism: 'CASBeacon' or 'SMTBeacon'. Enforced. */
  beaconType: string;
  /** 2. Lower bound on cohort size. Enforced (finalize floor). */
  minParticipants: number;
  /** 2. Upper bound on cohort size. Enforced (accept/finalize ceiling). */
  maxParticipants?: number;
  /** 3. Lower bound on DIDs a participant may register. Advertised; enforcement staged (AGG-5). */
  minDidsPerParticipant?: number;
  /** 3. Upper bound on DIDs a participant may register. Advertised; enforcement staged (AGG-5). */
  maxDidsPerParticipant?: number;
  /** 4. One-time enrollment price. Advertised only - no settlement. */
  costOfEnrollment?: CohortCost;
  /** 5. Recurring per-announcement price. Advertised only - no settlement. */
  costPerAnnouncement?: CohortCost;
  /** 6. Floor on time between announcements (seconds). Advertised; enforcement staged (AGG-4/5). */
  minSecondsBetweenAnnouncements?: number;
  /** 6. Ceiling on time between announcements (seconds). Advertised; enforcement staged - generalizes the ADR 027 Cohort TTL. */
  maxSecondsBetweenAnnouncements?: number;
  /** 7. Pending-update count that triggers an announcement. Advertised; enforcement staged (AGG-5) - generalizes hasAllUpdates(). */
  pendingUpdateTrigger?: number;
  /**
   * Who funds the beacon UTXO and holds the recovery path. Defaults to
   * 'operator-funded' when absent. See ADR 042.
   */
  fundingModel?: FundingModel;
  /**
   * Operator recovery key, x-only (64-character hex / 32 bytes). The beacon
   * output commits to a CSV recovery leaf keyed to this key, so a missing signer
   * can never permanently lock the funded UTXO. Required (ADR 042).
   */
  recoveryKey: string;
  /**
   * Relative-timelock (BIP-68 nSequence, in blocks) before the recovery leaf is
   * spendable. Required, >= 1 (ADR 042).
   */
  recoverySequence: number;
  /**
   * Number of signers (k) the k-of-n fallback leaf requires, so any k cohort
   * members can still announce when the optimistic n-of-n key path stalls
   * (graceful liveness, ADR 042). Optional: when absent it defaults to n-1 at
   * keygen, where n is the finalized participant count. When advertised it must
   * be an integer >= 1 (and <= maxParticipants when that is set); the upper bound
   * against the actual cohort size n is enforced at keygen.
   */
  fallbackThreshold?: number;
}

/** Validate an optional [min, max] integer pair. */
function checkPair(problems: string[], label: string, min?: number, max?: number): void {
  if(min !== undefined && (!Number.isInteger(min) || min < 0)) {
    problems.push(`min${label} must be an integer >= 0`);
  }
  if(max !== undefined && (!Number.isInteger(max) || max < 0)) {
    problems.push(`max${label} must be an integer >= 0`);
  }
  if(min !== undefined && max !== undefined && Number.isInteger(min) && Number.isInteger(max) && max < min) {
    problems.push(`max${label} must be >= min${label}`);
  }
}

/** Validate an optional advertised cost. */
function checkCost(problems: string[], label: string, cost?: CohortCost): void {
  if(cost === undefined) return;
  if(typeof cost.amount !== 'number' || !Number.isFinite(cost.amount) || cost.amount < 0) {
    problems.push(`${label}.amount must be a finite number >= 0`);
  }
  if(typeof cost.unit !== 'string' || cost.unit.length === 0) {
    problems.push(`${label}.unit must be a non-empty string`);
  }
  if(cost.basis !== undefined && cost.basis !== 'per-did' && cost.basis !== 'per-participant') {
    problems.push(`${label}.basis must be 'per-did' or 'per-participant'`);
  }
}

/**
 * Validate a set of cohort conditions. Returns a list of human-readable problems
 * (empty when valid) so the caller can decide how to surface them. Used by
 * `createCohort()` to fail fast instead of discovering invalidity at finalize.
 */
export function validateCohortConditions(c: CohortConditions): string[] {
  const problems: string[] = [];

  if(!(KNOWN_BEACON_TYPES as readonly string[]).includes(c.beaconType)) {
    problems.push(`beaconType must be one of ${KNOWN_BEACON_TYPES.join(', ')}`);
  }
  if(!Number.isInteger(c.minParticipants) || c.minParticipants < 1) {
    problems.push('minParticipants must be an integer >= 1');
  }
  if(c.maxParticipants !== undefined) {
    if(!Number.isInteger(c.maxParticipants) || c.maxParticipants < 1) {
      problems.push('maxParticipants must be an integer >= 1');
    } else if(Number.isInteger(c.minParticipants) && c.maxParticipants < c.minParticipants) {
      problems.push('maxParticipants must be >= minParticipants');
    }
  }

  checkPair(problems, 'DidsPerParticipant', c.minDidsPerParticipant, c.maxDidsPerParticipant);
  checkPair(problems, 'SecondsBetweenAnnouncements', c.minSecondsBetweenAnnouncements, c.maxSecondsBetweenAnnouncements);

  if(c.pendingUpdateTrigger !== undefined && (!Number.isInteger(c.pendingUpdateTrigger) || c.pendingUpdateTrigger < 1)) {
    problems.push('pendingUpdateTrigger must be an integer >= 1');
  }

  // Fallback threshold (k of the k-of-n fallback leaf). Optional; when advertised
  // it must be a positive integer and cannot exceed maxParticipants (the binding
  // upper bound against the actual cohort size n is checked at keygen, where n is
  // known). See ADR 042.
  if(c.fallbackThreshold !== undefined) {
    if(!Number.isInteger(c.fallbackThreshold) || c.fallbackThreshold < 1) {
      problems.push('fallbackThreshold must be an integer >= 1');
    } else if(c.maxParticipants !== undefined && Number.isInteger(c.maxParticipants) && c.fallbackThreshold > c.maxParticipants) {
      problems.push('fallbackThreshold must be <= maxParticipants');
    }
  }

  checkCost(problems, 'costOfEnrollment', c.costOfEnrollment);
  checkCost(problems, 'costPerAnnouncement', c.costPerAnnouncement);

  // Recovery params: the beacon output's CSV recovery leaf. Required so a
  // missing signer can never permanently lock the funded UTXO (ADR 042). The
  // key is an x-only (32-byte) Schnorr public key, carried as 64 hex chars.
  if(typeof c.recoveryKey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(c.recoveryKey)) {
    problems.push('recoveryKey must be a 64-character hex string (x-only public key)');
  }
  if(!Number.isInteger(c.recoverySequence) || c.recoverySequence < 1 || c.recoverySequence > MAX_RECOVERY_SEQUENCE) {
    problems.push(`recoverySequence must be a block-based BIP-68 relative timelock in [1, ${MAX_RECOVERY_SEQUENCE}]`);
  }
  if(c.fundingModel !== undefined && !(KNOWN_FUNDING_MODELS as readonly string[]).includes(c.fundingModel)) {
    problems.push(`fundingModel must be one of ${KNOWN_FUNDING_MODELS.join(', ')}`);
  }

  return problems;
}
