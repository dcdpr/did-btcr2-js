import { canonicalize } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { SerializedSMTProof } from '@did-btcr2/smt';
import { blockHash, didToIndex, hashToHex, hexToHash, verifySerializedProof } from '@did-btcr2/smt';
import type { AggregationCohort } from './cohort.js';
import type { BaseBody } from './messages/base.js';

/** Validation result returned to the participant for a distribute-data message. */
export interface BeaconValidationResult {
  matches: boolean;
  casAnnouncement?: Record<string, string>;
  smtProof?: SerializedSMTProof;
}

/** Per-participant body attached to DISTRIBUTE_AGGREGATED_DATA by the service. */
export interface BeaconDistributePayload {
  casAnnouncement?: Record<string, string>;
  smtProof?: Record<string, unknown>;
}

/**
 * Pluggable strategy for beacon-type-specific aggregation, distribution, and
 * participant-side validation. Lets new beacon types be added without
 * modifying the service or participant state machines: register a new strategy
 * via {@link registerBeaconStrategy}.
 */
export interface AggregateBeaconStrategy {
  /** String constant used as `beaconType` on CohortConfig / BaseMessage bodies. */
  readonly type: string;

  /**
   * Service: build the aggregated data on the cohort after all updates are
   * collected. Implementation should mutate the cohort (set signalBytes,
   * casAnnouncement, smtProofs, etc.).
   */
  buildAggregatedData(cohort: AggregationCohort): void;

  /**
   * Service: produce the body fields to attach to DISTRIBUTE_AGGREGATED_DATA
   * for a specific participant. Called once per cohort member.
   */
  getDistributePayload(cohort: AggregationCohort, participantDid: string): BeaconDistributePayload;

  /**
   * Participant: verify the aggregated data they received reflects their own
   * submitted update. Pure function — returns matches + sidecar fields for
   * the caller to store.
   */
  validateParticipantView(params: {
    participantDid: string;
    submittedUpdate: SignedBTCR2Update;
    expectedHash: string;
    body: BaseBody;
  }): BeaconValidationResult;
}

const CAS_STRATEGY: AggregateBeaconStrategy = {
  type : 'CASBeacon',

  buildAggregatedData(cohort) {
    cohort.buildCASAnnouncement();
  },

  getDistributePayload(cohort) {
    return { casAnnouncement: cohort.casAnnouncement };
  },

  validateParticipantView({ participantDid, expectedHash, body }) {
    const casAnnouncement = body.casAnnouncement;
    if(!casAnnouncement) return { matches: false };
    return {
      matches : casAnnouncement[participantDid] === expectedHash,
      casAnnouncement,
    };
  },
};

const SMT_STRATEGY: AggregateBeaconStrategy = {
  type : 'SMTBeacon',

  buildAggregatedData(cohort) {
    cohort.buildSMTTree();
  },

  getDistributePayload(cohort, participantDid) {
    const proof = cohort.smtProofs?.get(participantDid);
    return { smtProof: proof as unknown as Record<string, unknown> | undefined };
  },

  validateParticipantView({ participantDid, submittedUpdate, body }) {
    const smtProof = body.smtProof as unknown as SerializedSMTProof | undefined;
    if(!smtProof?.updateId || !smtProof?.nonce) return { matches: false };
    // Verify updateId matches the canonicalized update hash
    const canonicalBytes = new TextEncoder().encode(canonicalize(submittedUpdate as unknown as Record<string, unknown>));
    const expectedUpdateId = hashToHex(blockHash(canonicalBytes));
    if(smtProof.updateId !== expectedUpdateId) {
      return { matches: false, smtProof };
    }
    // Verify Merkle inclusion
    const index = didToIndex(participantDid);
    const candidateHash = blockHash(blockHash(hexToHash(smtProof.nonce)), hexToHash(smtProof.updateId));
    return {
      matches : verifySerializedProof(smtProof, index, candidateHash),
      smtProof,
    };
  },
};

/** Registered strategies keyed by `beaconType` string. */
const STRATEGIES: Map<string, AggregateBeaconStrategy> = new Map([
  [CAS_STRATEGY.type, CAS_STRATEGY],
  [SMT_STRATEGY.type, SMT_STRATEGY],
]);

/** Register a custom beacon strategy. Overwrites any existing entry with the same type. */
export function registerBeaconStrategy(strategy: AggregateBeaconStrategy): void {
  STRATEGIES.set(strategy.type, strategy);
}

/** Look up a registered beacon strategy by type, or undefined if not registered. */
export function getBeaconStrategy(type: string): AggregateBeaconStrategy | undefined {
  return STRATEGIES.get(type);
}
