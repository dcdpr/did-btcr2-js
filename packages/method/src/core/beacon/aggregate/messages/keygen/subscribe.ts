import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { SUBSCRIBE_ACCEPT } from '../constants.js';

export type Subscribe = { to: string; from: string; }

export class SubscribeMessage extends BaseMessage {
  constructor({ to, from }: Subscribe) {
    super({ type: SUBSCRIBE_ACCEPT, to, from });
  }

  /**
   * Initializes an SubscribeMessage from a given Subscribe object.
   * @param {Subscribe} data The Subscribe object to initialize the SubscribeMessage.
   * @returns {SubscribeMessage} The serialized SubscribeMessage.
   */
  public static fromJSON(data: Maybe<Subscribe>): SubscribeMessage {
    if (data.type != SUBSCRIBE_ACCEPT) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new SubscribeMessage(data);
  }
}