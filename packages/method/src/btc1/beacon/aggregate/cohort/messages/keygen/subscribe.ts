import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_SUBSCRIBE_ACCEPT } from '../constants.js';

export interface CohortSubscribeMessage {
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
    super({ to, from, type: BEACON_COHORT_SUBSCRIBE_ACCEPT });
  }

  /**
   * Initializes a BeaconCohortSubscribeMessage from a possible CohortSubscribeMessage object.
   * @param {CohortSubscribeMessage} data The Subscribe object to initialize the SubscribeMessage.
   * @returns {BeaconCohortSubscribeMessage} The serialized SubscribeMessage.
   */
  public static fromJSON(data: Maybe<CohortSubscribeMessage>): BeaconCohortSubscribeMessage {
    if (data.type != BEACON_COHORT_SUBSCRIBE_ACCEPT) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortSubscribeMessage(data);
  }
}