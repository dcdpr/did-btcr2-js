import { KeyBytes, Logger, Maybe } from '@did-btc1/common';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import * as musig2 from '@scure/btc-signer/musig2';
import { Transaction } from 'bitcoinjs-lib';
import { BeaconParticipantError } from '../error.js';
import { AggregateBeaconCohort } from './cohort/index.js';
import {
  BEACON_COHORT_ADVERT,
  BEACON_COHORT_AGGREGATED_NONCE,
  BEACON_COHORT_AUTHORIZATION_REQUEST,
  BEACON_COHORT_OPT_IN_ACCEPT,
  BEACON_COHORT_READY
} from './cohort/messages/constants.js';
import { BeaconCohortAdvertMessage } from './cohort/messages/keygen/cohort-advert.js';
import { BeaconCohortReadyMessage } from './cohort/messages/keygen/cohort-ready.js';
import { BeaconCohortOptInAcceptMessage, CohortOptInAcceptMessage } from './cohort/messages/keygen/opt-in-accept.js';
import { BeaconCohortOptInMessage } from './cohort/messages/keygen/opt-in.js';
import { BeaconCohortSubscribeMessage } from './cohort/messages/keygen/subscribe.js';
import { BeaconCohortAggregatedNonceMessage, CohortAggregatedNonceMessage } from './cohort/messages/sign/aggregated-nonce.js';
import { BeaconCohortAuthorizationRequestMessage, CohortAuthorizationRequestMessage } from './cohort/messages/sign/authorization-request.js';
import { BeaconCohortNonceContributionMessage } from './cohort/messages/sign/nonce-contribution.js';
import { BeaconCohortRequestSignatureMessage } from './cohort/messages/sign/request-signature.js';
import { BeaconCohortSignatureAuthorizationMessage } from './cohort/messages/sign/signature-authorization.js';
import { COHORT_STATUS } from './cohort/status.js';
import { NostrAdapter } from './communication/adapter/nostr.js';
import { CommunicationService } from './communication/service.js';
import { BeaconCohortSigningSession } from './session/index.js';

type Seed = KeyBytes;
type Mnemonic = string;

type SessionId = string;
type ActiveSigningSessions = Map<SessionId, BeaconCohortSigningSession>;

type CohortId = string;
type KeyIndex = number;
type CohortKeyState = Map<CohortId, KeyIndex>;

