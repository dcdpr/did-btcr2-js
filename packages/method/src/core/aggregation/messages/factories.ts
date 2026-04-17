import { BaseMessage } from './base.js';
import {
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  DISTRIBUTE_AGGREGATED_DATA,
  NONCE_CONTRIBUTION,
  SIGNATURE_AUTHORIZATION,
  SUBMIT_UPDATE,
  VALIDATION_ACK,
} from './constants.js';

/**
 * Step 1: Cohort Formation
 * Factory functions for creating messages related to the cohort formation step, where cohorts are
 * formed and participants opt in to join the cohort.
 */
type CohortAdvertMessage = {
  from: string;
  cohortId: string;
  cohortSize: number;
  beaconType: string;
  network: string;
  communicationPk: Uint8Array;
};
type CohortOptInMessage = {
  from: string;
  to: string;
  cohortId: string;
  participantPk: Uint8Array;
  communicationPk: Uint8Array;
};
type CohortOptInAcceptMessage = {
  from: string;
  to: string;
  cohortId: string;
};
type CohortReadyMessage = {
  from: string;
  to: string;
  cohortId: string;
  beaconAddress: string;
  cohortKeys: Array<Uint8Array>;
};

/**
 * Factory function for creating a Cohort Advert message, which is used to announce the formation of
 * a new cohort and invite participants to join.
 * @param {CohortAdvertMessage} fields - The fields required to create a Cohort Advert message.
 * @returns {BaseMessage} The created Cohort Advert message.
 */
export function createCohortAdvertMessage(fields: CohortAdvertMessage): BaseMessage {
  const { from, ...body } = fields;
  return new BaseMessage({ type: COHORT_ADVERT, from, body });
}

/**
 * Factory function for creating a Cohort Opt-In message, which is sent by a participant to express
 * interest in joining a cohort.
 * @param {CohortOptInMessage} fields - The fields required to create a Cohort Opt-In message, which
 * is sent by a participant to express interest in joining a cohort.
 * @returns {BaseMessage} The created Cohort Opt-In message.
 */
export function createCohortOptInMessage(fields: CohortOptInMessage): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: COHORT_OPT_IN, from, to, body });
}

export function createCohortOptInAcceptMessage(fields: CohortOptInAcceptMessage): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: COHORT_OPT_IN_ACCEPT, from, to, body });
}

export function createCohortReadyMessage(fields: CohortReadyMessage): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: COHORT_READY, from, to, body });
}

/**
 * Step 2: Update Submission
 * Factory functions for creating messages related to the update submission step, where participants
 * submit their signed updates for aggregation.
 */
type SubmitUpdateMessage = {
  from: string;
  to: string;
  cohortId: string;
  signedUpdate: Record<string, unknown>;
};

/**
 * Factory function for creating a Submit Update message, which is sent by a participant to submit
 * their signed update for aggregation.
 * @param {SubmitUpdateMessage} fields - The fields required to create a Submit Update message,
 * which is sent by a participant to submit their signed update for aggregation.
 * @returns {BaseMessage} The created Submit Update message.
 */
export function createSubmitUpdateMessage(fields: SubmitUpdateMessage): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: SUBMIT_UPDATE, from, to, body });
}

/**
 * Step 3: Aggregate & Validate
 * Factory functions for creating messages related to the aggregate and validate step, where
 * participants aggregate their updates and validate the aggregated data.
 */

type DistributeAggregatedDataMessage = {
  from: string;
  to: string;
  cohortId: string;
  beaconType: string;
  signalBytesHex: string;
  casAnnouncement?: Record<string, string>;
  smtProof?: Record<string, unknown>;
};
type ValidationAckMessage = {
  from: string;
  to: string;
  cohortId: string;
  approved: boolean;
};

