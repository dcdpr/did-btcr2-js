import { Maybe } from '@did-btc1/common';
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
  public cohortId: string;
  public sessionId: string;
  public partialSignature: Uint8Array;

  constructor(sigAuthMessage: CohortSignatureAuthorizationMessage) {
    super({ ...sigAuthMessage, type: BEACON_COHORT_SIGNATURE_AUTHORIZATION });
    this.cohortId = sigAuthMessage.cohortId;
    this.sessionId = sigAuthMessage.sessionId;
    this.partialSignature = sigAuthMessage.partialSignature;
  }

  /**
   * Initializes an BeaconCohortSignatureAuthorizationMessage from a given CohortSignatureAuthorizationMessage object.
   * @param {CohortSignatureAuthorizationMessage} data The data object to initialize the BeaconCohortSignatureAuthorizationMessage.
   * @returns {BeaconCohortSignatureAuthorizationMessage} The serialized BeaconCohortSignatureAuthorizationMessage.
   */
  public static fromJSON(data: Maybe<CohortSignatureAuthorizationMessage>): BeaconCohortSignatureAuthorizationMessage {
    if (data.type != BEACON_COHORT_SIGNATURE_AUTHORIZATION) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortSignatureAuthorizationMessage(data);
  }
}