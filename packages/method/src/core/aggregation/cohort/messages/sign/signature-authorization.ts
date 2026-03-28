import { JSONUtils, Maybe } from '@did-btcr2/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_SIGNATURE_AUTHORIZATION } from '../constants.js';

export type CohortSignatureAuthorizationMessage = {
  to: string;
  from: string;
  cohortId: string;
  sessionId: string;
  partialSignature: Uint8Array;
}

/**
 * Participant → Coordinator. Delivers the participant’s partial signature over
 * the PSBT, authorizing the final Beacon signal (transaction) once all signatures
 * are collected.
 * @class BeaconCohortSignatureAuthorizationMessage
 * @extends BaseMessage
 * @type {BeaconCohortSignatureAuthorizationMessage}
 */
export class BeaconCohortSignatureAuthorizationMessage extends BaseMessage {
  constructor({ to, from, cohortId, sessionId, partialSignature }: CohortSignatureAuthorizationMessage) {
    const body = { cohortId, sessionId, partialSignature };
    const type = BEACON_COHORT_SIGNATURE_AUTHORIZATION;
    super({ to, from, body, type });
  }

  /**
   * Initializes an BeaconCohortSignatureAuthorizationMessage from a given CohortSignatureAuthorizationMessage object.
   * @param {CohortSignatureAuthorizationMessage} data The data object to initialize the BeaconCohortSignatureAuthorizationMessage.
   * @returns {BeaconCohortSignatureAuthorizationMessage} The serialized BeaconCohortSignatureAuthorizationMessage.
   */
  public static fromJSON(data: Maybe<CohortSignatureAuthorizationMessage>): BeaconCohortSignatureAuthorizationMessage {
    const message = JSONUtils.isParsable(data) ? JSON.parse(data) : data;
    if (message.type != BEACON_COHORT_SIGNATURE_AUTHORIZATION) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortSignatureAuthorizationMessage(message);
  }
}