/**
 * Factory function for creating a Distribute Aggregated Data message, which is sent by the
 * aggregator to distribute the aggregated data to participants for validation.
 * @param {DistributeAggregatedDataMessage} fields - The fields required to create a Distribute
 * Aggregated Data message, which is sent by the aggregator to distribute the aggregated data to
 * participants for validation.
 * @returns {BaseMessage} The created Distribute Aggregated Data message.
 */
export function createDistributeAggregatedDataMessage(
  fields: DistributeAggregatedDataMessage
): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: DISTRIBUTE_AGGREGATED_DATA, from, to, body });
}

/**
 * Factory function for creating a Validation Acknowledgment message, which is sent by a participant
 * to acknowledge.
 * @param {ValidationAckMessage} fields - The fields required to create a Validation Acknowledgment
 * message, which is sent by a participant to acknowledge the validation of the aggregated data.
 * @returns {BaseMessage} The created Validation Acknowledgment message.
 */
export function createValidationAckMessage(fields: ValidationAckMessage): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: VALIDATION_ACK, from, to, body });
}

/**
 * Step 4: Signing
 * Factory functions for creating messages related to the signing step, where participants request
 * signatures, contribute nonces, and authorize signatures.
 */

type AuthorizationRequestMessage = {
  from: string;
  to: string;
  cohortId: string;
  sessionId: string;
  pendingTx: string;
  prevOutScriptHex: string;
  prevOutValue: string;
};
type NonceContributionMessage = {
  from: string;
  to: string;
  cohortId: string;
  sessionId: string;
  nonceContribution: Uint8Array;
};
type AggregatedNonceMessage = {
  from: string;
  to: string;
  cohortId: string;
  sessionId: string;
  aggregatedNonce: Uint8Array;
};
type SignatureAuthorizationMessage = {
  from: string;
  to: string;
  cohortId: string;
  sessionId: string;
  partialSignature: Uint8Array;
};

/**
 * Factory function for creating an Authorization Request message, which is sent by a participant to
 * request authorization for their signature.
 * @param {AuthorizationRequestMessage} fields - The fields required to create an Authorization
 * Request message, which is sent by a participant to request authorization for their signature.
 * @returns {BaseMessage} The created Authorization Request message.
 */
export function createAuthorizationRequestMessage(fields: AuthorizationRequestMessage): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: AUTHORIZATION_REQUEST, from, to, body });
}

/**
 * Factory function for creating a Nonce Contribution message, which is sent by a participant to
 * contribute their nonce for the signature aggregation process.
 * @param {NonceContributionMessage} fields - The fields required to create a Nonce Contribution
 * message, which is sent by a participant to contribute their nonce for the signature aggregation
 * process.
 * @returns {BaseMessage} The created Nonce Contribution message.
 */
export function createNonceContributionMessage(fields: NonceContributionMessage): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: NONCE_CONTRIBUTION, from, to, body });
}

/**
 * Factory function for creating an Aggregated Nonce message, which is sent by the aggregator to
 * distribute the aggregated nonce to participants for the signature aggregation process.
 * @param {AggregatedNonceMessage} fields - The fields required to create an Aggregated Nonce
 * message, which is sent by the aggregator to distribute the aggregated nonce to participants for
 * the signature aggregation process.
 * @returns {BaseMessage} The created Aggregated Nonce message.
 */
export function createAggregatedNonceMessage(fields: AggregatedNonceMessage): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: AGGREGATED_NONCE, from, to, body });
}

/**
 * Factory function for creating a Signature Authorization message, which is sent by a participant
 * to authorize their partial signature for the signature aggregation process.
 * @param {SignatureAuthorizationMessage} fields - The fields required to create a Signature
 * Authorization message, which is sent by a participant to authorize their partial signature for
 * the signature aggregation process.
 * @returns {BaseMessage} The created Signature Authorization message.
 */
export function createSignatureAuthorizationMessage(fields: SignatureAuthorizationMessage): BaseMessage {
  const { from, to, ...body } = fields;
  return new BaseMessage({ type: SIGNATURE_AUTHORIZATION, from, to, body });
}
