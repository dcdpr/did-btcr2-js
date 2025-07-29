import { Logger, Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { BEACON_COHORT_OPT_IN } from '../constants.js';
import { AggregateBeaconError } from '../../../../error.js';

export interface CohortOptInMessage {
  type?: typeof BEACON_COHORT_OPT_IN;
  to: string;
  from: string;
  cohortId: string;
  participantPk: Uint8Array;
}

export class BeaconCohortOptInMessage extends BaseMessage {

  constructor({ from, to, cohortId, participantPk }: CohortOptInMessage) {
    const body = { cohortId, participantPk };
    const type = BEACON_COHORT_OPT_IN;
    super({ from, to, body, type });
  }

  /**
   * Initializes a BeaconCohortOptInMessage from a possible CohortOptInMessage object.
   * @param {CohortOptInMessage} data The CohortOptInMessage object to initialize the BeaconCohortOptInMessage.
   * @returns {BeaconCohortOptInMessage} The new BeaconCohortOptInMessage.
   */
  public static fromJSON(data: Maybe<CohortOptInMessage>): BeaconCohortOptInMessage {
    Logger.debug('BeaconCohortOptInMessage.fromJSON data => ', data);
    try {
      const message = JSON.parse(data);
      if (message.type != BEACON_COHORT_OPT_IN) {
        throw new Error(`Invalid type: ${message.type}`);
      }
      return new BeaconCohortOptInMessage(message);
    } catch (error: any) {
      throw new AggregateBeaconError(
        `Failed to parse BeaconCohortOptInMessage: ${error.message}`,
        'BEACON_COHORT_MESSAGE_ERROR', data
      );
    }
  }
}