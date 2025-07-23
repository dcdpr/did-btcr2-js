import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_OPT_IN } from '../constants.js';

export interface CohortOptInMessage {
  to: string;
  from: string;
  cohortId: string;
  participantPk: Uint8Array;
}

export class BeaconCohortOptInMessage extends BaseMessage {

  constructor({ from, to, cohortId, participantPk }: CohortOptInMessage) {
    const body = { cohortId, participantPk };
    const type = BEACON_COHORT_OPT_IN;
    super({ from, to, body, type });
  }

  /**
   * Initializes a BeaconCohortOptInMessage from a possible CohortOptInMessage object.
   * @param {CohortOptInMessage} data The CohortOptInMessage object to initialize the BeaconCohortOptInMessage.
   * @returns {BeaconCohortOptInMessage} The new BeaconCohortOptInMessage.
   */
  public static fromJSON(data: Maybe<CohortOptInMessage>): BeaconCohortOptInMessage {
    if (data.type != BEACON_COHORT_OPT_IN) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortOptInMessage(data);
  }
}