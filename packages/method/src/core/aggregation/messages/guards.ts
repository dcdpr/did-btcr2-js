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

const KEYGEN_VALUES: Set<string> = new Set([
  COHORT_ADVERT,
  COHORT_OPT_IN,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
]);

const UPDATE_VALUES: Set<string> = new Set([
  SUBMIT_UPDATE,
  DISTRIBUTE_AGGREGATED_DATA,
  VALIDATION_ACK,
]);

const SIGN_VALUES: Set<string> = new Set([
  AUTHORIZATION_REQUEST,
  NONCE_CONTRIBUTION,
  AGGREGATED_NONCE,
  SIGNATURE_AUTHORIZATION,
]);

/**
 * Checks if the provided type is a valid aggregation message type.
 */
export function isAggregationMessageType(type: string): boolean {
  return KEYGEN_VALUES.has(type) || UPDATE_VALUES.has(type) || SIGN_VALUES.has(type);
}

/** Checks if the message type belongs to the keygen phase. */
export function isKeygenMessageType(type: string): boolean {
  return KEYGEN_VALUES.has(type);
}

/** Checks if the message type belongs to the update phase. */
export function isUpdateMessageType(type: string): boolean {
  return UPDATE_VALUES.has(type);
}

/** Checks if the message type belongs to the signing phase. */
export function isSignMessageType(type: string): boolean {
  return SIGN_VALUES.has(type);
}
