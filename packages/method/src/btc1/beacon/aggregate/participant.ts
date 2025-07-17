import { KeyBytes, Logger, Maybe } from '@did-btc1/common';
import { HDKey } from '@scure/bip32';
import * as musig2 from '@scure/btc-signer/musig2';
import { Transaction } from 'bitcoinjs-lib';
import { BeaconParticipantError } from '../error.js';
import { NostrAdapter } from './communication/nostr.js';
import { CommunicationService } from './communication/service.js';
import { AGGREGATED_NONCE, AUTHORIZATION_REQUEST, COHORT_ADVERT, COHORT_SET, SUBSCRIBE_ACCEPT } from './messages/constants.js';
import { CohortAdvertMessage } from './messages/keygen/cohort-advert.js';
import { CohortSetMessage } from './messages/keygen/cohort-set.js';
import { OptInMessage } from './messages/keygen/opt-in.js';
import { SubscribeAcceptMessage } from './messages/keygen/subscribe-accept.js';
import { SubscribeMessage } from './messages/keygen/subscribe.js';
import { AggregatedNonceMessage } from './messages/sign/aggregated-nonce.js';
import { AuthorizationRequestMessage } from './messages/sign/authorization-request.js';
import { NonceContributionMessage } from './messages/sign/nonce-contribution.js';
import { RequestSignatureMessage } from './messages/sign/request-signature.js';
import { SignatureAuthorizationMessage } from './messages/sign/signature-authorization.js';
import { Musig2Cohort } from './models/cohort/index.js';
import { COHORT_STATUS } from './models/cohort/status.js';
import { SignatureAuthorizationSession } from './models/session/index.js';
import { mnemonicToSeedSync } from '@scure/bip39';

type Seed = KeyBytes;
type Mnemonic = string;

type SessionId = string;
type ActiveSigningSessions = Map<SessionId, SignatureAuthorizationSession>;

type CohortId = string;
type KeyIndex = number;
type CohortKeyState = Map<CohortId, KeyIndex>;

/**
 * Represents a participant in the did:btc1 Beacon Aggregation protocol.
 * @class BeaconParticipant
 * @type {BeaconParticipant}
 */
export class BeaconParticipant {
  /**
     * The name of the BeaconParticipant service.
     * @type {string}
     */
  public name: string;

  /**
     * The DID of the BeaconParticipant.
     * @type {Array<string>}
     */
  public did: string;

  /**
     * The communication protocol used by the BeaconParticipant.
     * @type {CommunicationService}
     */
  public protocol: CommunicationService;

  /**
   * The HD key used by the BeaconParticipant.
   * @type {HDKey}
   */
  public hdKey: HDKey;

  /**
   * The current index for the beacon key.
   * @type {number}
   */
  public beaconKeyIndex: number = 0;

  /**
   * The coordinator DIDs that the participant is subscribed to.
   * @type {Array<string>}
   */
  public coordinatorDids: Array<string> = new Array<string>();

  /**
   * The cohorts that the participant is part of.
   * @type {Array<Musig2Cohort>}
   */
  public cohorts: Array<Musig2Cohort> = new Array<Musig2Cohort>();

  /**
   * A mapping of Cohort IDs to HDKey indexes (CohortId => KeyIndex).
   * @type {CohortKeyState}
   */
  public cohortKeyState: CohortKeyState = new Map<CohortId, KeyIndex>();

  /**
   * A mapping of active Session IDs to their sessions (sessionId => SignatureAuthorizationSession).
   * @type {ActiveSigningSessions}
   */
  public activeSigningSessions: ActiveSigningSessions = new Map<string, SignatureAuthorizationSession>();

