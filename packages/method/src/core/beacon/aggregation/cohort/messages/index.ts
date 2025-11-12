import {
  BEACON_COHORT_ADVERT,
  BEACON_COHORT_AGGREGATED_NONCE,
  BEACON_COHORT_AUTHORIZATION_REQUEST,
  BEACON_COHORT_NONCE_CONTRIBUTION,
  BEACON_COHORT_OPT_IN,
  BEACON_COHORT_OPT_IN_ACCEPT,
  BEACON_COHORT_READY,
  BEACON_COHORT_REQUEST_SIGNATURE,
  BEACON_COHORT_SIGNATURE_AUTHORIZATION
} from './constants.js';
import { CohortAdvertMessage } from './keygen/cohort-advert.js';
import { CohortReadyMessage } from './keygen/cohort-ready.js';
import { CohortOptInAcceptMessage } from './keygen/opt-in-accept.js';
import { CohortOptInMessage } from './keygen/opt-in.js';
import { CohortSubscribeMessage } from './keygen/subscribe.js';
import { CohortAggregatedNonceMessage } from './sign/aggregated-nonce.js';
import { CohortAuthorizationRequestMessage } from './sign/authorization-request.js';
import { CohortNonceContributionMessage } from './sign/nonce-contribution.js';
import { CohortRequestSignatureMessage } from './sign/request-signature.js';
import { CohortSignatureAuthorizationMessage } from './sign/signature-authorization.js';

export type KeyGenMessageType =
  | CohortAdvertMessage
  | CohortReadyMessage
  | CohortOptInMessage
  | CohortOptInAcceptMessage
  | CohortSubscribeMessage;

export type SignMessageType =
  | CohortAggregatedNonceMessage
  | CohortAuthorizationRequestMessage
  | CohortNonceContributionMessage
  | CohortRequestSignatureMessage
  | CohortSignatureAuthorizationMessage;

export type AggregateBeaconMessageType = KeyGenMessageType | SignMessageType;

/**
 * AggregateBeaconMessage is a utility class that provides constants and type checks
 * for various message types used in the aggregate beacon communication protocol.
 * It includes methods to validate message types and retrieve message types from objects.
 * @class AggregateBeaconMessage
 * @type {AggregateBeaconMessageType}
 */
export class AggregateBeaconMessage {
  static BEACON_COHORT_ADVERT = BEACON_COHORT_ADVERT;
  static BEACON_COHORT_OPT_IN = BEACON_COHORT_OPT_IN;
  static BEACON_COHORT_READY = BEACON_COHORT_READY;
  static BEACON_COHORT_OPT_IN_ACCEPT = BEACON_COHORT_OPT_IN_ACCEPT;

  static BEACON_COHORT_KEY_GEN_MESSAGES: Map<string, string> = new Map([
    ['BEACON_COHORT_ADVERT', 'BEACON_COHORT_ADVERT'],
    ['BEACON_COHORT_OPT_IN', 'BEACON_COHORT_OPT_IN'],
    ['BEACON_COHORT_READY', 'BEACON_COHORT_READY'],
    ['BEACON_COHORT_OPT_IN_ACCEPT', 'BEACON_COHORT_OPT_IN_ACCEPT'],
  ]);

  static BEACON_COHORT_REQUEST_SIGNATURE = BEACON_COHORT_REQUEST_SIGNATURE;
  static BEACON_COHORT_AUTHORIZATION_REQUEST = BEACON_COHORT_AUTHORIZATION_REQUEST;
  static BEACON_COHORT_NONCE_CONTRIBUTION = BEACON_COHORT_NONCE_CONTRIBUTION;
  static BEACON_COHORT_AGGREGATED_NONCE = BEACON_COHORT_AGGREGATED_NONCE;
  static BEACON_COHORT_SIGNATURE_AUTHORIZATION = BEACON_COHORT_SIGNATURE_AUTHORIZATION;

  static BEACON_COHORT_SIGN_MESSAGES: Map<string, string> = new Map([
    ['BEACON_COHORT_REQUEST_SIGNATURE', 'BEACON_COHORT_REQUEST_SIGNATURE'],
    ['BEACON_COHORT_AUTHORIZATION_REQUEST', 'BEACON_COHORT_AUTHORIZATION_REQUEST'],
    ['BEACON_COHORT_NONCE_CONTRIBUTION', 'BEACON_COHORT_NONCE_CONTRIBUTION'],
    ['BEACON_COHORT_AGGREGATED_NONCE', 'BEACON_COHORT_AGGREGATED_NONCE'],
    ['BEACON_COHORT_SIGNATURE_AUTHORIZATION', 'BEACON_COHORT_SIGNATURE_AUTHORIZATION'],
  ]);

  static ALL_MESSAGES: string[] = [
    BEACON_COHORT_ADVERT,
    BEACON_COHORT_OPT_IN,
    BEACON_COHORT_READY,
    BEACON_COHORT_OPT_IN_ACCEPT,
    BEACON_COHORT_REQUEST_SIGNATURE,
    BEACON_COHORT_AUTHORIZATION_REQUEST,
    BEACON_COHORT_NONCE_CONTRIBUTION,
    BEACON_COHORT_AGGREGATED_NONCE,
    BEACON_COHORT_SIGNATURE_AUTHORIZATION
  ];

  /**
   * Checks if the name provided is a valid message name.
   * @param {string} type - The type of the message.
   * @returns
   */
  static isValidType(type: string): boolean {
    return this.BEACON_COHORT_KEY_GEN_MESSAGES.has(type) || this.BEACON_COHORT_SIGN_MESSAGES.has(type);
  }

  /**
   * Get the message value based on the type.
   * @param {string} type - The type (or name) of the message.
   * @returns {string | undefined} - The corresponding type value.
   */
  static getMessageValueByType(type: string): string | undefined {
    if(!this.isValidType(type)) {
      return undefined;
    }
    return this.BEACON_COHORT_KEY_GEN_MESSAGES.get(type) || this.BEACON_COHORT_SIGN_MESSAGES.get(type);
  }

  /**
   * Checks if the provided type is a valid AggregateBeaconMessageType.
   * @param {string} type - The message type to check.
   * @returns {boolean} - Returns true if the type is valid, otherwise false.
   */
  static isValidValue(type: string): boolean {
    return this.ALL_MESSAGES.includes(type);
  }

  /**
   * Checks if the provided type is a valid KeyGenMessageType.
   * @param {string} value - The message type to check.
   * @returns {boolean} - Returns true if the type is a key generation message type, otherwise false.
   */
  static isKeyGenMessageValue(value: string): boolean {
    return this.isValidValue(value) && [
      BEACON_COHORT_ADVERT,
      BEACON_COHORT_READY,
      BEACON_COHORT_OPT_IN,
      BEACON_COHORT_OPT_IN_ACCEPT,
    ].includes(value);
  }

  /**
   * Checks if the provided type is a valid SignMessageType.
   * @param {string} value - The message type to check.
   * @returns {boolean} - Returns true if the type is a sign message type, otherwise false.
   */
  static isSignMessageValue(value: string): boolean {
    return this.isValidValue(value) && [
      BEACON_COHORT_AGGREGATED_NONCE,
      BEACON_COHORT_AUTHORIZATION_REQUEST,
      BEACON_COHORT_NONCE_CONTRIBUTION,
      BEACON_COHORT_REQUEST_SIGNATURE,
      BEACON_COHORT_SIGNATURE_AUTHORIZATION
    ].includes(value);
  }
}