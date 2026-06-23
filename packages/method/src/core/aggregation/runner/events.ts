import type { SerializedSMTProof } from '@did-btcr2/smt';
import type { CohortAdvert, PendingFallbackRequest, PendingSigningRequest, PendingValidation } from '../participant.js';
import type { AggregationResult, PendingOptIn, Rejection } from '../service.js';

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
  beaconType: string;
  /** True if this participant submitted an update; false if it declined (non-inclusion). */
  included: boolean;
  /** DID to base64url update hash. Populated only for CAS beacons. */
  casAnnouncement?: Record<string, string>;
  /** Inclusion proof (submitter) or non-inclusion proof (decliner) for this slot. Populated only for SMT beacons. */
  smtProof?: SerializedSMTProof;
}

/**
 * AggregationServiceRunner events are emitted by the AggregationServiceRunner to signal important
 * milestones and actions during the aggregation process. They can be listened to by external code
 * to react to these events, such as logging, updating a UI, or triggering additional actions.
 */
export type AggregationServiceEvents = {
  /** A cohort has been created and the advert message broadcast. */
  'cohort-advertised': [{ cohortId: string }];

  /** A participant has opted in. Fires before the accept decision callback. */
  'opt-in-received': [PendingOptIn];

  /** A participant has been accepted into the cohort. */
  'participant-accepted': [{ cohortId: string; participantDid: string }];

  /** Keygen has been finalized: beacon address is now available. */
  'keygen-complete': [{ cohortId: string; beaconAddress: string }];

  /** A participant has submitted a signed update. */
  'update-received': [{ cohortId: string; participantDid: string }];

  /**
   * An inbound message was silently dropped by the state machine (bad proof,
   * oversized payload, wrong wire version, etc.). Fires for *any* rejection,
   * not just SUBMIT_UPDATE.
   */
  'message-rejected': [Rejection & { cohortId: string }];

  /** Aggregated data has been distributed to all participants for validation. */
  'data-distributed': [{ cohortId: string }];

  /** A participant has acknowledged validation (approved or rejected). */
  'validation-received': [{ cohortId: string; participantDid: string; approved: boolean }];

  /** Signing has started: auth requests sent to participants. */
  'signing-started': [{ cohortId: string; sessionId: string }];

  /**
   * The optimistic n-of-n key path was abandoned and the k-of-n fallback
   * (script-path) signing round started (ADR 042). After this, the cohort
   * completes via the fallback once k members sign.
   */
  'fallback-started': [{ cohortId: string; sessionId: string }];

  /** A participant has contributed their MuSig2 nonce. */
  'nonce-received': [{ cohortId: string; participantDid: string }];

  /** Signing complete: final aggregated signature is ready to broadcast. */
  'signing-complete': [AggregationResult];

  /** Cohort transitioned to Failed phase (e.g. a participant rejected validation). */
  'cohort-failed': [{ cohortId: string; reason: string }];

  /** A non-fatal error occurred. Fatal errors reject the run() promise. */
  'error': [Error];
};

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

  /** Participant has submitted their signed update. */
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

  /** Cohort failed (rejected validation, signing error, etc.). */
  'cohort-failed': [{ cohortId: string; reason: string }];

  /** A non-fatal error occurred. */
  'error': [Error];
};