  /**
   * Creates an instance of BeaconParticipant.
   * @param {Seed | Mnemonic} ent The seed bytes or mnemonic used for the participant's HD key.
   * @param {CommunicationService} protocol The communication protocol used by the participant.
   * @param {string} [name] The name of the participant.
   * @param {string} [did] The decentralized identifier (DID) of the participant.
   */
  constructor(ent: Seed | Mnemonic, protocol: CommunicationService, name?: string, did?: string) {
    this.hdKey = ent instanceof Uint8Array
      ? HDKey.fromMasterSeed(ent)
      : HDKey.fromMasterSeed(mnemonicToSeedSync(ent));

    this.name = name || `btc1-beacon-participant-${crypto.randomUUID()}`;
    this.protocol = protocol || new NostrAdapter();
    this.beaconKeyIndex = this.cohortKeyState.size;
    const {publicKey: pk, privateKey: sk} = this.hdKey.deriveChild(this.beaconKeyIndex);
    if(!pk || !sk) {
      throw new BeaconParticipantError(
        `Failed to derive HD key for participant ${this.name} at index ${this.beaconKeyIndex}`,
        'CONSTRUCTOR_ERROR', {publicKey: pk, privateKey: sk}
      );
    }

    this.did = did || this.protocol.generateIdentity({public: pk, secret: sk}).did;
    this.setCohortKey('__UNSET__');
  }

  /**
   * Starts the participant by registering message handlers for various message types.
   * @returns {void} The service adapter for the communication protocol.
   */
  public setup(): void {
    Logger.info(`Setting up BeaconParticipant ${this.name} (${this.did}) on ${this.protocol.name} ...`);
    this.protocol.registerMessageHandler(SUBSCRIBE_ACCEPT, this._handleSubscribeAccept.bind(this));
    this.protocol.registerMessageHandler(COHORT_ADVERT, this._handleCohortAdvert.bind(this));
    this.protocol.registerMessageHandler(COHORT_SET, this._handleCohortSet.bind(this));
    this.protocol.registerMessageHandler(AUTHORIZATION_REQUEST, this._handleAuthorizationRequest.bind(this));
    this.protocol.registerMessageHandler(AGGREGATED_NONCE, this._handleAggregatedNonce.bind(this));
  }

  /**
   * Starts the participant's communication protocol.
   * @returns {void} The service adapter for the communication protocol.
   */
  public start(): void {
    Logger.info(`Starting BeaconParticipant ${this.name} (${this.did}) on ${this.protocol.name} ...`);
    this.protocol.start();
  }

  /**
   * Retrieves the HD key for a specific cohort based on its ID.
   * @param {string} cohortId The ID of the cohort for which to retrieve the key.
   * @returns {HDKey} The HD key for the cohort, or throws an error if not found.
   * @throws {BeaconParticipantError} If the cohort key state is not found for the given cohort ID.
   */
  public getCohortKey(cohortId: string): HDKey {
    const keyIndex = this.cohortKeyState.get(cohortId);
    if(!keyIndex) {
      throw new BeaconParticipantError(`Cohort key state for cohort ${cohortId} not found.`, 'COHORT_KEY_NOT_FOUND');
    }
    return this.hdKey.deriveChild(keyIndex);
  }

  /**
   * Sets the state of the cohort key for a given cohort ID and key index.
   * @param {string} cohortId The ID of the cohort for which to set the key state.
   * @returns {void}
   */
  public setCohortKey(cohortId: string): void {
    if(this.cohortKeyState.size > 0) {
      this.beaconKeyIndex = this.cohortKeyState.size + 1;
    }
    if(this.cohortKeyState.has(cohortId)) {
      Logger.warn(`Cohort key state for cohort ${cohortId} already exists. Updating key index.`);
    }
    this.cohortKeyState.set(cohortId, this.beaconKeyIndex);
    Logger.info(`Cohort key state updated. Next beacon key index: ${this.beaconKeyIndex + 1}`);
  }

