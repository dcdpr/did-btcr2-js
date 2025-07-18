import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_ADVERT } from '../constants.js';

export interface CohortAdvertMessage {
  advertId?: string;
  to: string;
  from: string;
  body: {
    cohortId: string;
    cohortSize: number;
    network: string;
  }
}

/**
 * Represents a message advertising a cohort to potential participants.
 * @class BeaconCohortAdvertMessage
 * @extends BaseMessage
 * @type {BeaconCohortAdvertMessage}
 */
export class BeaconCohortAdvertMessage extends BaseMessage {
  public advertId: string;
  public cohortId: string;
  public cohortSize: number;
  public network: string;

  constructor(advertMessage: CohortAdvertMessage) {
    super({ ...advertMessage, type: BEACON_COHORT_ADVERT });
    this.advertId = `${BEACON_COHORT_ADVERT}/${advertMessage.body.cohortId}`;
    this.cohortId = advertMessage.body.cohortId;
    this.cohortSize = advertMessage.body.cohortSize;
    this.network = advertMessage.body.network;
  }

  /**
   * Initializes a BeaconCohortAdvertMessage from a possible CohortAdvertMessage object.
   * @param {CohortAdvertMessage} data The CohortAdvertMessage object to initialize the BeaconCohortAdvertMessage.
   * @returns {BeaconCohortAdvertMessage} The new BeaconCohortAdvertMessage.
   */
  public static initialize(data: Maybe<CohortAdvertMessage>): BeaconCohortAdvertMessage {
    if (data.type != BEACON_COHORT_ADVERT){
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortAdvertMessage(data);
  }
}