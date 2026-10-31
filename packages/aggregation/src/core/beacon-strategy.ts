import { CanonicalizationError, canonicalize, encode, hash } from '@did-btcr2/std';
import type { SerializedSMTProof } from '@did-btcr2/smt';
import { base64UrlToHash, hashToBase64Url, leafValue, verifyProof } from '@did-btcr2/smt';
import { randomBytes } from '@noble/hashes/utils';
import type { AggregationCohort } from './cohort.js';
import type { BaseBody } from './messages/base.js';

/** Validation result returned to the participant for a distribute-data message. */
export interface BeaconValidationResult {
  matches: boolean;
  casAnnouncement?: Record<string, string>;
  smtProof?: SerializedSMTProof;
}

/**
 * The values that a member makes for one round. The member sends `updateHash`
 * and keeps `nonce`. The service does not get the nonce.
 */
export interface BeaconSubmission {
  /** The value to send in SUBMIT_UPDATE. If it is absent, the member sends SUBMIT_NONINCLUDED. */
  updateHash?: string;
  /** SMT Beacon: the 256-bit nonce of the member for this round. */
  nonce?: Uint8Array;
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
   * Participant: make the values of the member for this round. `updateId` is
   * the JSON Document Hash of the update (32 bytes), absent for no update. The
   * member sends only the returned `updateHash`, so the service does not get
   * the update or the nonce.
   */
  prepareSubmission(updateId?: Uint8Array): BeaconSubmission;

  /**
   * Participant: verify that the aggregated data holds the values of the
   * member for this round. The service does not get the nonce or the update,
   * so the member gives the values that it kept:
   * - `updateHash`: the value that the member sent in SUBMIT_UPDATE. Absent if
   *   the member sent SUBMIT_NONINCLUDED.
   * - `nonce`: SMT Beacon only, the nonce that the member made.
   * - `updateId`: the JSON Document Hash of the update. Absent for no update.
   *
   * The function is pure. It returns `matches` and the sidecar fields for the caller.
   */
  validateParticipantView(params: {
    participantDid: string;
    updateHash?: string;
    nonce?: Uint8Array;
    updateId?: Uint8Array;
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

  // The map value is the JSON Document Hash of the update. A member with no
  // update sends SUBMIT_NONINCLUDED: absence from the public map shows no update.
  prepareSubmission(updateId) {
    return updateId === undefined ? {} : { updateHash: encode(updateId) };
  },

  validateParticipantView({ participantDid, updateHash, body }) {
    const casAnnouncement = body.casAnnouncement;
    if(!casAnnouncement) return { matches: false };
    if(updateHash === undefined) {
      // Cooperative non-inclusion: the decliner must be ABSENT from the map.
      return { matches: !(participantDid in casAnnouncement), casAnnouncement };
    }
    return {
      matches : casAnnouncement[participantDid] === updateHash,
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

  // The member makes a new 256-bit nonce for each round, also for no update.
  // The leaf value hides the update and the presence of an update.
  prepareSubmission(updateId) {
    const nonce = randomBytes(32);
    return { nonce, updateHash: hashToBase64Url(leafValue(nonce, updateId)) };
  },

  validateParticipantView({ participantDid, nonce, updateId, body }) {
    const received = body.smtProof as unknown as SerializedSMTProof | undefined;
    if(!received) return { matches: false };

    // Take only the tree data from the service: `id`, `collapsed`, and
    // `hashes`. The member adds its own `nonce` and `updateId`, so `verifyProof`
    // returns `true` only for the leaf value that the member selected. The result is
    // the SMT Proof that the member keeps for resolution.
    const smtProof: SerializedSMTProof = {
      id        : received.id,
      ...(nonce === undefined ? {} : { nonce: encode(nonce) }),
      ...(updateId === undefined ? {} : { updateId: hashToBase64Url(updateId) }),
      collapsed : received.collapsed,
      hashes    : received.hashes,
    };
    return { matches: verifyProof(smtProof, participantDid), smtProof };
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
