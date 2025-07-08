import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { COHORT_ADVERT } from '../constants.js';

export type Advert = {
  to: string;
  from: string;
  cohortId: string;
  cohortSize: number;
  network: string;
  threadId?: string
  beaconType?: string;
}

export class CohortAdvertMessage extends BaseMessage {
  public cohortId: string;
  public cohortSize: number;
  public network: string;

  constructor({ to, from, threadId, cohortId, cohortSize, network }: Advert) {
    super({
      to,
      from,
      threadId,
      type : COHORT_ADVERT,
      body : { cohortId, cohortSize, network }
    });
    this.cohortId = cohortId;
    this.cohortSize = cohortSize;
    this.network = network;
  }

  /**
   * Initializes an CohortAdvertMessage from a given Advert object.
   * @param {Advert} data The Advert object to initialize the CohortAdvertMessage.
   * @returns {object} The serialized CohortAdvertMessage.
   */
  public static initialize(data: Maybe<Advert>): CohortAdvertMessage {
    if (data.type != COHORT_ADVERT){
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new CohortAdvertMessage(data);
  }
}