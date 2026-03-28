import { JSONUtils, Maybe } from '@did-btcr2/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_SUBMIT_UPDATE } from '../constants.js';

export interface CohortSubmitUpdateMessage {
  type?: typeof BEACON_COHORT_SUBMIT_UPDATE;
  to: string;
  from: string;
  cohortId: string;
  signedUpdate: Record<string, unknown>;
}

export class BeaconCohortSubmitUpdateMessage extends BaseMessage {

  constructor({ from, to, cohortId, signedUpdate }: CohortSubmitUpdateMessage) {
    const body = { cohortId, signedUpdate };
    const type = BEACON_COHORT_SUBMIT_UPDATE;
    super({ from, to, body, type });
  }

  /**
   * Initializes a BeaconCohortSubmitUpdateMessage from a possible CohortSubmitUpdateMessage object.
   * @param {CohortSubmitUpdateMessage} data The CohortSubmitUpdateMessage object to initialize from.
   * @returns {BeaconCohortSubmitUpdateMessage} The new BeaconCohortSubmitUpdateMessage.
   */
  public static fromJSON(data: Maybe<CohortSubmitUpdateMessage>): BeaconCohortSubmitUpdateMessage {
    const message = JSONUtils.isParsable(data) ? JSON.parse(data) : data;
    if (message.type != BEACON_COHORT_SUBMIT_UPDATE) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortSubmitUpdateMessage(message);
  }
}
