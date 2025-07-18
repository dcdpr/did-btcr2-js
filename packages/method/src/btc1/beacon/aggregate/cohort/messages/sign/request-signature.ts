import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_REQUEST_SIGNATURE } from '../constants.js';

export type CohortRequestSignatureMessage = {
  to: string;
  from: string;
  cohortId: string;
  sessionId?: string;
  data: string;
}

/**
 * Coordinator → Participants. Returns the aggregation of all participant nonces
 * so each participant can produce a correct partial signature.
 * @class BeaconCohortRequestSignatureMessage
 * @extends BaseMessage
 * @type {BeaconCohortRequestSignatureMessage}
 */
export class BeaconCohortRequestSignatureMessage extends BaseMessage {
  public cohortId: string;
  public sessionId?: string;
  public data: string;

  constructor(reqSigMessage: CohortRequestSignatureMessage) {
    super({ ...reqSigMessage, type: BEACON_COHORT_REQUEST_SIGNATURE });
    this.cohortId = reqSigMessage.cohortId;
    this.sessionId = reqSigMessage.sessionId;
    this.data = reqSigMessage.data;
  }

  /**
   * Initializes an BeaconCohortRequestSignatureMessage from a possible CohortRequestSignatureMessage object.
   * @param {CohortRequestSignatureMessage} data The data object to initialize the BeaconCohortRequestSignatureMessage.
   * @returns {BeaconCohortRequestSignatureMessage} The new BeaconCohortRequestSignatureMessage.
   */
  public static fromJSON(data: Maybe<CohortRequestSignatureMessage>): BeaconCohortRequestSignatureMessage {
    if (data.type != BEACON_COHORT_REQUEST_SIGNATURE) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortRequestSignatureMessage(data);
  }
}