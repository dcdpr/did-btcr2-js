import { CanonicalizationError, canonicalize, hash } from '@did-btcr2/std';
import type { SecuredDocument } from '@did-btcr2/integrity';
import type { SerializedSMTProof } from '@did-btcr2/smt';
import { base64UrlToHash, blockHash, hashToBase64Url, verifyProof } from '@did-btcr2/smt';
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
 * participant-side validation. The service and the participant accept only the
 * types in `KNOWN_BEACON_TYPES`: CASBeacon and SMTBeacon. createCohort refuses
 * another type, and the participant drops an advert of another type. A strategy
 * that you register with {@link registerBeaconStrategy} replaces the built-in
 * strategy of the same type for each cohort in the process. No cohort uses a
 * strategy of another type.
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
   * slot. A submitter (`included: true`) checks its update is included; a
   * decliner (`included: false`, cooperative non-inclusion) checks its
   * non-inclusion slot instead (absence from the CAS map, or an SMT
   * non-inclusion proof). `submittedUpdate`/`expectedHash` are present only for a
   * submitter. Pure function: returns matches + sidecar fields for the caller.
   */
  validateParticipantView(params: {
    participantDid: string;
    included: boolean;
    submittedUpdate?: SecuredDocument;
    expectedHash?: string;
    body: BaseBody;
  }): BeaconValidationResult;

  /**
   * Participant: recompute the 32-byte beacon signal from the data just
   * validated, exactly as the service derives it on the cohort. The caller
   * requires the announced `signalBytesHex` to equal this value before the
   * member approves, so a coordinator cannot distribute data that validates
   * while anchoring a signal derived from different data (for instance a CAS
   * map that omits the member, or another SMT root).
   *
   * Returns undefined when the validated result carries nothing to derive from;
   * the caller treats that as a validation failure, so a strategy that cannot
   * bind its signal fails closed rather than signing unbound.
   */
  deriveSignal(result: BeaconValidationResult): Uint8Array | undefined;
}

const CAS_STRATEGY: AggregateBeaconStrategy = {
  type : 'CASBeacon',

  buildAggregatedData(cohort) {
    cohort.buildCASAnnouncement();
  },

  getDistributePayload(cohort) {
    return { casAnnouncement: cohort.casAnnouncement };
  },

  validateParticipantView({ participantDid, included, expectedHash, body }) {
    const casAnnouncement = body.casAnnouncement;
    if(!casAnnouncement) return { matches: false };
    if(!included) {
      // Cooperative non-inclusion: the decliner must be ABSENT from the map.
      return { matches: !(participantDid in casAnnouncement), casAnnouncement };
    }
    return {
      matches : casAnnouncement[participantDid] === expectedHash,
      casAnnouncement,
    };
  },

  // Same derivation the cohort uses to set signalBytes (see
  // AggregationCohort.buildCASAnnouncement): SHA-256 of the canonicalized map.
  // The map comes from the service. A map with no JCS form (a lone surrogate,
  // a number that JSON.parse read as Infinity) gives no signal, so the member
  // does not approve it.
  deriveSignal({ casAnnouncement }) {
    if(!casAnnouncement) return undefined;
    try {
      return hash(canonicalize(casAnnouncement));
    } catch(error) {
      if(error instanceof CanonicalizationError) return undefined;
      throw error;
    }
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

  validateParticipantView({ participantDid, included, submittedUpdate, body }) {
    const smtProof = body.smtProof as unknown as SerializedSMTProof | undefined;

    if(!included) {
      // Cooperative non-update: the cohort builds the leaf in nonce mode, so the
      // proof has a nonce but no updateId by construction. The leaf is
      // SHA-256(SHA-256(nonce)). A missing updateId is correct here.
      if(!smtProof?.nonce || smtProof?.updateId) return { matches: false, smtProof };
      return { matches: verifyProof(smtProof, participantDid), smtProof };
    }

    if(!smtProof?.updateId || !smtProof?.nonce || !submittedUpdate) return { matches: false, smtProof };
    // Verify updateId matches the JSON Document Hash of the update. Proof hash
    // fields are base64url (no padding) per the SMT Proof spec.
    const canonicalBytes = new TextEncoder().encode(canonicalize(submittedUpdate as unknown as Record<string, unknown>));
    const expectedUpdateId = hashToBase64Url(blockHash(canonicalBytes));
    if(smtProof.updateId !== expectedUpdateId) {
      return { matches: false, smtProof };
    }
    // Verify the proof. The leaf is SHA-256(SHA-256(nonce) || updateId).
    return {
      matches : verifyProof(smtProof, participantDid),
      smtProof,
    };
  },

  // The signal is the SMT root, which is the very root `verifyProof` checked
  // the member's leaf against (the proof's `id`). Binding to it makes
  // "my proof is valid" and "my root is what gets anchored" one statement.
  deriveSignal({ smtProof }) {
    if(!smtProof?.id) return undefined;
    try {
      return base64UrlToHash(smtProof.id);
    } catch {
      return undefined;
    }
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
