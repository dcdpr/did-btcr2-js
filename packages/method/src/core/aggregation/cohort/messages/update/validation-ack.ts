import { JSONUtils, Maybe } from '@did-btcr2/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_VALIDATION_ACK } from '../constants.js';

export interface CohortValidationAckMessage {
  type?: typeof BEACON_COHORT_VALIDATION_ACK;
  to: string;
  from: string;
  cohortId: string;
  approved: boolean;
}

export class BeaconCohortValidationAckMessage extends BaseMessage {

  constructor({ from, to, cohortId, approved }: CohortValidationAckMessage) {
    const body = { cohortId, approved };
    const type = BEACON_COHORT_VALIDATION_ACK;
    super({ from, to, body, type });
  }

  /**
   * Initializes a BeaconCohortValidationAckMessage from a possible CohortValidationAckMessage object.
   * @param {CohortValidationAckMessage} data The data object to initialize from.
   * @returns {BeaconCohortValidationAckMessage} The new message instance.
   */
  public static fromJSON(data: Maybe<CohortValidationAckMessage>): BeaconCohortValidationAckMessage {
    const message = JSONUtils.isParsable(data) ? JSON.parse(data) : data;
    if (message.type != BEACON_COHORT_VALIDATION_ACK) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortValidationAckMessage(message);
  }
}
