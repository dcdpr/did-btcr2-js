import { Maybe } from '@did-btcr2/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_OPT_IN_ACCEPT } from '../constants.js';

export interface CohortOptInAcceptMessage {
  type?: typeof BEACON_COHORT_OPT_IN_ACCEPT;
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
    const message = JSON.parse(data);
    if (message.type != BEACON_COHORT_OPT_IN_ACCEPT) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortOptInAcceptMessage(message);
  }
}