type BeaconParticipantParams = {
  ent: Seed | Mnemonic;
  protocol?: CommunicationService;
  did: string;
  name?: string
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
   * @type {Array<AggregateBeaconCohort>}
   */
  public cohorts: Array<AggregateBeaconCohort> = new Array<AggregateBeaconCohort>();

  /**
   * A mapping of Cohort IDs to HDKey indexes (CohortId => KeyIndex).
   * @type {CohortKeyState}
   */
  public cohortKeyState: CohortKeyState = new Map<CohortId, KeyIndex>();

  /**
   * A mapping of active Session IDs to their sessions (sessionId => BeaconCohortSigningSession).
   * @type {ActiveSigningSessions}
   */
  public activeSigningSessions: ActiveSigningSessions = new Map<string, BeaconCohortSigningSession>();

  /**
   * Creates an instance of BeaconParticipant.
   * @param {BeaconParticipantParams} params The parameters for the participant.
   * @param {Seed | Mnemonic} params.ent The seed or mnemonic to derive the HD key.
   * @param {CommunicationService} params.protocol The communication protocol to use.
   * @param {string} params.did The DID of the participant.
   * @param {string} [params.name] Optional name for the participant. If not provided, a random name will be generated.
   */
  constructor({ ent, protocol, did, name }: BeaconParticipantParams) {
    this.did = did;
    this.name = name || `btc1-beacon-participant-${crypto.randomUUID()}`;
    this.beaconKeyIndex = this.cohortKeyState.size;

    this.hdKey = ent instanceof Uint8Array
      ? HDKey.fromMasterSeed(ent)
      : HDKey.fromMasterSeed(mnemonicToSeedSync(ent));

    const hdkey = this.hdKey.deriveChild(this.beaconKeyIndex);
    if(!hdkey.publicKey || !hdkey.privateKey) {
      throw new BeaconParticipantError(
        `Failed to derive HD key for participant ${this.name} at index ${this.beaconKeyIndex}`,
        'CONSTRUCTOR_ERROR', hdkey
      );
    }
    this.protocol = protocol || new NostrAdapter({ public: hdkey.publicKey, secret: hdkey.privateKey });
    this.cohortKeyState.set('__UNSET__', this.beaconKeyIndex);
    Logger.debug(`BeaconParticipant initialized with DID: ${this.did}, Name: ${this.name}, Key Index: ${this.beaconKeyIndex}`);
  }

  /**
   * Starts the participant by registering message handlers for various message types.
   * @returns {void} The service adapter for the communication protocol.
   */
  public setup(): void {
    Logger.info(`Setting up BeaconParticipant ${this.name} (${this.did}) on ${this.protocol.name} ...`);
    this.protocol.registerMessageHandler(BEACON_COHORT_ADVERT, this._handleCohortAdvert.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_OPT_IN_ACCEPT, this._handleSubscribeAccept.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_READY, this._handleCohortReady.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_AUTHORIZATION_REQUEST, this._handleAuthorizationRequest.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_AGGREGATED_NONCE, this._handleAggregatedNonce.bind(this));
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
    if(keyIndex === undefined) {
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
   * @param {CohortOptInAcceptMessage} message The message containing the subscription acceptance.
   * @returns {Promise<void>}
   */
  private async _handleSubscribeAccept(message: Maybe<CohortOptInAcceptMessage>): Promise<void> {
    const subscribeAcceptMessage = BeaconCohortOptInAcceptMessage.fromJSON(message);
    const coordinatorDid = subscribeAcceptMessage.from;
    if (!this.coordinatorDids.includes(coordinatorDid)) {
      this.coordinatorDids.push(coordinatorDid);
    }
  }

  /**
   * Handles a cohort advertisement message.
   * @param {Maybe<BeaconCohortAdvertMessage>} message The cohort advertisement message.
   * @returns {Promise<void>}
   */
  public async _handleCohortAdvert(message: Maybe<BeaconCohortAdvertMessage>): Promise<void> {
    const cohortAdvertMessage = BeaconCohortAdvertMessage.fromJSON(message);
    Logger.info(`Received new cohort announcement from ${cohortAdvertMessage.from}`, cohortAdvertMessage);

    const from = cohortAdvertMessage.from;
    if (!this.coordinatorDids.includes(from)) {
      Logger.warn(`Received unsolicited new cohort announcement from ${from}`);
      return;
    }

    const cohortId = cohortAdvertMessage.body?.cohortId;
    if (!cohortId) {
      Logger.warn('Received malformed cohort advert message: missing cohortId', cohortAdvertMessage);
      return;
    }

    const network = cohortAdvertMessage.body?.network;
    if (!network) {
      Logger.warn('Received malformed cohort advert message: missing network', cohortAdvertMessage);
      return;
    }

    const minParticipants = cohortAdvertMessage.body?.cohortSize;
    if (!cohortId || !network || !minParticipants) {
      Logger.warn('Received malformed cohort advert message: missing minParticipants', cohortAdvertMessage);
      return;
    }

    const cohort = new AggregateBeaconCohort(
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
   * @param {Maybe<BeaconCohortReadyMessage>} message The cohort set message.
   * @returns {Promise<void>}
   */
  public async _handleCohortReady(message: Maybe<BeaconCohortReadyMessage>): Promise<void> {
    const cohortSetMessage = BeaconCohortReadyMessage.fromJSON(message);
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
   * @param {Maybe<CohortAuthorizationRequestMessage>} message The authorization request message.
   * @returns {Promise<void>}
   */
  public async _handleAuthorizationRequest(message: Maybe<CohortAuthorizationRequestMessage>): Promise<void> {
    const authRequest = BeaconCohortAuthorizationRequestMessage.fromJSON(message);
    const cohort = this.cohorts.find(c => c.id === authRequest.cohortId);
    if (!cohort) {
      Logger.warn(`Authorization request for unknown cohort ${authRequest.cohortId} from ${authRequest.from}`);
      return;
    }
    const session = new BeaconCohortSigningSession({
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
   * @param {Maybe<CohortAggregatedNonceMessage>} message The aggregated nonce message.
   * @returns {Promise<void>}
   */
  public async _handleAggregatedNonce(message: Maybe<CohortAggregatedNonceMessage>): Promise<void> {
    const aggNonceMessage = BeaconCohortAggregatedNonceMessage.fromJSON(message);
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
  public async subscribeToCoordinator(coordinatorDid: string): Promise<any> {
    if(this.coordinatorDids.includes(coordinatorDid)) {
      Logger.info(`Already subscribed to coordinator ${coordinatorDid}`);
      return;
    }
    const subMessage = new BeaconCohortSubscribeMessage({ to: coordinatorDid, from: this.did });
    return await this.protocol.sendMessage(subMessage, this.did, coordinatorDid);
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
    const optInMessage = BeaconCohortOptInMessage.fromJSON({
      cohortId,
      participantPk,
      from     : this.did,
      to       : coordinatorDid,
    });

    await this.protocol.sendMessage(optInMessage, this.did, coordinatorDid);
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
    const reqSigMessage = new BeaconCohortRequestSignatureMessage({
      to       : cohort.coordinatorDid,
      from     : this.did,
      data,
      cohortId
    });
    await this.protocol.sendMessage(reqSigMessage, this.did, cohort.coordinatorDid);
    return true;
  }

  /**
   * Generates a nonce contribution for the given cohort and session.
   * @param {AggregateBeaconCohort} cohort The cohort for which to generate the nonce contribution.
   * @param {BeaconCohortSigningSession} session The session for which to generate the nonce contribution.
   * @returns {Promise<string[]>} An array of nonce points in hexadecimal format.
   */
  public generateNonceContribution(cohort: AggregateBeaconCohort, session: BeaconCohortSigningSession): Uint8Array {
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
   * @param {AggregateBeaconCohort} cohort The cohort to which the nonce contribution is sent.
   * @param {Uint8Array} nonceContribution The nonce contribution points in hexadecimal format.
   * @param {BeaconCohortSigningSession} session The session associated with the nonce contribution.
   */
  public async sendNonceContribution(
    cohort: AggregateBeaconCohort,
    nonceContribution: Uint8Array,
    session: BeaconCohortSigningSession
  ): Promise<void> {
    const nonceContributionMessage = BeaconCohortNonceContributionMessage.fromJSON({
      to        : cohort.coordinatorDid,
      from      : this.did,
      body : {
        sessionId : session.id,
        cohortId  : cohort.id,
        nonceContribution
      }
    });
    await this.protocol.sendMessage(nonceContributionMessage, this.did, cohort.coordinatorDid);
    Logger.info(`Nonce contribution sent for session ${session.id} in cohort ${cohort.id} by participant ${this.did}`);
  }

  /**
   * Sends a partial signature for the given session.
   * @param {BeaconCohortSigningSession} session The session for which the partial signature is sent.
   * @param {Uint8Array} partialSig The partial signature to send.
   * @returns {Promise<void>}
   */
  public async sendPartialSignature(session: BeaconCohortSigningSession, partialSig: Uint8Array): Promise<void> {
    const sigAuthMessage = new BeaconCohortSignatureAuthorizationMessage({
      to               : session.cohort.coordinatorDid,
      from             : this.did,
      cohortId         : session.cohort.id,
      sessionId        : session.id,
      partialSignature : partialSig,
    });
    await this.protocol.sendMessage(sigAuthMessage, this.did, session.cohort.coordinatorDid);
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
  public static initialize(ent: Seed | Mnemonic, protocol: CommunicationService, did: string, name?: string): BeaconParticipant {
    return new BeaconParticipant({ent, protocol, name, did});
  }
}