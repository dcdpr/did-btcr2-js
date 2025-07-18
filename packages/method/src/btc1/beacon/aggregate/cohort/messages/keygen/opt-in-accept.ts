import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_OPT_IN_ACCEPT } from '../constants.js';

export interface CohortOptInAcceptMessage {
  to: string;
  from: string;
}

/**
 * Represents a message for a coordinator accepting a participant subscribe to a cohort.
 * @class BeaconCohortOptInAcceptMessage
 * @extends BaseMessage
 * @type {BeaconCohortOptInAcceptMessage}
 */
export class BeaconCohortOptInAcceptMessage extends BaseMessage {
  constructor({ to, from }: CohortOptInAcceptMessage) {
    super({ to, from, type: BEACON_COHORT_OPT_IN_ACCEPT });
  }

  /**
   * Initializes a BeaconCohortOptInAcceptMessage from a possible CohortOptInAcceptMessage object.
   * @param {CohortOptInAcceptMessage} data The CohortOptInAcceptMessage object to initialize the BeaconCohortOptInAcceptMessage.
   * @returns {BeaconCohortOptInAcceptMessage} The new BeaconCohortOptInAcceptMessage.
   */
  public static fromJSON(data: Maybe<CohortOptInAcceptMessage>): BeaconCohortOptInAcceptMessage {
    if (data.type != BEACON_COHORT_OPT_IN_ACCEPT) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortOptInAcceptMessage(data);
  }
}