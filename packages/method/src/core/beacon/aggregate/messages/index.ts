import {
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
  COHORT_ADVERT,
  COHORT_INVITE,
  COHORT_SET,
  NONCE_CONTRIBUTION,
  OPT_IN,
  REQUEST_SIGNATURE,
  SIGNATURE_AUTHORIZATION,
  SUBSCRIBE,
  SUBSCRIBE_ACCEPT
} from './constants.js';
import { CohortAdvertMessage } from './keygen/cohort-advert.js';
import { CohortSetMessage } from './keygen/cohort-set.js';
import { OptInMessage } from './keygen/opt-in.js';
import { SubscribeAcceptMessage } from './keygen/subscribe-accept.js';
import { SubscribeMessage } from './keygen/subscribe.js';
import { AggregatedNonceMessage } from './sign/aggregated-nonce.js';
import { AuthorizationRequestMessage } from './sign/authorization-request.js';
import { NonceContributionMessage } from './sign/nonce-contribution.js';
import { RequestSignatureMessage } from './sign/request-signature.js';
import { SignatureAuthorizationMessage } from './sign/signature-authorization.js';

export type KeyGenMessageType =
  | CohortAdvertMessage
  | CohortSetMessage
  | OptInMessage
  | SubscribeAcceptMessage
  | SubscribeMessage;

export type SignMessageType =
  | AggregatedNonceMessage
  | AuthorizationRequestMessage
  | NonceContributionMessage
  | RequestSignatureMessage
  | SignatureAuthorizationMessage;

export type AggregateBeaconMessageType = KeyGenMessageType | SignMessageType;

/**
 * AggregateBeaconMessage is a utility class that provides constants and type checks
 * for various message types used in the aggregate beacon communication protocol.
 * It includes methods to validate message types and retrieve message types from objects.
 * @class AggregateBeaconMessage
 * @type {AggregateBeaconMessageType}
 */
export class AggregateBeaconMessage {
  static COHORT_ADVERT = COHORT_ADVERT;
  static COHORT_INVITE = COHORT_INVITE;
  static OPT_IN = OPT_IN;
  static COHORT_SET = COHORT_SET;
  static SUBSCRIBE = SUBSCRIBE;
  static SUBSCRIBE_ACCEPT = SUBSCRIBE_ACCEPT;

  static REQUEST_SIGNATURE = REQUEST_SIGNATURE;
  static AUTHORIZATION_REQUEST = AUTHORIZATION_REQUEST;
  static NONCE_CONTRIBUTION = NONCE_CONTRIBUTION;
  static AGGREGATED_NONCE = AGGREGATED_NONCE;
  static SIGNATURE_AUTHORIZATION = SIGNATURE_AUTHORIZATION;

  static ALL_MESSAGES: string[] = [
    COHORT_ADVERT,
    COHORT_INVITE,
    OPT_IN,
    COHORT_SET,
    SUBSCRIBE,
    SUBSCRIBE_ACCEPT,
    REQUEST_SIGNATURE,
    AUTHORIZATION_REQUEST,
    NONCE_CONTRIBUTION,
    AGGREGATED_NONCE,
    SIGNATURE_AUTHORIZATION
  ];

  /**
   * Checks if the provided type is a valid AggregateBeaconMessageType.
   * @param {string} type - The message type to check.
   * @returns {boolean} - Returns true if the type is valid, otherwise false.
   */
  static isValidType(type: string): boolean {
    return this.ALL_MESSAGES.includes(type);
  }

  /**
   * Checks if the provided type is a valid KeyGenMessageType.
   * @param {string} type - The message type to check.
   * @returns {boolean} - Returns true if the type is a key generation message type, otherwise false.
   */
  static isKeyGenMessageType(type: string): boolean {
    return [
      COHORT_ADVERT,
      COHORT_SET,
      OPT_IN,
      SUBSCRIBE_ACCEPT,
      SUBSCRIBE
    ].includes(type);
  }

  /**
   * Checks if the provided type is a valid SignMessageType.
   * @param {string} type - The message type to check.
   * @returns {boolean} - Returns true if the type is a sign message type, otherwise false.
   */
  static isSignMessageType(type: string): boolean {
    return [
      AGGREGATED_NONCE,
      AUTHORIZATION_REQUEST,
      NONCE_CONTRIBUTION,
      REQUEST_SIGNATURE,
      SIGNATURE_AUTHORIZATION
    ].includes(type);
  }

  /**
   * Checks if the provided message is of a valid AggregateBeaconMessageType.
   * @param {Object} message - The message object to check.
   * @returns {AggregateBeaconMessageType | undefined} - Returns the message type if valid, otherwise undefined.
   */
  static getTypeFromMessage(message: { type: string }): AggregateBeaconMessageType | undefined {
    if (this.isValidType(message.type)) {
      return message as AggregateBeaconMessageType;
    }
    return undefined;
  }
}