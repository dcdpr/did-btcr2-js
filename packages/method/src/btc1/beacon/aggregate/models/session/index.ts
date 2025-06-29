import { Transaction } from 'bitcoinjs-lib';
import { Musig2Cohort } from '../cohort/index.js';
import { SIGNING_SESSION_STATUS, SIGNING_SESSION_STATUS_TYPE } from './status.js';
import { AuthorizationRequest, AuthorizationRequestMessage } from '../../messages/sign/authorization-request.js';
import { Logger } from '@did-btc1/common';

export type SigningSessionObject = {
  id?: string;
  cohort?: Musig2Cohort;
  pendingTx?: Transaction;
  processedRequests?: Record<string, string>;
  status?: SIGNING_SESSION_STATUS_TYPE;
}

export interface SigningSession {
  id?: string;
  cohort?: Musig2Cohort;
  pendingTx?: Transaction;
  nonceContributions?: Map<string, Array<string>>;
  aggregatedNonce?: Array<Uint8Array>;
  partialSignatures?: Record<string, Uint8Array>;
  signature?: Uint8Array;
  status: SIGNING_SESSION_STATUS_TYPE;
  processedRequests?: Record<string, string>;
  nonceSecrets?: Array<string>;
}

export class SignatureAuthorizationSession implements SigningSession {
  /**
   * Unique identifier for the signing session.
   * @type {string}
   */
  public id: string;

  /**
   * DID of the coordinator.
   * @type {Musig2Cohort}
   */
  public cohort?: Musig2Cohort;

  /**
   * Pending transaction to be signed.
   * @type {Transaction}
   */
  public pendingTx?: Transaction;

  /**
   * Map of nonce contributions from participants.
   * @type {Map<string, Array<string>>}
   */
  public nonceContributions: Map<string, Array<string>> = new Map();

  /**
   * Aggregated nonce from all participants.
   * @type {Array<Uint8Array>}
   */
  public aggregatedNonce?: Array<Uint8Array>;

  /**
   * Map of partial signatures from participants.
   * @type {Record<string, Uint8Array>}
   */
  public partialSignatures: Record<string, Uint8Array> = {};

  /**
   * Final signature for the transaction.
   * @type {Uint8Array}
   */
  public signature?: Uint8Array;

  /**
   * Current status of the signing session.
   * @type {SIGNING_SESSION_STATUS_TYPE}
   */
  public status: SIGNING_SESSION_STATUS_TYPE;

  /**
   * Map of processed requests from participants.
   * @type {Record<string, string>}
   */
  public processedRequests: Record<string, string>;

  /**
   * Secrets for nonces contributed by participants.
   * @type {Array<string>}
   */
  public nonceSecrets?: Array<string>;

  /**
   * Creates a new instance of SignatureAuthorizationSession.
   * @param {SigningSessionObject} params Parameters to initialize the signing session.
   * @param {string} [params.id] Optional unique identifier for the signing session. If not provided, a new UUID will be generated.
   * @param {Musig2Cohort} [params.cohort] The cohort associated with the signing session.
   * @param {Transaction} [params.pendingTx] The pending transaction to be signed.
   * @param {Record<string, string>} [params.processedRequests] Map of processed requests from participants.
   * @param {SIGNING_SESSION_STATUS_TYPE} [params.status] The current status of the signing session. Defaults to AWAITING_NONCE_CONTRIBUTIONS.
   */
  constructor({ id, cohort, pendingTx, processedRequests, status }: SigningSessionObject) {
    this.id = id || crypto.randomUUID();
    this.cohort = cohort;
    this.pendingTx = pendingTx;
    this.processedRequests = processedRequests || {};
    this.status = status || SIGNING_SESSION_STATUS.AWAITING_NONCE_CONTRIBUTIONS;
  }

  public getAuthorizationRequest(to: string, from: string): AuthorizationRequest {
    const txHex = this.pendingTx?.toHex();
    return new AuthorizationRequestMessage({
      to,
      from,
      sessionId : this.id,
      cohortId  : this.cohort?.id || '',
      pendingTx : txHex || '',
    });
  }

  public addNonceContribution(from: string, nonceContribution: Array<string>): void {
    if(this.status !== SIGNING_SESSION_STATUS.AWAITING_NONCE_CONTRIBUTIONS) {
      throw new Error(`Nonce contributions already received. Current status: ${this.status}`);
    }

    if(nonceContribution.length !== 2) {
      throw new Error(`Invalid nonce contribution. Expected 2 points, received ${nonceContribution.length}.`);
    }

    if (this.nonceContributions.get(from)) {
      Logger.warn(`Nonce contribution already received from ${from}.`);
    }

    this.nonceContributions.set(from, nonceContribution);

    if(this.nonceContributions.size === this.cohort?.participants.length) {
      this.status = SIGNING_SESSION_STATUS.NONCE_CONTRIBUTIONS_RECEIVED;
    }
  }

  /**
   * Converts the signing session instance to a JSON object representation.
   * @returns {SignatureAuthorizationSession} The JSON object representation of the signing session.
   */
  public json(): SignatureAuthorizationSession {
    return Object.json(this) as SignatureAuthorizationSession;
  }
}