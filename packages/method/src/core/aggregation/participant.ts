import { canonicalHash, canonicalize, KeyBytes, Maybe } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { hashToHex, verifySerializedProof, didToIndex, hexToHash, blockHash, SerializedSMTProof } from '@did-btcr2/smt';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import * as musig2 from '@scure/btc-signer/musig2';
import { Transaction } from 'bitcoinjs-lib';
import { BeaconParticipantError } from '../beacon/error.js';
import { AggregateBeaconCohort } from './cohort/index.js';
import {
  BEACON_COHORT_ADVERT,
  BEACON_COHORT_AGGREGATED_NONCE,
  BEACON_COHORT_AUTHORIZATION_REQUEST,
  BEACON_COHORT_DISTRIBUTE_DATA,
  BEACON_COHORT_OPT_IN_ACCEPT,
  BEACON_COHORT_READY
} from './cohort/messages/constants.js';
import { BeaconCohortAdvertMessage, CohortAdvertMessage } from './cohort/messages/keygen/cohort-advert.js';
import { BeaconCohortReadyMessage, CohortReadyMessage } from './cohort/messages/keygen/cohort-ready.js';
import { BeaconCohortOptInAcceptMessage, CohortOptInAcceptMessage } from './cohort/messages/keygen/opt-in-accept.js';
import { BeaconCohortOptInMessage } from './cohort/messages/keygen/opt-in.js';
import { BeaconCohortSubscribeMessage } from './cohort/messages/keygen/subscribe.js';
import { BeaconCohortDistributeDataMessage, CohortDistributeDataMessage } from './cohort/messages/update/distribute-data.js';
import { BeaconCohortSubmitUpdateMessage } from './cohort/messages/update/submit-update.js';
import { BeaconCohortValidationAckMessage } from './cohort/messages/update/validation-ack.js';
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
   * Signed updates submitted by this participant, keyed by cohort ID.
   * Used for validating aggregated data received from the coordinator.
   * @type {Map<string, SignedBTCR2Update>}
   */
  public submittedUpdates: Map<string, SignedBTCR2Update> = new Map();

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
    this.name = name || `btcr2-beacon-participant-${crypto.randomUUID()}`;
    this.beaconKeyIndex = this.cohortKeyState.size;

    this.hdKey = ent instanceof Uint8Array
      ? HDKey.fromMasterSeed(ent)
      : HDKey.fromMasterSeed(mnemonicToSeedSync(ent));

    const { publicKey: pk, privateKey: secret } = this.hdKey.deriveChild(this.beaconKeyIndex);
    if(!pk || !secret) {
      throw new BeaconParticipantError(
        `Failed to derive HD key for participant ${this.name} at index ${this.beaconKeyIndex}`,
        'CONSTRUCTOR_ERROR', { public: pk, secret }
      );
    }
    this.protocol = protocol || new NostrAdapter();
    this.protocol.setKeys({ public: pk, secret });
    this.cohortKeyState.set('__UNSET__', this.beaconKeyIndex);
    console.debug(`BeaconParticipant initialized with DID: ${this.did}, Name: ${this.name}, Key Index: ${this.beaconKeyIndex}`);
  }

  /**
   * Setup and start the BeaconParticipant communication protocol..
   * @returns {void}
   */
  public start(): void {
    console.info(`Setting up BeaconParticipant ${this.name} (${this.did}) on ${this.protocol.name} ...`);
    this.protocol.registerMessageHandler(BEACON_COHORT_ADVERT, this._handleCohortAdvert.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_OPT_IN_ACCEPT, this._handleSubscribeAccept.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_READY, this._handleCohortReady.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_DISTRIBUTE_DATA, this._handleDistributeData.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_AUTHORIZATION_REQUEST, this._handleAuthorizationRequest.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_AGGREGATED_NONCE, this._handleAggregatedNonce.bind(this));
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
      console.warn(`Cohort key state for cohort ${cohortId} already exists. Updating key index.`);
    }
    this.cohortKeyState.set(cohortId, this.beaconKeyIndex);
    console.info(`Cohort key state updated. Next beacon key index: ${this.beaconKeyIndex + 1}`);
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
      console.warn(`Cohort key state already exists for ${cohortId}. Skipping migration from '__UNSET__'.`);
      this.cohortKeyState.delete(unsetKey);
      return;
    }

    this.setCohortKey(cohortId);
    this.cohortKeyState.delete(unsetKey);

    console.info(`Finalized '__UNSET__' CohortKeyState with ${cohortId} for ${this.did}`);
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
  public async _handleCohortAdvert(message: Maybe<CohortAdvertMessage>): Promise<void> {
    console.debug('_handleCohortAdvert', message);
    const cohortAdvertMessage = BeaconCohortAdvertMessage.fromJSON(message);
    console.info(`Received new cohort announcement from ${cohortAdvertMessage.from}`, cohortAdvertMessage);

    const cohortId = cohortAdvertMessage.body?.cohortId;
    if (!cohortId) {
      console.warn('Received malformed cohort advert message: missing cohortId', cohortAdvertMessage);
      return;
    }

    const network = cohortAdvertMessage.body?.network;
    if (!network) {
      console.warn('Received malformed cohort advert message: missing network', cohortAdvertMessage);
      return;
    }

    const minParticipants = cohortAdvertMessage.body?.cohortSize;
    if (!cohortId || !network || !minParticipants) {
      console.warn('Received malformed cohort advert message: missing minParticipants', cohortAdvertMessage);
      return;
    }

    const from = cohortAdvertMessage.from;
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
   * @param {Maybe<CohortReadyMessage>} message The cohort set message.
   * @returns {Promise<void>}
   */
  public async _handleCohortReady(message: Maybe<CohortReadyMessage>): Promise<void> {
    const cohortSetMessage = BeaconCohortReadyMessage.fromJSON(message);
    const cohortId = cohortSetMessage.body?.cohortId;
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohortId || !cohort) {
      console.warn(`Cohort with ID ${cohortId} not found or not joined by participant ${this.did}.`);
      return;
    }
    this.finalizeUnsetCohortKey(cohortId);
    const participantPkBytes = this.getCohortKey(cohortId).publicKey;
    if(!participantPkBytes) {
      console.error(`Failed to derive public key for cohort ${cohortId}`);
      return;
    }
    const participantPk = Buffer.from(participantPkBytes).toString('hex');
    const beaconAddress = cohortSetMessage.body?.beaconAddress;
    if(!beaconAddress) {
      console.error(`Beacon address not provided in cohort set message for ${cohortId}`);
      return;
    }
    const cohortKeys = cohortSetMessage.body?.cohortKeys;
    if(!cohortKeys) {
      console.error(`Cohort keys not provided in cohort set message for ${cohortId}`);
      return;
    }
    const keys = cohortKeys.map(key => Buffer.from(key).toString('hex'));
    cohort.validateCohort([participantPk], keys, beaconAddress);
    console.info(`BeaconParticipant w/ pk ${participantPk} successfully joined cohort ${cohortId} with beacon address ${beaconAddress}.`);
    console.info(`Cohort status: ${cohort.status}`);
  }

  /**
   * Handles aggregated data distribution from the coordinator.
   * Validates the data matches this participant's submitted update, then sends a validation ack.
   * For CAS beacons: verifies the CAS Announcement maps this participant's DID to the correct update hash.
   * For SMT beacons: verifies the SMT proof includes this participant's update with valid Merkle inclusion.
   * @param {Maybe<CohortDistributeDataMessage>} message The distribute data message.
   * @returns {Promise<void>}
   */
  public async _handleDistributeData(message: Maybe<CohortDistributeDataMessage>): Promise<void> {
    const distMessage = BeaconCohortDistributeDataMessage.fromJSON(message);
    const cohortId = distMessage.body?.cohortId;
    if(!cohortId) {
      console.warn(`Distribute data message missing cohort ID from ${distMessage.from}`);
      return;
    }
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if(!cohort) {
      console.warn(`Cohort with ID ${cohortId} not found for participant ${this.did}.`);
      return;
    }
    const submittedUpdate = this.submittedUpdates.get(cohortId);
    if(!submittedUpdate) {
      console.warn(`No submitted update found for cohort ${cohortId} by participant ${this.did}.`);
      return;
    }

    const beaconType = distMessage.body?.beaconType;
    let approved = false;

    if(beaconType === 'CASBeacon') {
      approved = this.#validateCASAnnouncement(distMessage, submittedUpdate);
    } else if(beaconType === 'SMTBeacon') {
      approved = this.#validateSMTProof(distMessage, submittedUpdate);
    } else {
      console.error(`Unsupported beacon type: ${beaconType}`);
    }

    const ackMessage = new BeaconCohortValidationAckMessage({
      to       : cohort.coordinatorDid,
      from     : this.did,
      cohortId,
      approved,
    });
    await this.protocol.sendMessage(ackMessage, this.did, cohort.coordinatorDid);
    console.info(`Validation ack sent for cohort ${cohortId}: ${approved ? 'approved' : 'rejected'}`);
  }

  /**
   * Validates a CAS Announcement by checking that this participant's DID maps
   * to the canonical hash of their submitted signed update.
   */
  #validateCASAnnouncement(message: BeaconCohortDistributeDataMessage, submittedUpdate: SignedBTCR2Update): boolean {
    const casAnnouncement = message.body?.casAnnouncement;
    if(!casAnnouncement) {
      console.error('CAS Announcement missing from distribute data message.');
      return false;
    }
    const expectedHash = canonicalHash(submittedUpdate);
    const actualHash = casAnnouncement[this.did];
    if(actualHash !== expectedHash) {
      console.error(`CAS Announcement hash mismatch for ${this.did}: expected ${expectedHash}, got ${actualHash}`);
      return false;
    }
    return true;
  }

  /**
   * Validates an SMT proof by checking Merkle inclusion of this participant's update.
   * Verifies the proof's updateId matches the expected hash and the Merkle path is valid.
   */
  #validateSMTProof(message: BeaconCohortDistributeDataMessage, submittedUpdate: SignedBTCR2Update): boolean {
    const smtProof = message.body?.smtProof as unknown as SerializedSMTProof | undefined;
    if(!smtProof) {
      console.error('SMT proof missing from distribute data message.');
      return false;
    }
    if(!smtProof.updateId || !smtProof.nonce) {
      console.error('SMT proof missing updateId or nonce.');
      return false;
    }

    // Verify updateId matches the hash of the canonicalized submitted update
    const canonicalBytes = new TextEncoder().encode(canonicalize(submittedUpdate));
    const expectedUpdateId = hashToHex(blockHash(canonicalBytes));
    if(smtProof.updateId !== expectedUpdateId) {
      console.error(`SMT proof updateId mismatch: expected ${expectedUpdateId}, got ${smtProof.updateId}`);
      return false;
    }

    // Verify Merkle inclusion
    const index = didToIndex(this.did);
    const candidateHash = blockHash(blockHash(hexToHash(smtProof.nonce)), hexToHash(smtProof.updateId));
    const valid = verifySerializedProof(smtProof, index, candidateHash);
    if(!valid) {
      console.error(`SMT Merkle proof verification failed for ${this.did}`);
      return false;
    }

    return true;
  }

  /**
   * Handles an authorization request message.
   * @param {Maybe<CohortAuthorizationRequestMessage>} message The authorization request message.
   * @returns {Promise<void>}
   */
  public async _handleAuthorizationRequest(message: Maybe<CohortAuthorizationRequestMessage>): Promise<void> {
    const authRequest = BeaconCohortAuthorizationRequestMessage.fromJSON(message);
    const cohort = this.cohorts.find(c => c.id === authRequest.body?.cohortId);
    if (!cohort) {
      console.warn(`Authorization request for unknown cohort ${authRequest.body?.cohortId} from ${authRequest.from}`);
      return;
    }
    const id = authRequest.body?.sessionId;
    if (!id) {
      console.warn(`Authorization request missing session ID from ${authRequest.from}`);
      return;
    }
    const pendingTx = authRequest.body?.pendingTx;
    if (!pendingTx) {
      console.warn(`Authorization request missing pending transaction from ${authRequest.from}`);
      return;
    }
    const session = new BeaconCohortSigningSession({
      cohort,
      id,
      pendingTx : Transaction.fromHex(pendingTx),
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
    const sessionId = aggNonceMessage.body?.sessionId;
    if (!sessionId) {
      console.warn(`Aggregated nonce message missing session ID from ${aggNonceMessage.from}`);
      return;
    }
    const session = this.activeSigningSessions.get(sessionId);
    if (!session) {
      console.warn(`Aggregated nonce message received for unknown session ${sessionId}`);
      return;
    }
    const aggregatedNonce = aggNonceMessage.body?.aggregatedNonce;
    if (!aggregatedNonce) {
      console.warn(`Aggregated nonce message missing aggregated nonce from ${aggNonceMessage.from}`);
      return;
    }
    session.aggregatedNonce = aggregatedNonce;
    const participantSk = this.getCohortKey(session.cohort.id).privateKey;
    if(!participantSk) {
      console.error(`Failed to derive secret key for cohort ${session.cohort.id}`);
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
      console.info(`Already subscribed to coordinator ${coordinatorDid}`);
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
    console.info(`BeaconParticipant ${this.did} joining cohort ${cohortId} with coordinator ${coordinatorDid}`);
    this.finalizeUnsetCohortKey(cohortId);
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohort) {
      console.warn(`Cohort with ID ${cohortId} not found.`);
      return;
    }
    const pk = this.getCohortKey(cohortId).publicKey;
    if(!pk) {
      console.error(`Failed to derive public key for cohort ${cohortId} at index ${this.beaconKeyIndex}`);
      return;
    }
    this.setCohortKey(cohortId);
    const optInMessage = new BeaconCohortOptInMessage({
      cohortId,
      participantPk : pk,
      from          : this.did,
      to            : coordinatorDid,
    });

    await this.protocol.sendMessage(optInMessage, this.did, coordinatorDid);
    cohort.status = COHORT_STATUS.COHORT_OPTED_IN;
  }

  /**
   * Submits a signed DID update to the cohort coordinator during the Announce Updates phase.
   * @param {string} cohortId The ID of the cohort to submit the update to.
   * @param {SignedBTCR2Update} signedUpdate The participant's signed update to include in the aggregation.
   * @returns {Promise<void>}
   */
  public async submitUpdate(cohortId: string, signedUpdate: SignedBTCR2Update): Promise<void> {
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if(!cohort) {
      throw new BeaconParticipantError(
        `Cohort with ID ${cohortId} not found.`,
        'COHORT_NOT_FOUND', { cohortId }
      );
    }
    if(cohort.status !== COHORT_STATUS.COHORT_SET_STATUS && cohort.status !== COHORT_STATUS.COLLECTING_UPDATES) {
      throw new BeaconParticipantError(
        `Cohort ${cohortId} is not accepting updates. Current status: ${cohort.status}`,
        'UPDATE_SUBMISSION_ERROR', { cohortId, status: cohort.status }
      );
    }
    const message = new BeaconCohortSubmitUpdateMessage({
      to           : cohort.coordinatorDid,
      from         : this.did,
      cohortId,
      signedUpdate : signedUpdate as unknown as Record<string, unknown>,
    });
    await this.protocol.sendMessage(message, this.did, cohort.coordinatorDid);
    this.submittedUpdates.set(cohortId, signedUpdate);
    console.info(`Update submitted for cohort ${cohortId} by participant ${this.did}`);
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
      console.warn(`Cohort with ID ${cohortId} not found.`);
      return false;
    }
    if(cohort.status !== COHORT_STATUS.COHORT_SET_STATUS) {
      console.warn(`Cohort ${cohortId} not in a set state. Current status: ${cohort.status}`);
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
      to                : cohort.coordinatorDid,
      from              : this.did,
      sessionId         : session.id,
      cohortId          : cohort.id,
      nonceContribution
    });
    await this.protocol.sendMessage(nonceContributionMessage, this.did, cohort.coordinatorDid);
    console.info(`Nonce contribution sent for session ${session.id} in cohort ${cohort.id} by participant ${this.did}`);
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
    console.info(`Partial signature sent for session ${session.id} in cohort ${session.cohort.id} by participant ${this.did}`);
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