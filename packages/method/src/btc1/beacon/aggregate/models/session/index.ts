import { Logger } from '@did-btc1/common';
import { keyAggExport, keyAggregate } from '@scure/btc-signer/musig2';
import { Transaction } from 'bitcoinjs-lib';
import { AggregateBeaconError } from '../../../error.js';
import { AuthorizationRequest, AuthorizationRequestMessage } from '../../messages/sign/authorization-request.js';
import { Musig2Cohort } from '../cohort/index.js';
import { SIGNING_SESSION_STATUS, SIGNING_SESSION_STATUS_TYPE } from './status.js';

export type SigningSessionObject = {
  id?: string;
  cohort: Musig2Cohort;
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

type PublicKeyHex = string;
type Nonce = string;
type NonceContribution = Array<Nonce>;

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
  public cohort: Musig2Cohort;

  /**
   * Pending transaction to be signed.
   * @type {Transaction}
   */
  public pendingTx?: Transaction;

  /**
   * Map of nonce contributions from participants.
   * @type {Map<string, Array<string>>}
   */
  public nonceContributions: Map<PublicKeyHex, NonceContribution> = new Map();

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

  /**
   * Gets the authorization request message for a participant.
   * @param {string} to The public key of the participant to whom the request is sent.
   * @param {string} from The public key of the participant sending the request.
   * @returns {AuthorizationRequest} The authorization request message.
   */
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

  /**
   * Adds a nonce contribution from a participant to the session.
   * @param {string} from The public key of the participant contributing the nonce.
   * @param {Array<string>} nonceContribution The nonce contribution from the participant.
   * @throws {Error} If the session is not awaiting nonce contributions or if the contribution is invalid.
   */
  public addNonceContribution(from: string, nonceContribution: Array<string>): void {
    if(this.status !== SIGNING_SESSION_STATUS.AWAITING_NONCE_CONTRIBUTIONS) {
      throw new AggregateBeaconError(`Nonce contributions already received. Current status: ${this.status}`);
    }

    if(nonceContribution.length !== 2) {
      throw new AggregateBeaconError(`Invalid nonce contribution. Expected 2 points, received ${nonceContribution.length}.`);
    }

    if (this.nonceContributions.get(from)) {
      Logger.warn(`WARNING: Nonce contribution already received from ${from}.`);
    }

    this.nonceContributions.set(from, nonceContribution);

    if(this.nonceContributions.size === this.cohort?.participants.length) {
      this.status = SIGNING_SESSION_STATUS.NONCE_CONTRIBUTIONS_RECEIVED;
    }
  }

  /**
   * Generates the aggregated nonce from all nonce contributions for the session.
   *
   */
  public generateAggregatedNonce(): Array<Uint8Array> {
    if(!this.nonceContributionsReceived()) {
      const missing = this.cohort?.participants.length - this.nonceContributions.size;
      throw new AggregateBeaconError(
        `Missing ${missing} nonce contributions. ` +
        `Received ${this.cohort?.participants.length} of ${this.nonceContributions.size} nonce contributions. ` +
        `Current status: ${this.status}`,
        'NONCE_CONTRIBUTION_ERROR', this.json()
      );
    }
    return [keyAggExport(keyAggregate(this.cohort.cohortKeys))];
  }

  /**
   * Converts the signing session instance to a JSON object representation.
   * @returns {SignatureAuthorizationSession} The JSON object representation of the signing session.
   */
  public json(): SignatureAuthorizationSession {
    return Object.json(this) as SignatureAuthorizationSession;
  }

  /**
   * Checks if the signing session is complete.
   * @returns {boolean} True if the session is complete, false otherwise.
   */
  public isComplete(): boolean {
    return this.status === SIGNING_SESSION_STATUS.SIGNATURE_COMPLETE;
  }

  /**
   * Checks if the signing session is in a failed state.
   * @returns {boolean} True if the session has failed, false otherwise.
   */
  public isFailed(): boolean {
    return this.status === SIGNING_SESSION_STATUS.FAILED;
  }

  /**
   * Checks if the signing session is awaiting nonce contributions.
   * @returns {boolean} True if the session is awaiting nonce contributions, false otherwise.
   */
  public nonceContributionsReceived(): boolean {
    return this.status === SIGNING_SESSION_STATUS.NONCE_CONTRIBUTIONS_RECEIVED;
  }
}