import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_ADVERT } from '../constants.js';

export interface CohortAdvertMessage {
  from: string;
  cohortId: string;
  cohortSize: number;
  network: string;
  advertId?: string;
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

  constructor({ from, cohortId, cohortSize, network }: CohortAdvertMessage) {
    super({ from, body: { cohortId, cohortSize, network }, type: BEACON_COHORT_ADVERT });
    this.advertId = `${BEACON_COHORT_ADVERT}/${cohortId}`;
    this.cohortId = cohortId;
    this.cohortSize = cohortSize;
    this.network = network;
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