  /**
 * Finalizes the placeholder "__UNSET__" key and assigns it to the provided cohortId.
 * If no "__UNSET__" entry exists, throws an error.
 * If cohortId already exists, logs a warning and does nothing.
 * @param {string} cohortId The ID of the cohort to finalize the unset key for.
 * @throws {BeaconParticipantError} If no "__UNSET__" cohort key state is found.
 * @returns {void}
 */
  public finalizeUnsetCohortKey(cohortId: string): void {
    const unsetKey = '__UNSET__';

    if (!this.cohortKeyState.has(unsetKey)) {
      throw new BeaconParticipantError(
        `No '__UNSET__' cohort key to finalize for ${this.did}`,
        'UNSET_KEY_NOT_FOUND'
      );
    }

    if (this.cohortKeyState.has(cohortId)) {
      Logger.warn(`Cohort key state already exists for ${cohortId}. Skipping migration from '__UNSET__'.`);
      this.cohortKeyState.delete(unsetKey);
      return;
    }

    this.setCohortKey(cohortId);
    this.cohortKeyState.delete(unsetKey);

    Logger.info(`Finalized '__UNSET__' CohortKeyState with ${cohortId} for ${this.did}`);
  }


  /**
   * Handle subscription acceptance from a coordinator.
   * @param {SubscribeAcceptMessage} message The message containing the subscription acceptance.
   * @returns {Promise<void>}
   */
  private async _handleSubscribeAccept(message: Maybe<SubscribeAcceptMessage>): Promise<void> {
    const subscribeAcceptMessage = SubscribeAcceptMessage.fromJSON(message);
    const coordinatorDid = subscribeAcceptMessage.from;
    if (!this.coordinatorDids.includes(coordinatorDid)) {
      this.coordinatorDids.push(coordinatorDid);
    }
  }

  /**
   * Handles a cohort advertisement message.
   * @param {Maybe<CohortAdvertMessage>} message The cohort advertisement message.
   * @returns {Promise<void>}
   */
  public async _handleCohortAdvert(message: Maybe<CohortAdvertMessage>): Promise<void> {
    const cohortAdvertMessage = CohortAdvertMessage.fromJSON(message);
    Logger.info(`BeaconParticipant ${this.did} received new cohort announcement from ${cohortAdvertMessage.from}.`);
    const cohortId = cohortAdvertMessage.body?.cohortId;
    const network = cohortAdvertMessage.body?.network;
    const minParticipants = cohortAdvertMessage.body?.cohortSize;
    if (!cohortId || !network || !minParticipants) {
      Logger.warn(`BeaconParticipant ${this.did} received malformed cohort advert message: ${JSON.stringify(cohortAdvertMessage)}`);
      return;
    }
    const from = cohortAdvertMessage.from;
    if (!this.coordinatorDids.includes(from)) {
      Logger.warn(`BeaconParticipant ${this.did} received unsolicited new cohort announcement from ${from}`);
      return;
    }
    const cohort = new Musig2Cohort(
      {
        network,
        minParticipants,
        id             : cohortId,
        coordinatorDid : from,
      }
    );
    this.cohorts.push(cohort);
    await this.joinCohort(cohort.id, from);
  }

