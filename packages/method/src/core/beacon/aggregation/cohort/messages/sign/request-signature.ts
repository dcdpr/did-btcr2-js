import { Maybe } from '@did-btcr2/common';
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
  constructor({ to, from, cohortId, sessionId, data }: CohortRequestSignatureMessage) {
    const body = { cohortId, sessionId, data };
    const type = BEACON_COHORT_REQUEST_SIGNATURE;
    super({ to, from, body, type });
  }

  /**
   * Initializes an BeaconCohortRequestSignatureMessage from a possible CohortRequestSignatureMessage object.
   * @param {CohortRequestSignatureMessage} data The data object to initialize the BeaconCohortRequestSignatureMessage.
   * @returns {BeaconCohortRequestSignatureMessage} The new BeaconCohortRequestSignatureMessage.
   */
  public static fromJSON(data: Maybe<CohortRequestSignatureMessage>): BeaconCohortRequestSignatureMessage {
    const message = JSON.parse(data);
    if (message.type != BEACON_COHORT_REQUEST_SIGNATURE) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortRequestSignatureMessage(message);
  }
}