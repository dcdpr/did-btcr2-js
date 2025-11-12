import { Maybe } from '@did-btcr2/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_OPT_IN_ACCEPT } from '../constants.js';

export interface CohortSubscribeMessage {
  type?: typeof BEACON_COHORT_OPT_IN_ACCEPT;
  to: string;
  from: string;
}

/**
 * Represents a message for subscribing to a cohort.
 * This message is sent by a coordinator to a participant to indicate acceptance in the cohort.
 * @class BeaconCohortSubscribeMessage
 * @extends BaseMessage
 * @type {BeaconCohortSubscribeMessage}
 */
export class BeaconCohortSubscribeMessage extends BaseMessage {
  constructor({ to, from }: CohortSubscribeMessage) {
    super({ to, from, type: BEACON_COHORT_OPT_IN_ACCEPT });
  }

  /**
   * Initializes a BeaconCohortSubscribeMessage from a possible CohortSubscribeMessage object.
   * @param {CohortSubscribeMessage} data The Subscribe object to initialize the SubscribeMessage.
   * @returns {BeaconCohortSubscribeMessage} The serialized SubscribeMessage.
   */
  public static fromJSON(data: Maybe<CohortSubscribeMessage>): BeaconCohortSubscribeMessage {
    const message = JSON.parse(data);
    if (message.type != BEACON_COHORT_OPT_IN_ACCEPT) {
      throw new Error(`Invalid type: ${message.type}`);
    }
    return new BeaconCohortSubscribeMessage(message);
  }
}