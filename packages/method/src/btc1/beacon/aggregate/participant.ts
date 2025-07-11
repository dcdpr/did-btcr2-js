import { KeyBytes, Logger, Maybe } from '@did-btc1/common';
import { HDKey } from '@scure/bip32';
import * as musig2 from '@scure/btc-signer/musig2';
import { Transaction } from 'bitcoinjs-lib';
import { BeaconParticipantError } from '../error.js';
import { NostrAdapter } from './communication/nostr.js';
import { CommunicationService, ServiceAdapter } from './communication/service.js';
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

type ActiveSigningSessions = Map<string, SignatureAuthorizationSession>;
type CohortKeyStates = Map<string, CohortKeyState>;

/**
 * Represents the state of a participants keys and dids tracked against each cohortId.
 * @class CohortKeyState
 * @type {CohortKeyState}
 */
export class CohortKeyState {
  public did: string;
  public keyIndex: number;

  constructor(did: string, keyIndex: number, ){
    this.did = did;
    this.keyIndex = keyIndex; // HD wallet key index
  }
}

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
   * A mapping of cohortId => CohortKeyState.
   * @type {CohortKeyStates}
   */
  public cohortKeyStates: CohortKeyStates = new Map<string, CohortKeyState>();

  /**
   * A mapping of active signing sessions.
   * @type {}
   */
  public activeSigningSessions: ActiveSigningSessions = new Map<string, SignatureAuthorizationSession>();

  /**
   * Creates an instance of BeaconParticipant.
   * @param {KeyBytes} sk The secret key used for signing.
   * @param {CommunicationService} protocol The communication protocol used by the participant.
   * @param {string} [name] The name of the participant.
   * @param {string} [did] The decentralized identifier (DID) of the participant.
   */
  constructor(sk: KeyBytes, protocol: CommunicationService, name?: string, did?: string) {
    this.hdKey = HDKey.fromMasterSeed(sk);
    this.name = name || `btc1-beacon-participant-${crypto.randomUUID()}`;
    this.protocol = protocol || new NostrAdapter();
    this.did = did || this.protocol.generateIdentity();
    this.beaconKeyIndex = this.cohortKeyStates.size;
  }

  /**
   * Starts the participant by registering message handlers for various message types.
   * @returns {ServiceAdapter<CommunicationService>} The service adapter for the communication protocol.
   */
  public start(): ServiceAdapter<CommunicationService> {
    Logger.info(`Starting ${this.name} (${this.did})! Listening for messages on ${this.protocol.name} ...`);
    this.protocol.registerMessageHandler(SUBSCRIBE_ACCEPT, this._handleSubscribeAccept.bind(this));
    this.protocol.registerMessageHandler(COHORT_ADVERT, this._handleCohortAdvert.bind(this));
    this.protocol.registerMessageHandler(COHORT_SET, this._handleCohortSet.bind(this));
    this.protocol.registerMessageHandler(AUTHORIZATION_REQUEST, this._handleAuthorizationRequest.bind(this));
    this.protocol.registerMessageHandler(AGGREGATED_NONCE, this._handleAggregatedNonce.bind(this));
    return this.protocol.start();
  }

  /**
   * Retrieves the HD key for a specific cohort based on its ID.
   * @param {string} cohortId The ID of the cohort for which to retrieve the key.
   * @returns {HDKey} The HD key for the cohort, or throws an error if not found.
   * @throws {BeaconParticipantError} If the cohort key state is not found for the given cohort ID.
   */
  public getCohortKey(cohortId: string): HDKey {
    const cohortKeyState = this.getCohortKeyState(cohortId);
    if(!cohortKeyState) {
      throw new BeaconParticipantError(
        `Cohort key state for cohort ${cohortId} not found.`,
        'COHORT_KEY_NOT_FOUND', cohortKeyState
      );
    }
    return this.hdKey.deriveChild(cohortKeyState.keyIndex);
  }

  /**
   * Sets the state of the cohort key for a given cohort ID and key index.
   * @param {string} cohortId The ID of the cohort for which to set the key state.
   */
  public setCohortKey(cohortId: string): void {
    if(this.beaconKeyIndex > 0) {
      this.beaconKeyIndex = this.cohortKeyStates.size + 1;
    }
    if(this.getCohortKeyState(cohortId)) {
      Logger.warn(`Cohort key state for cohort ${cohortId} already exists. Updating key index.`);
    }
    this.cohortKeyStates.set(cohortId, new CohortKeyState(this.did, this.beaconKeyIndex));
    Logger.info(`Cohort key state updated. Next beacon key index: ${this.beaconKeyIndex + 1}`);
  }

  /**
   * Retrieves the CohortKeyState object for a given cohort ID.
   * @param {string} cohortId The ID of the cohort for which to retrieve the key state.
   * @returns {CohortKeyState | undefined} The CohortKeyState object for the specified cohort ID.
   */
  public getCohortKeyState(cohortId: string): CohortKeyState | undefined {
    return this.cohortKeyStates.get(cohortId);
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
    if (!cohortId || !network) {
      Logger.warn(`BeaconParticipant ${this.did} received malformed cohort advert message: ${JSON.stringify(cohortAdvertMessage)}`);
      return;
    }
    const from = cohortAdvertMessage.from;
    if (!this.coordinatorDids.includes(from)) {
      Logger.warn(`BeaconParticipant ${this.did} received unsolicited new cohort announcement from ${from}`);
      return;
    }
    const cohort = new Musig2Cohort({ id: cohortId, minParticipants, network, coordinatorDid: from });
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
    const participantPk = this.getCohortKey(cohortId).publicKey?.toHex();
    if(!participantPk) {
      Logger.error(`Failed to derive public key for cohort ${cohortId}`, this.cohortKeyStates);
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
    const cohortKeyState = this.cohortKeyStates.get(session.cohort.id);
    if (!cohortKeyState) {
      Logger.error(`Cohort key state not found for cohort ${session.cohort.id}`);
      return;
    }
    const participantSk = this.getCohortKey(session.cohort.id).privateKey;
    if(!participantSk) {
      Logger.error(`Failed to derive secret key for cohort ${session.cohort.id} at index ${cohortKeyState.keyIndex}`);
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
    const index = this.beaconKeyIndex++;
    const participantPk = this.getCohortKey(cohortId).publicKey?.toHex();
    if(!participantPk) {
      Logger.error(`Failed to derive public key for cohort ${cohortId} at index ${index}`);
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
    const cohortKeyState = this.getCohortKeyState(cohort.id);
    if (!cohortKeyState) {
      throw new BeaconParticipantError(
        `Cohort key state not found for cohort ${cohort.id}`,
        'COHORT_KEY_NOT_FOUND', cohortKeyState
      );
    }
    session.aggregatedNonce ??= session.generateAggregatedNonce();
    const { publicKey, privateKey } = this.getCohortKey(cohort.id);
    if(!publicKey || !privateKey) {
      throw new BeaconParticipantError(
        `Failed to derive public key for cohort ${cohort.id} at index ${cohortKeyState.keyIndex}`,
        'PARTICIPANT_PK_NOT_FOUND', cohortKeyState
      );
    }
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

  public static initialize(sk: KeyBytes, protocol: CommunicationService, name?: string, did?: string): BeaconParticipant {
    return new BeaconParticipant(sk, protocol, name, did);
  }
}