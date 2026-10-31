import type { SerializedSMTProof } from '@did-btcr2/smt';
import type { CohortAdvert, PendingFallbackRequest, PendingSigningRequest, PendingValidation } from './participant.js';

/**
 * Sidecar data a participant keeps when a cohort completes from its
 * perspective: the cohort's beacon coordinates plus the off-chain artifact it
 * needs for future DID resolution (the CAS Announcement map for CAS beacons, or
 * the SMT inclusion proof for SMT beacons). Emitted via `cohort-complete` and
 * returned by the participant runner's join helpers.
 */
export interface CohortCompleteInfo {
  cohortId: string;
  beaconAddress: string;
  /** Beacon type of the cohort, from the advert. */
  beaconType: string;
  /** True if this participant submitted an update; false if it declined (non-inclusion). */
  included: boolean;
  /** DID to base64url update hash. Populated only for CAS beacons. */
  casAnnouncement?: Record<string, string>;
  /**
   * The SMT Proof of this slot, with the `nonce` of the member and, for an
   * update, the `updateId`. Populated only for SMT beacons. The caller must
   * persist it: only the participant knows the nonce.
   */
  smtProof?: SerializedSMTProof;
}

/**
 * AggregationParticipantRunner events are emitted by the AggregationParticipantRunner to signal
 * important milestones and actions during the participant's involvement in the aggregation process.
 * They can be listened to by external code to react to these events, such as logging, updating a
 * UI, or triggering additional actions.
 */
export type AggregationParticipantEvents = {
  /** A new cohort advert was discovered. Fires before the shouldJoin filter. */
  'cohort-discovered': [CohortAdvert];

  /** Participant has opted in to a cohort. */
  'cohort-joined': [{ cohortId: string }];

  /** Cohort keygen is complete: beacon address is now available. */
  'cohort-ready': [{ cohortId: string; beaconAddress: string }];

  /** The participant sent the `updateHash` of its update. */
  'update-submitted': [{ cohortId: string }];

  /** Participant declined to submit an update this round (cooperative non-inclusion). */
  'update-declined': [{ cohortId: string }];

  /** Aggregated data has arrived for validation. Fires before the validate callback. */
  'validation-requested': [PendingValidation];

  /** Signing request has arrived. Fires before the sign approval callback. */
  'signing-requested': [PendingSigningRequest];

  /**
   * A fallback (k-of-n script-path) signing request has arrived because the
   * service abandoned the optimistic key path (ADR 042). Fires before the sign
   * approval callback; approving signs the fallback spend.
   */
  'fallback-requested': [PendingFallbackRequest];

  /**
   * Cohort signing is complete from this participant's perspective.
   * Includes the aggregated sidecar data the participant needs to keep for
   * future DID resolution: the CAS Announcement map (for CAS beacons) or the
   * SMT inclusion proof (for SMT beacons).
   */
  'cohort-complete': [CohortCompleteInfo];

  /**
   * Cohort failed. The member rejected the aggregated data, rejected a signing
   * request, or refused a COHORT_READY with BEACON_TYPE_CONFLICT. The other
   * cohorts of the runner continue.
   */
  'cohort-failed': [{ cohortId: string; reason: string }];

  /** A non-fatal error occurred. */
  'error': [Error];
};
