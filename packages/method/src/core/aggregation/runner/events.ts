import type { SerializedSMTProof } from '@did-btcr2/smt';
import type { CohortAdvert, PendingSigningRequest, PendingValidation } from '../participant.js';
import type { AggregationResult, PendingOptIn } from '../service.js';

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
  'participant-accepted': [{ participantDid: string }];

  /** Keygen has been finalized — beacon address is now available. */
  'keygen-complete': [{ cohortId: string; beaconAddress: string }];

  /** A participant has submitted a signed update. */
  'update-received': [{ participantDid: string }];

  /** Aggregated data has been distributed to all participants for validation. */
  'data-distributed': [{ cohortId: string }];

  /** A participant has acknowledged validation (approved or rejected). */
  'validation-received': [{ participantDid: string; approved: boolean }];

  /** Signing has started — auth requests sent to participants. */
  'signing-started': [{ sessionId: string }];

  /** A participant has contributed their MuSig2 nonce. */
  'nonce-received': [{ participantDid: string }];

  /** Signing complete — final aggregated signature is ready to broadcast. */
  'signing-complete': [AggregationResult];

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

  /** Cohort keygen is complete — beacon address is now available. */
  'cohort-ready': [{ cohortId: string; beaconAddress: string }];

  /** Participant has submitted their signed update. */
  'update-submitted': [{ cohortId: string }];

  /** Aggregated data has arrived for validation. Fires before the validate callback. */
  'validation-requested': [PendingValidation];

  /** Signing request has arrived. Fires before the sign approval callback. */
  'signing-requested': [PendingSigningRequest];

  /**
   * Cohort signing is complete from this participant's perspective.
   * Includes the aggregated sidecar data the participant needs to keep for
   * future DID resolution: the CAS Announcement map (for CAS beacons) or the
   * SMT inclusion proof (for SMT beacons).
   */
  'cohort-complete': [{
    cohortId: string;
    beaconAddress: string;
    beaconType: string;
    /** DID → base64url update hash. Populated only for CAS beacons. */
    casAnnouncement?: Record<string, string>;
    /** Merkle inclusion proof for this participant's slot. Populated only for SMT beacons. */
    smtProof?: SerializedSMTProof;
  }];

  /** Cohort failed (rejected validation, signing error, etc.). */
  'cohort-failed': [{ cohortId: string; reason: string }];

  /** A non-fatal error occurred. */
  'error': [Error];
};
