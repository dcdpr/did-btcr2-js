import { Maybe } from '@did-btc1/common';
import { BaseMessage } from '../base.js';
import { SIGNATURE_AUTHORIZATION } from '../constants.js';

export type SignatureAuhtorization = {
  to: string;
  from: string;
  threadId?: string;
  cohortId: string;
  sessionId: string;
  partialSignature: Uint8Array;
}

export class SignatureAuthorizationMessage extends BaseMessage {
  public cohortId: string;
  public sessionId: string;
  public partialSignature: Uint8Array;

  constructor({ to, from, threadId, cohortId, sessionId, partialSignature }: SignatureAuhtorization) {
    super({ type: SIGNATURE_AUTHORIZATION, to, from, threadId, body: { cohortId, sessionId, partialSignature } });
    this.cohortId = cohortId;
    this.sessionId = sessionId;
    this.partialSignature = partialSignature;
  }

  /**
   * Initializes an SignatureAuthorizationMessage from a given SignatureAuhtorization object.
   * @param {SignatureAuhtorization} data The SignatureAuhtorization object to initialize the SignatureAuthorizationMessage.
   * @returns {SignatureAuthorizationMessage} The serialized SignatureAuthorizationMessage.
   */
  public static fromJSON(data: Maybe<SignatureAuhtorization>): SignatureAuthorizationMessage {
    if (data.type != SIGNATURE_AUTHORIZATION) {
      throw new Error(`Invalid type: ${data.type}`);
    }
    return new SignatureAuthorizationMessage(data);
  }
}