  /**
   * Handles a cohort set message.
   * @param {Maybe<CohortSetMessage>} message The cohort set message.
   * @returns {Promise<void>}
   */
  public async _handleCohortSet(message: Maybe<CohortSetMessage>): Promise<void> {
    const cohortSetMessage = CohortSetMessage.fromJSON(message);
    const cohortId = cohortSetMessage.cohortId;
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohortId || !cohort) {
      Logger.warn(`Cohort with ID ${cohortId} not found or not joined by participant ${this.did}.`);
      return;
    }
    this.finalizeUnsetCohortKey(cohortId);
    const participantPk = this.getCohortKey(cohortId).publicKey?.toHex();
    if(!participantPk) {
      Logger.error(`Failed to derive public key for cohort ${cohortId}`);
      return;
    }
    const beaconAddress = cohortSetMessage.beaconAddress;
    const cohortKeys = cohortSetMessage.cohortKeys.map(key => key.toHex());
    cohort.validateCohort([participantPk], cohortKeys, beaconAddress);
    Logger.info(`BeaconParticipant w/ pk ${participantPk} successfully joined cohort ${cohortId} with beacon address ${beaconAddress}.`);
    Logger.info(`Cohort status: ${cohort.status}`);
  }

  /**
   * Handles an authorization request message.
   * @param {Maybe<AuthorizationRequestMessage>} message The authorization request message.
   * @returns {Promise<void>}
   */
  public async _handleAuthorizationRequest(message: Maybe<AuthorizationRequestMessage>): Promise<void> {
    const authRequest = AuthorizationRequestMessage.fromJSON(message);
    const cohort = this.cohorts.find(c => c.id === authRequest.cohortId);
    if (!cohort) {
      Logger.warn(`Authorization request for unknown cohort ${authRequest.cohortId} from ${authRequest.from}`);
      return;
    }
    const session = new SignatureAuthorizationSession({
      cohort,
      id        : authRequest.sessionId,
      pendingTx : Transaction.fromHex(authRequest.pendingTx),
    });
    this.activeSigningSessions.set(session.id, session);
    const nonceContribution = this.generateNonceContribution(cohort, session);
    await this.sendNonceContribution(cohort, nonceContribution, session);
  }

  /**
   * Handles an aggregated nonce message.
   * @param {Maybe<AggregatedNonceMessage>} message The aggregated nonce message.
   * @returns {Promise<void>}
   */
  public async _handleAggregatedNonce(message: Maybe<AggregatedNonceMessage>): Promise<void> {
    const aggNonceMessage = AggregatedNonceMessage.fromJSON(message);
    const session = this.activeSigningSessions.get(aggNonceMessage.sessionId);
    if (!session) {
      Logger.warn(`Aggregated nonce message received for unknown session ${aggNonceMessage.sessionId}`);
      return;
    }
    session.aggregatedNonce = aggNonceMessage.aggregatedNonce;
    const participantSk = this.getCohortKey(session.cohort.id).privateKey;
    if(!participantSk) {
      Logger.error(`Failed to derive secret key for cohort ${session.cohort.id}`);
      return;
    }
    const partialSig = session.generatePartialSignature(participantSk);
    await this.sendPartialSignature(session, partialSig);
  };

  /**
   * Subscribes to a coordinator's messages.
   * @param {string} coordinatorDid The DID of the coordinator to subscribe to.
   * @returns {Promise<void>}
   */
  public async subscribeToCoordinator(coordinatorDid: string): Promise<void> {
    if(this.coordinatorDids.includes(coordinatorDid)) {
      Logger.info(`Already subscribed to coordinator ${coordinatorDid}`);
      return;
    }
    const subMessage = new SubscribeMessage({ to: coordinatorDid, from: this.did });
    await this.protocol.sendMessage(subMessage, coordinatorDid, this.did);
  }

  /**
   * Joins a cohort with the given ID and coordinator DID.
   * @param {string} cohortId The ID of the cohort to join.
   * @param {string} coordinatorDid The DID of the cohort coordinator.
   * @returns {Promise<void>}
   */
  public async joinCohort(cohortId: string, coordinatorDid: string): Promise<void> {
    Logger.info(`BeaconParticipant ${this.did} joining cohort ${cohortId} with coordinator ${coordinatorDid}`);
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohort) {
      Logger.warn(`Cohort with ID ${cohortId} not found.`);
      return;
    }
    const participantPk = this.getCohortKey(cohortId).publicKey?.toHex();
    if(!participantPk) {
      Logger.error(`Failed to derive public key for cohort ${cohortId} at index ${this.beaconKeyIndex}`);
      return;
    }
    this.setCohortKey(cohortId);
    const optInMessage = OptInMessage.fromJSON({
      cohortId,
      participantPk,
      from     : this.did,
      to       : coordinatorDid,
    });

    await this.protocol.sendMessage(optInMessage, coordinatorDid, this.did);
    cohort.status = COHORT_STATUS.COHORT_OPTED_IN;
  }

  /**
   * Requests a signature for the given cohort and data.
   * @param {string} cohortId The ID of the cohort for which to request a signature.
   * @param {string} data The data for which to request a signature.
   * @returns {Promise<boolean>} Whether the signature request was successful.
   */
  public async requestCohortSignature(cohortId: string, data: string): Promise<boolean> {
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohort) {
      Logger.warn(`Cohort with ID ${cohortId} not found.`);
      return false;
    }
    if(cohort.status !== COHORT_STATUS.COHORT_SET_STATUS) {
      Logger.warn(`Cohort ${cohortId} not in a set state. Current status: ${cohort.status}`);
      return false;
    }
    const reqSigMessage = new RequestSignatureMessage({
      data,
      to       : cohort.coordinatorDid,
      from     : this.did,
      cohortId : cohort.id,
    });
    await this.protocol.sendMessage(reqSigMessage, cohort.coordinatorDid, this.did);
    return true;
  }

  /**
   * Generates a nonce contribution for the given cohort and session.
   * @param {Musig2Cohort} cohort The cohort for which to generate the nonce contribution.
   * @param {SignatureAuthorizationSession} session The session for which to generate the nonce contribution.
   * @returns {Promise<string[]>} An array of nonce points in hexadecimal format.
   */
  public generateNonceContribution(cohort: Musig2Cohort, session: SignatureAuthorizationSession): Uint8Array {
    const cohortKey = this.getCohortKey(cohort.id);
    if (!cohortKey) {
      throw new BeaconParticipantError(
        `Cohort key state not found for cohort ${cohort.id}`,
        'COHORT_KEY_NOT_FOUND', cohortKey
      );
    }
    const { publicKey, privateKey } = cohortKey;
    if(!publicKey || !privateKey) {
      throw new BeaconParticipantError(
        `Failed to derive public key for cohort ${cohort.id}`,
        'PARTICIPANT_PK_NOT_FOUND', cohortKey
      );
    }
    session.aggregatedNonce ??= session.generateAggregatedNonce();
    return musig2.nonceGen(publicKey, privateKey, session.aggregatedNonce, cohort.trMerkleRoot).public;
  }

  /**
   * Sends a nonce contribution message to the cohort coordinator.
   * @param {Musig2Cohort} cohort The cohort to which the nonce contribution is sent.
   * @param {Uint8Array} nonceContribution The nonce contribution points in hexadecimal format.
   * @param {SignatureAuthorizationSession} session The session associated with the nonce contribution.
   */
  public async sendNonceContribution(
    cohort: Musig2Cohort,
    nonceContribution: Uint8Array,
    session: SignatureAuthorizationSession
  ): Promise<void> {
    const nonceContrbutionMessage = NonceContributionMessage.fromJSON({
      to        : cohort.coordinatorDid,
      from      : this.did,
      sessionId : session.id,
      cohortId  : cohort.id,
      nonceContribution
    });
    await this.protocol.sendMessage(nonceContrbutionMessage, cohort.coordinatorDid, this.did);
    Logger.info(`Nonce contribution sent for session ${session.id} in cohort ${cohort.id} by participant ${this.did}`);
  }

  /**
   * Sends a partial signature for the given session.
   * @param {SignatureAuthorizationSession} session The session for which the partial signature is sent.
   * @param {Uint8Array} partialSig The partial signature to send.
   * @returns {Promise<void>}
   */
  public async sendPartialSignature(session: SignatureAuthorizationSession, partialSig: Uint8Array): Promise<void> {
    const sigAuthMessage = new SignatureAuthorizationMessage({
      to               : session.cohort.coordinatorDid,
      from             : this.did,
      cohortId         : session.cohort.id,
      sessionId        : session.id,
      partialSignature : partialSig,
    });
    await this.protocol.sendMessage(sigAuthMessage, session.cohort.coordinatorDid, this.did);
    Logger.info(`Partial signature sent for session ${session.id} in cohort ${session.cohort.id} by participant ${this.did}`);
  }

  /**
   * Initializes a new BeaconParticipant instance.
   * @param {Seed | Mnemonic} ent The secret key used for signing.
   * @param {CommunicationService} protocol The communication protocol used by the participant.
   * @param {string} [name] The name of the participant.
   * @param {string} [did] The decentralized identifier (DID) of the participant.
   * @returns {BeaconParticipant} A new instance of BeaconParticipant.
   */
  public static initialize(ent: Seed | Mnemonic, protocol: CommunicationService, name?: string, did?: string): BeaconParticipant {
    return new BeaconParticipant(ent, protocol, name, did);
  }
}