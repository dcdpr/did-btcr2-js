import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_READY } from '../constants.js';

export interface CohortReadyMessage {
  type?: typeof BEACON_COHORT_READY;
  to: string;
  from: string;
  cohortId: string;
  beaconAddress: string;
  cohortKeys: Array<Uint8Array>;
}

/**
 * Represents a message indicating that a cohort has met the required conditions.
 * @class BeaconCohortReadyMessage
 * @extends BaseMessage
 * @type {BeaconCohortReadyMessage}
 */
export class BeaconCohortReadyMessage extends BaseMessage {
  constructor({ from, to, cohortId, beaconAddress, cohortKeys }: CohortReadyMessage) {
    const body = { cohortId, beaconAddress, cohortKeys };
    const type = BEACON_COHORT_READY;
    super({ from, to, body, type });
  }

  /**
   * Initializes an BeaconCohortReadyMessage from a given OptIn object.
   * @param {CohortReadyMessage} data The CohortReadyMessage object to initialize the BeaconCohortReadyMessage.
   * @returns {BeaconCohortReadyMessage} The new BeaconCohortReadyMessage.
   */
  public static fromJSON(data: Maybe<CohortReadyMessage>): BeaconCohortReadyMessage {
    const message = JSON.parse(data);
    if (message.type !== BEACON_COHORT_READY) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortReadyMessage(message);
  }
}