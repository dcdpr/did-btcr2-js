import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_ADVERT } from '../constants.js';

export interface CohortAdvertMessage {
  id?: string;
  from: string;
  cohortId: string;
  cohortSize: number;
  beaconType: string;
  network: string;
}

/**
 * Represents a message advertising a cohort to potential participants.
 * @class BeaconCohortAdvertMessage
 * @extends BaseMessage
 * @type {BeaconCohortAdvertMessage}
 */
export class BeaconCohortAdvertMessage extends BaseMessage {
  public id: string;

  constructor({ from, id, cohortId, cohortSize, beaconType, network }: CohortAdvertMessage) {
    const body = { cohortId, cohortSize, beaconType, network };
    const type = BEACON_COHORT_ADVERT;
    super({ from, body, type });
    this.id = id || `${type}/${cohortId}`;
  }

  /**
   * Initializes a BeaconCohortAdvertMessage from a possible CohortAdvertMessage object.
   * @param {CohortAdvertMessage} data The CohortAdvertMessage object to initialize the BeaconCohortAdvertMessage.
   * @returns {BeaconCohortAdvertMessage} The new BeaconCohortAdvertMessage.
   */
  public static fromJSON(data: Maybe<CohortAdvertMessage>): BeaconCohortAdvertMessage {
    if (data.type != BEACON_COHORT_ADVERT){
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortAdvertMessage(data);
  }
}