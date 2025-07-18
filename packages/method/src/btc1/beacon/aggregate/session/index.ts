import { Logger } from '@did-btc1/common';
import { KeyPairUtils } from '@did-btc1/keypair';
import * as musig2 from '@scure/btc-signer/musig2';
import { Transaction } from 'bitcoinjs-lib';
import { AggregateBeaconError } from '../../error.js';
import { AggregateBeaconCohort } from '../cohort/index.js';
import { BeaconCohortAuthorizationRequestMessage } from '../cohort/messages/sign/authorization-request.js';
import { SIGNING_SESSION_STATUS, SIGNING_SESSION_STATUS_TYPE } from './status.js';

type PublicKeyHex = string;
type Nonce = Uint8Array;
type NonceContributions = Map<PublicKeyHex, Nonce>;
type PartialSignatures = Map<string, Uint8Array>;
type ProcessedRequests = Record<string, string>;

export interface SigningSession {
  id?: string;
  cohort: AggregateBeaconCohort;
  pendingTx: Transaction;
  nonceContributions?: NonceContributions;
  aggregatedNonce?: Uint8Array;
  partialSignatures?: PartialSignatures;
  signature?: Uint8Array;
  status?: SIGNING_SESSION_STATUS_TYPE;
  processedRequests?: ProcessedRequests;
  nonceSecrets?: bigint;
}
export class BeaconCohortSigningSession implements SigningSession {
  /**
   * Unique identifier for the signing session.
   * @type {string}
   */
  public id: string;

  /**
   * DID of the coordinator.
   * @type {AggregateBeaconCohort}
   */
  public cohort: AggregateBeaconCohort;

  /**
   * Pending transaction to be signed.
   * @type {Transaction}
   */
  public pendingTx: Transaction;

  /**
   * Map of nonce contributions from participants.
   * @type {Map<PublicKeyHex, Nonce>}
   */
  public nonceContributions: Map<PublicKeyHex, Nonce> = new Map();

  /**
   * Aggregated nonce from all participants.
   * @type {Uint8Array}
   */
  public aggregatedNonce?: Uint8Array;

  /**
   * Map of partial signatures from participants.
   * @type {Map<string, Uint8Array>}
   */
  public partialSignatures: Map<string, Uint8Array> = new Map();

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
   * @type {Array<bigint>}
   */
  public nonceSecrets?: bigint;

  /**
   * Musig2 session for signing operations.
   * @type {musig2.Session}
   */
  public musig2Session?: musig2.Session;

