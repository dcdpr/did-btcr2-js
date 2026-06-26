import type { AggregationResult, PendingOptIn, Rejection } from './service.js';

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
