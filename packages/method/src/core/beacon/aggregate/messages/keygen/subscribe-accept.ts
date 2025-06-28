import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { SUBSCRIBE_ACCEPT } from '../constants.js';

export type SubscribeAccept = {
  type: typeof SUBSCRIBE_ACCEPT;
  to: string;
  from: string;
}

export class SubscribeAcceptMessage extends BaseMessage {
  constructor({ type = SUBSCRIBE_ACCEPT, to, from }: SubscribeAccept) {
    super({ type, to, from });
  }

  /**
   * Initializes an SubscribeAcceptMessage from a given SubscribeAccept object.
   * @param {SubscribeAccept} data The SubscribeAccept object to initialize the SubscribeAcceptMessage.
   * @returns {SubscribeAcceptMessage} The serialized SubscribeAcceptMessage.
   */
  public static fromJSON(data: Maybe<SubscribeAccept>): SubscribeAcceptMessage {
    if (data.type != SUBSCRIBE_ACCEPT) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new SubscribeAcceptMessage(data);
  }
}