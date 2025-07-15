import { BaseMessage } from './base.js';

export type Advert = {
  type?: 'BEACON_ADVERT';
  to: string;
  from: string;
  cohortId: string;
  cohortSize: number;
  network: string;
  threadId?: string
}

export class AdvertMessage extends BaseMessage {
  public cohortId: string;
  public cohortSize: number;
  public network: string = 'signet';

  constructor({ type = 'BEACON_ADVERT', to, from, threadId, cohortId, cohortSize, network }: Advert) {
    super({ type, to, from, threadId, body: { cohortId, cohortSize, network }});
    this.cohortId = cohortId;
    this.cohortSize = cohortSize;
    this.network = network;
  }

  /**
   * Initializes an AdvertMessage from a given Advert object.
   * @param {Advert} data - The Advert object to initialize the AdvertMessage.
   * @returns {object} The serialized AdvertMessage.
   */
  public static initialize(data: Advert): AdvertMessage {
    if (data.type != 'BEACON_ADVERT'){
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new AdvertMessage(data);
  }
}