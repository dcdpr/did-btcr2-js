import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_SUBSCRIBE_ACCEPT } from '../constants.js';

export interface CohortSubscribeAcceptMessage {
  to: string;
  from: string;
}

/**
 * Represents a message for a coordinator accepting a participant subscribe to a cohort.
 * @class BeaconCohortSubscribeAcceptMessage
 * @extends BaseMessage
 * @type {BeaconCohortSubscribeAcceptMessage}
 */
export class BeaconCohortSubscribeAcceptMessage extends BaseMessage {
  constructor({ to, from }: CohortSubscribeAcceptMessage) {
    super({ to, from, type: BEACON_COHORT_SUBSCRIBE_ACCEPT });
  }

  /**
   * Initializes a BeaconCohortSubscribeAcceptMessage from a possible CohortSubscribeAcceptMessage object.
   * @param {CohortSubscribeAcceptMessage} data The CohortSubscribeAcceptMessage object to initialize the BeaconCohortSubscribeAcceptMessage.
   * @returns {BeaconCohortSubscribeAcceptMessage} The new BeaconCohortSubscribeAcceptMessage.
   */
  public static fromJSON(data: Maybe<CohortSubscribeAcceptMessage>): BeaconCohortSubscribeAcceptMessage {
    if (data.type != BEACON_COHORT_SUBSCRIBE_ACCEPT) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new BeaconCohortSubscribeAcceptMessage(data);
  }
}