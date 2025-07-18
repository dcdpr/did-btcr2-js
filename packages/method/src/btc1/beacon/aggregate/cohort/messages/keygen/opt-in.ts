import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_OPT_IN } from '../constants.js';

export interface CohortOptInMessage {
  to: string;
  from: string;
  body: {
    cohortId: string;
    participantPk: Uint8Array;
  };
}

export class BeaconCohortOptInMessage extends BaseMessage {
  public cohortId: string;
  public participantPk: Uint8Array;

  constructor(optInMessage: CohortOptInMessage) {
    super({ ...optInMessage, type: BEACON_COHORT_OPT_IN });
    this.cohortId = optInMessage.body.cohortId;
    this.participantPk = optInMessage.body.participantPk;
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