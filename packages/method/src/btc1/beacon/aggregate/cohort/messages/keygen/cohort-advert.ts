import { Logger, Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_ADVERT } from '../constants.js';

export interface CohortAdvertMessage {
  type?: typeof BEACON_COHORT_ADVERT;
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
    const message = JSON.parse(data);
    if (message.type !== BEACON_COHORT_ADVERT){
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortAdvertMessage(message);
  }
}