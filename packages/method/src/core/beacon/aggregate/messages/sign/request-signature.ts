import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { REQUEST_SIGNATURE } from '../constants.js';

export type RequestSignature = {
  to: string;
  from: string;
  threadId?: string;
  cohortId: string;
  sessionId?: string;
  data: string;
}

export class RequestSignatureMessage extends BaseMessage {
  public cohortId: string;
  public sessionId: string;
  public data: string;

  constructor({ to, from, threadId, cohortId, sessionId, data }: RequestSignature) {
    super({
      to,
      from,
      type     : REQUEST_SIGNATURE,
      threadId : threadId ?? crypto.randomUUID(),
      body     : { cohortId, sessionId, data }
    });
    this.cohortId = cohortId;
    this.sessionId = sessionId ?? crypto.randomUUID();
    this.data = data;
  }

  /**
   * Initializes an RequestSignatureMessage from a given RequestSignature object.
   * @param {RequestSignature} data The RequestSignature object to initialize the RequestSignatureMessage.
   * @returns {RequestSignatureMessage} The serialized RequestSignatureMessage.
   */
  public static fromJSON(data: Maybe<RequestSignature>): RequestSignatureMessage {
    if (data.type != REQUEST_SIGNATURE) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new RequestSignatureMessage(data);
  }
}