  /**
   * Creates a new instance of BeaconCohortSigningSession.
   * @param {SigningSession} params Parameters to initialize the signing session.
   * @param {Transaction} params.pendingTx The pending transaction to be signed.
   * @param {string} [params.id] Optional unique identifier for the signing session. If not provided, a new UUID will be generated.
   * @param {AggregateBeaconCohort} [params.cohort] The cohort associated with the signing session.
   * @param {Record<string, string>} [params.processedRequests] Map of processed requests from participants.
   * @param {SIGNING_SESSION_STATUS_TYPE} [params.status] The current status of the signing session. Defaults to AWAITING_NONCE_CONTRIBUTIONS.
   */
  constructor({ id, cohort, pendingTx, processedRequests, status }: SigningSession) {
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
  public getAuthorizationRequest(to: string, from: string): BeaconCohortAuthorizationRequestMessage {
    const txHex = this.pendingTx instanceof Transaction ? this.pendingTx?.toHex() : this.pendingTx;
    return new BeaconCohortAuthorizationRequestMessage({
      to,
      from,
      sessionId : this.id,
      cohortId  : this.cohort?.id,
      pendingTx : txHex,
    });
  }

  /**
   * Adds a nonce contribution from a participant to the session.
   * @param {string} from The public key of the participant contributing the nonce.
   * @param {Array<string>} nonceContribution The nonce contribution from the participant.
   * @throws {Error} If the session is not awaiting nonce contributions or if the contribution is invalid.
   */
  public addNonceContribution(from: string, nonceContribution: Uint8Array): void {
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
   * @returns {Uint8Array} The aggregated nonce.
   * @throws {AggregateBeaconError} If not all nonce contributions have been received.
   */
  public generateAggregatedNonce(): Uint8Array {
    if(this.status !== SIGNING_SESSION_STATUS.NONCE_CONTRIBUTIONS_RECEIVED) {
      const missing = this.cohort?.participants.length - this.nonceContributions.size;
      throw new AggregateBeaconError(
        `Missing ${missing} nonce contributions. ` +
        `Received ${this.cohort?.participants.length} of ${this.nonceContributions.size} nonce contributions. ` +
        `Current status: ${this.status}`,
        'NONCE_CONTRIBUTION_ERROR', this.json()
      );
    }
    const sortedPubkeys = musig2.sortKeys(this.cohort.cohortKeys);
    const keyAggContext = musig2.keyAggregate(sortedPubkeys);
    const aggPubkey = musig2.keyAggExport(keyAggContext);
    this.aggregatedNonce = musig2.nonceAggregate(this.cohort.cohortKeys.map(key => musig2.nonceGen(key, undefined, aggPubkey, this.cohort.trMerkleRoot).public));
    this.musig2Session = new musig2.Session(this.aggregatedNonce, this.cohort.cohortKeys, this.cohort.trMerkleRoot);
    return this.aggregatedNonce;
  }

  /**
   * Adds a partial signature from a participant to the session.
   * @param {string} from The public key of the participant contributing the partial signature.
   * @param {Uint8Array} partialSignature The partial signature from the participant.
   */
  public addPartialSignature(from: string, partialSignature: Uint8Array): void {
    if(this.status !== SIGNING_SESSION_STATUS.AWAITING_PARTIAL_SIGNATURES) {
      throw new AggregateBeaconError(`Partial signatures not expected. Current status: ${this.status}`);
    }

    if(this.partialSignatures.get(from)) {
      Logger.warn(`WARNING: Partial signature already received from ${from}.`);
    }

    this.partialSignatures.set(from, partialSignature);
  }

  /**
   * Generates the final signature from all partial signatures.
   * @returns {Uint8Array} The final aggregated signature.
   */
  public async generateFinalSignature(): Promise<Uint8Array> {
    if(this.status !== SIGNING_SESSION_STATUS.PARTIAL_SIGNATURES_RECEIVED) {
      throw new AggregateBeaconError(`Partial signatures not received. Current status: ${this.status}`);
    }

    const inputIdx = (this.pendingTx?.ins?.length || 0) - 1;
    if (inputIdx < 0) {
      throw new AggregateBeaconError('No inputs in the pending transaction to sign.');
    }

    const prevoutScript = this.pendingTx?.ins[inputIdx].script;
    if (!prevoutScript) {
      throw new AggregateBeaconError('Previous output script is missing for the input to sign.');
    }

    const sigSum = [...this.partialSignatures.values()].reduce((sum, sig) => sum + KeyPairUtils.bigEndianToInt(sig), 0n);
    Logger.info(`Aggregated Signature computed: ${sigSum}`);

    this.aggregatedNonce ??= this.generateAggregatedNonce();

    const session = new musig2.Session(this.aggregatedNonce!, this.cohort.cohortKeys, this.cohort.trMerkleRoot);
    this.signature = session.partialSigAgg([...this.partialSignatures.values()]);

    return this.signature;
  }

  /**
   * Generates a partial signature for the session using the participant's secret key.
   * @param {Uint8Array} participantSk The secret key of the participant.
   * @returns {Uint8Array} The partial signature generated by the participant.
   */
  public generatePartialSignature(participantSk: Uint8Array): Uint8Array {
    if (!this.aggregatedNonce) {
      throw new AggregateBeaconError('Aggregated nonce is not available. Please generate it first.');
    }
    const sigHash = this.pendingTx?.hashForSignature(0, this.pendingTx?.ins[0].script, Transaction.SIGHASH_DEFAULT);
    if(!sigHash) {
      throw new AggregateBeaconError('Signature hash is not available. Please ensure the transaction is properly set up.');
    }
    const session = new musig2.Session(this.aggregatedNonce!, this.cohort.cohortKeys, this.cohort.trMerkleRoot);
    return session.sign(this.aggregatedNonce, participantSk);
  }

  /**
   * Converts the signing session instance to a JSON object representation.
   * @returns {BeaconCohortSigningSession} The JSON object representation of the signing session.
   */
  public json(): BeaconCohortSigningSession {
    return Object.json(this) as BeaconCohortSigningSession;
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
}
