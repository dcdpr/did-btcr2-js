import { BaseMessage } from '../base.js';
import { COHORT_ADVERT } from '../constants.js';

export type Advert = {
  type?: typeof COHORT_ADVERT;
  to: string;
  from: string;
  cohortId: string;
  cohortSize: number;
  network: string;
  threadId?: string
}

export class CohortAdvertMessage extends BaseMessage {
  public cohortId: string;
  public cohortSize: number;
  public network: string;

  constructor({ type = COHORT_ADVERT, to, from, threadId, cohortId, cohortSize, network }: Advert) {
    super({ type, to, from, threadId, body: { cohortId, cohortSize, network }});
    this.cohortId = cohortId;
    this.cohortSize = cohortSize;
    this.network = network;
  }

  /**
   * Initializes an CohortAdvertMessage from a given Advert object.
   * @param {Advert} data - The Advert object to initialize the CohortAdvertMessage.
   * @returns {object} The serialized CohortAdvertMessage.
   */
  public static initialize(data: Advert): CohortAdvertMessage {
    if (data.type != COHORT_ADVERT){
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new CohortAdvertMessage(data);
  }
}