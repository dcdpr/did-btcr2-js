import { JSONUtils, Maybe } from '@did-btcr2/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_DISTRIBUTE_DATA } from '../constants.js';

export interface CohortDistributeDataMessage {
  type?: typeof BEACON_COHORT_DISTRIBUTE_DATA;
  to: string;
  from: string;
  cohortId: string;
  beaconType: string;
  signalBytesHex: string;
  casAnnouncement?: Record<string, string>;
  smtProof?: Record<string, unknown>;
}

export class BeaconCohortDistributeDataMessage extends BaseMessage {

  constructor({ from, to, cohortId, beaconType, signalBytesHex, casAnnouncement, smtProof }: CohortDistributeDataMessage) {
    const body = { cohortId, beaconType, signalBytesHex, casAnnouncement, smtProof };
    const type = BEACON_COHORT_DISTRIBUTE_DATA;
    super({ from, to, body, type });
  }

  /**
   * Initializes a BeaconCohortDistributeDataMessage from a possible CohortDistributeDataMessage object.
   * @param {CohortDistributeDataMessage} data The data object to initialize from.
   * @returns {BeaconCohortDistributeDataMessage} The new message instance.
   */
  public static fromJSON(data: Maybe<CohortDistributeDataMessage>): BeaconCohortDistributeDataMessage {
    const message = JSONUtils.isParsable(data) ? JSON.parse(data) : data;
    if (message.type != BEACON_COHORT_DISTRIBUTE_DATA) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortDistributeDataMessage(message);
  }
}
