import { Logger, Maybe } from '@did-btcr2/common';
import { RawSchnorrKeyPair } from '@did-btcr2/keypair';
import { BeaconCoordinatorError } from '../error.js';
import { AggregateBeaconCohort } from './cohort/index.js';
import {
  BEACON_COHORT_ADVERT,
  BEACON_COHORT_NONCE_CONTRIBUTION,
  BEACON_COHORT_OPT_IN,
  BEACON_COHORT_OPT_IN_ACCEPT,
  BEACON_COHORT_REQUEST_SIGNATURE,
  BEACON_COHORT_SIGNATURE_AUTHORIZATION
} from './cohort/messages/constants.js';
import { BeaconCohortAdvertMessage } from './cohort/messages/keygen/cohort-advert.js';
import { BeaconCohortReadyMessage } from './cohort/messages/keygen/cohort-ready.js';
import { BeaconCohortOptInMessage, CohortOptInMessage } from './cohort/messages/keygen/opt-in.js';
import { BeaconCohortAggregatedNonceMessage } from './cohort/messages/sign/aggregated-nonce.js';
import { BeaconCohortNonceContributionMessage, CohortNonceContributionMessage } from './cohort/messages/sign/nonce-contribution.js';
import { BeaconCohortRequestSignatureMessage, CohortRequestSignatureMessage } from './cohort/messages/sign/request-signature.js';
import { BeaconCohortSignatureAuthorizationMessage, CohortSignatureAuthorizationMessage } from './cohort/messages/sign/signature-authorization.js';
import { NostrAdapter } from './communication/adapter/nostr.js';
import { CommunicationFactory } from './communication/factory.js';
import { CommunicationService, Service, ServiceAdapterIdentity } from './communication/service.js';
import { BeaconCohortSigningSession } from './session/index.js';
import { SIGNING_SESSION_STATUS } from './session/status.js';

/**
 * Parameters for initializing a BeaconCoordinator.
 * @type {BeaconCoordinatorParams}
 * @property {CommunicationService} [protocol] - The communication protocol to be used.
 * @property {string} did - The Decentralized Identifier (DID) for the coordinator.
 * @property {ServiceAdapterIdentity<RawSchnorrKeyPair>} keys - The keys used for cryptographic operations.
 * @property {string} [name] - Optional name for the coordinator.
 */
export type BeaconCoordinatorParams = {
  protocol?: CommunicationService;
  did: string;
  keys: ServiceAdapterIdentity<RawSchnorrKeyPair>
  name?: string;
}
/**
 * The BeaconCoordinator class is responsible for managing the coordination of beacon aggregation.
 * @class BeaconCoordinator
 * @type {BeaconCoordinator}
 */
export class BeaconCoordinator {
  /**
   * The name of the BeaconCoordinator service.
   * @type {string}
   */
  name: string;

  /**
   * The DID of the BeaconCoordinator.
   * @type {Array<string>}
   */
  did: string;

  /**
   * The communication protocol used by the BeaconCoordinator.
   * @type {CommunicationService}
   */
  protocol: CommunicationService;

  /**
   * List of subscribers engaged in a Musig2 Cohort signing session with the BeaconCoordinator.
   * @type {Array<string>}
   */
  cohorts: Array<AggregateBeaconCohort> = [];

  /**
   * Active signing sessions for the BeaconCoordinator.
   * @type {Record<string, BeaconCohortSigningSession>}
   */
  activeSigningSessions: Map<string, BeaconCohortSigningSession> = new Map();

  /**
   * Constructs a new BeaconCoordinator instance.
   * @param {BeaconCoordinatorParams} params The parameters for the coordinator.
   * @param {CommunicationService} params.protocol The protocol service used for communication.
   * @param {string} [params.name] Optional name for the coordinator. If not provided, a default name will be generated.
   * @param {string} [params.did] Optional DID to use for the coordinator. If not provided, a new DID will be generated.
   * @param {ServiceAdapterIdentity<RawKeyPair>} params.keys The keys used for cryptographic operations.
   */
  constructor(params: {
    did: string;
    keys: ServiceAdapterIdentity<RawSchnorrKeyPair>
    protocol?: CommunicationService;
    name?: string;
  }) {
    this.did = params.did;
    this.protocol = params.protocol || new NostrAdapter();
    this.protocol.setKeys(params.keys);
    this.name = params.name || `btcr2-beacon-coordinator-${crypto.randomUUID()}`;
  }

  /**
   * Setup and start the BeaconCoordinator communication protocol.
   * @returns {void}
   */
  start(): void {
    Logger.info(`Setting up BeaconCoordinator ${this.name} (${this.did}) on ${this.protocol.name} ...`);
    this.protocol.registerMessageHandler(BEACON_COHORT_OPT_IN, this.#handleOptIn.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_REQUEST_SIGNATURE, this.#handleRequestSignature.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_NONCE_CONTRIBUTION, this.#handleNonceContribution.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_SIGNATURE_AUTHORIZATION, this.#handleSignatureAuthorization.bind(this));
    this.protocol.start();
  }

  /**
   * Handles opt-in requests from participants to join a cohort.
   * @param {OptInMessage} message The message containing the opt-in request.
   * @returns {Promise<void>}
   */
  async #handleOptIn(message: CohortOptInMessage): Promise<void> {
    const optIn = BeaconCohortOptInMessage.fromJSON(message);
    const cohortId = optIn.body?.cohortId;
    const participant = optIn.from;
    const participantPk = optIn.body?.participantPk;
    if(!cohortId || !participant || !participantPk) {
      Logger.warn(`Invalid opt-in message from ${participant}: missing cohortId, participant or participantPk`);
      return;
    }
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (cohort && !cohort.participants.includes(participant)) {
      cohort.participants.push(participant);
      cohort.cohortKeys.push(participantPk);
      await this.acceptSubscription(participant);
      // If the cohort has enough participants, start the key generation process.
      if (cohort.participants.length >= cohort.minParticipants) {
        await this._startKeyGeneration(cohort);
      }
    }
  }

  /**
   * Handles request signature messages from participants.
   * @private
   * @param {CohortRequestSignatureMessage} message The message containing the request signature.
   * @returns {Promise<void>}
   */
  async #handleRequestSignature(message: Maybe<CohortRequestSignatureMessage>): Promise<void> {
    const signatureRequest = BeaconCohortRequestSignatureMessage.fromJSON(message);
    const cohortId = signatureRequest.body?.cohortId;
    if (!cohortId) {
      Logger.warn(`Signature request missing cohort ID from ${signatureRequest.from}`);
      return;
    }
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohort) {
      Logger.error(`Cohort with ID ${cohortId} not found.`);
      return;
    }
    cohort.addSignatureRequest(signatureRequest);
    Logger.info(`Received signature request from ${signatureRequest.from} for cohort ${cohortId}.`);
  }

  /**
   * Handles nonce contribution messages from participants.
   * @param {CohortNonceContributionMessage} message The message containing the nonce contribution.
   * @returns {Promise<void>}
   */
  async #handleNonceContribution(message: CohortNonceContributionMessage): Promise<void> {
    // Cast message to NonceContributionMessage type.
    const nonceContribMessage = BeaconCohortNonceContributionMessage.fromJSON(message);
    const cohortId = nonceContribMessage.body?.cohortId;
    if (!cohortId) {
      Logger.warn(`Nonce contribution message missing cohort ID from ${nonceContribMessage.from}`);
      return;
    }
    const sessionId = nonceContribMessage.body?.sessionId;
    if (!sessionId) {
      Logger.warn(`Nonce contribution message missing session ID from ${nonceContribMessage.from}`);
      return;
    }
    // Get the signing session using the cohort ID from the message.
    const signingSession = this.activeSigningSessions.get(cohortId || sessionId);

    // If the signing session does not exist, log an error and return.
    if(!signingSession) {
      Logger.error(`Session ${cohortId || sessionId} not found.`);
      return;
    }

    // If the message.cohortId does not match the signingSession.cohortId, throw an error.
    if(cohortId !== signingSession.cohort.id) {
      throw new BeaconCoordinatorError(
        `Nonce contribution for wrong cohort: ${signingSession.cohort.id} != ${cohortId}`,
        'NONCE_CONTRIBUTION_ERROR', message
      );
    }
    const nonceContribution = nonceContribMessage.body?.nonceContribution;
    if(!nonceContribution) {
      Logger.warn(`Nonce contribution message missing nonce contribution from ${nonceContribMessage.from}`);
      return;
    }
    // Add the nonce contribution to the signing session.
    signingSession.addNonceContribution(nonceContribMessage.from, nonceContribution);
    Logger.info(`Nonce contribution received from ${nonceContribMessage.from} for session ${sessionId}.`);

    if (signingSession.status !== SIGNING_SESSION_STATUS.NONCE_CONTRIBUTIONS_RECEIVED) {
      await this.sendAggregatedNonce(signingSession);
    }
  }

  /**
   * Handles signature authorization messages from participants.
   * @param {Maybe<CohortSignatureAuthorizationMessage>} message The message containing the signature authorization request.
   * @returns {Promise<void>}
   */
  async #handleSignatureAuthorization(message: Maybe<CohortSignatureAuthorizationMessage>): Promise<void> {
    const sigAuthMessage = BeaconCohortSignatureAuthorizationMessage.fromJSON(message);
    const cohortId = sigAuthMessage.body?.cohortId;
    if (!cohortId) {
      Logger.warn(`Signature authorization message missing cohort ID from ${sigAuthMessage.from}`);
      return;
    }
    const sessionId = sigAuthMessage.body?.sessionId;
    if (!sessionId) {
      Logger.warn(`Signature authorization message missing session ID from ${sigAuthMessage.from}`);
      return;
    }
    const signingSession = this.activeSigningSessions.get(cohortId || sessionId);
    if (!signingSession) {
      Logger.error(`Session ${sessionId} not found.`);
      return;
    }

    if(signingSession.id !== sessionId) {
      throw new BeaconCoordinatorError(
        `Signature authorization for wrong session: ${signingSession.id} != ${sessionId}`,
        'SIGNATURE_AUTHORIZATION_ERROR', { original: message, converted: sigAuthMessage }
      );
    }

    if(signingSession.status !== SIGNING_SESSION_STATUS.AWAITING_PARTIAL_SIGNATURES) {
      throw new BeaconCoordinatorError(
        `Partial signature received but not expected. Current status: ${signingSession.status}`,
        'SIGNATURE_AUTHORIZATION_ERROR', { original: message, converted: sigAuthMessage }
      );
    }
    const partialSignature = sigAuthMessage.body?.partialSignature;
    if (!partialSignature) {
      Logger.warn(`Signature authorization message missing partial signature from ${sigAuthMessage.from}`);
      return;
    }
    // Add the signature authorization to the signing session.
    signingSession.addPartialSignature(sigAuthMessage.from, partialSignature);
    Logger.info(`Received partial signature from ${sigAuthMessage.from} for session ${sessionId}.`);

    if(signingSession.partialSignatures.size === signingSession.cohort.participants.length) {
      signingSession.status = SIGNING_SESSION_STATUS.PARTIAL_SIGNATURES_RECEIVED;
    }

    if (signingSession.status === SIGNING_SESSION_STATUS.PARTIAL_SIGNATURES_RECEIVED) {
      const signature = await signingSession.generateFinalSignature();
      Logger.info(`Final signature ${Buffer.from(signature).toString('hex')} generated for session ${signingSession.id}`);
    }
  }

  /**
   * Starts the key generation process for a cohort once it has enough participants.
   * @param {Musig2Cohort} cohort The cohort for which to start key generation.
   * @returns {Promise<void>}
   */
  private async _startKeyGeneration(cohort: AggregateBeaconCohort): Promise<void> {
    Logger.info(`Starting key generation for cohort ${cohort.id} with participants: ${cohort.participants.join(', ')}`);
    cohort.finalize();
    for(const participant of cohort.participants) {
      const message = cohort.getCohortReadyMessage(participant, this.did);
      Logger.info(`Sending BEACON_COHORT_READY message to ${participant}`);
      await this.protocol.sendMessage(message, participant, this.did);
    }
    Logger.info(`Finished sending BEACON_COHORT_READY message to ${cohort.participants.length} participants`);
  }

  /**
   * Accepts a subscription request from a participant.
   * @param {string} participant The DID of the participant requesting the subscription.
   * @returns {Promise<void>}
   */
  async acceptSubscription(participant: string): Promise<void> {
    Logger.info(`Accepting subscription from ${participant}`);
    const message = {
      type : BEACON_COHORT_OPT_IN_ACCEPT,
      to   : participant,
      from : this.did
    };
    await this.protocol.sendMessage(message, this.did, participant);
  }

  /**
   * Sends the aggregated nonce to all participants in the session.
   * @param {BeaconCohortSigningSession} session The session containing the aggregated nonce.
   * @returns {Promise<void>}
   */
  async sendAggregatedNonce(session: BeaconCohortSigningSession): Promise<void> {
    const aggregatedNonce = session.generateAggregatedNonce();
    Logger.info(`Aggregated Nonces for session ${session.id}:`, aggregatedNonce);

    session.status = SIGNING_SESSION_STATUS.AWAITING_PARTIAL_SIGNATURES;
    for (const participant of session.cohort.participants) {
      const message = new BeaconCohortAggregatedNonceMessage({
        to              : participant,
        from            : this.did,
        cohortId        : session.cohort.id,
        sessionId       : session.id,
        aggregatedNonce : aggregatedNonce
      });
      Logger.info(`Sending AGGREGATED_NONCE message to ${participant}`);
      await this.protocol.sendMessage(message, participant, this.did);
    }
    Logger.info(`Successfully sent aggregated nonce message to all participants in session ${session.id}.`);
  }

  /**
   * Announces a new cohort to all subscribers.
   * @param {number} minParticipants The minimum number of participants required for the cohort.
   * @param {string} [network='mutinynet'] The network on which the cohort operates (default is 'signet').
   * @param {string} [beaconType='SMTBeacon'] The type of beacon to be used (default is 'SMTBeacon').
   * @returns {Promise<AggregateBeaconCohort>} The newly created cohort.
   */
  async advertiseCohort(
    minParticipants: number,
    network: string = 'mutinynet',
    beaconType: string = 'SMTBeacon'
  ): Promise<AggregateBeaconCohort> {
    const cohort = new AggregateBeaconCohort({ minParticipants, network, beaconType });
    Logger.info(`Advertising new cohort ${cohort.id} ...`);
    this.cohorts.push(cohort);
    const message = new BeaconCohortAdvertMessage({
      from       : this.did,
      cohortId   : cohort.id,
      cohortSize : cohort.minParticipants,
      network    : cohort.network,
      beaconType
    });
    Logger.info(`Sending ${BEACON_COHORT_ADVERT} message to network ...`, message);
    await this.protocol.sendMessage(message, this.did);
    Logger.info(`Cohort ${cohort.id} advertised successfully.`);
    return cohort;
  }


  /**
   * Announces to all subscribers a cohort is ready for signing.
   * @param {string} cohortId The minimum number of participants required for the cohort.
   * @returns {Promise<AggregateBeaconCohort>} The newly created cohort.
   */
  async announceCohortReady(cohortId: string): Promise<AggregateBeaconCohort> {
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohort) {
      Logger.error(`Cohort with ID ${cohortId} not found.`);
      throw new BeaconCoordinatorError(
        `Cohort with ID ${cohortId} not found.`,
        'COHORT_NOT_FOUND', { cohortId }
      );
    }
    Logger.info(`Announcing cohort ${cohort.id} to ${cohort.participants.length} subscribers...`);
    this.cohorts.push(cohort);
    for (const participant of cohort.participants) {
      const message = new BeaconCohortReadyMessage({
        to            : participant,
        from          : this.did,
        cohortId      : cohort.id,
        beaconAddress : cohort.beaconAddress,
        cohortKeys    : cohort.cohortKeys,
      });
      Logger.info(`Sending ${BEACON_COHORT_ADVERT} message to ${participant}`);

      await this.protocol.sendMessage(message, this.did, participant);
    }
    return cohort;
  }

  /**
   * Starts a signing session for a given cohort.
   * @param {string} cohortId The ID of the cohort for which to start a signing session.
   * @returns {Promise<BeaconCohortSigningSession>} The started signing session.
   * @throws {BeaconCoordinatorError} If the cohort with the given ID is not found.
   */
  async startSigningSession(cohortId: string): Promise<BeaconCohortSigningSession> {
    Logger.info(`Attempting to start signing session for cohort ${cohortId}`);
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohort) {
      Logger.error(`Cohort with ID ${cohortId} not found.`);
      throw new BeaconCoordinatorError(`Cohort with ID ${cohortId} not found.`, 'COHORT_NOT_FOUND');
    }
    Logger.info(`Cohort ${cohortId} found. Starting signing session.`);
    const signingSession = cohort.startSigningSession();
    Logger.info(`Starting signing session ${signingSession.id} for cohort ${cohortId}`);
    for (const participant of cohort.participants) {
      const msg = signingSession.getAuthorizationRequest(participant, this.did);
      Logger.info(`Sending authorization request to ${participant}`);
      await this.protocol.sendMessage(msg, this.did, participant).catch(error => {
        Logger.error(`Error sending authorization request to ${participant}: ${error.message}`);
      });
    }
    this.activeSigningSessions.set(cohortId, signingSession);
    Logger.info(`Signing session ${signingSession.id} started for cohort ${cohortId}`);
    return signingSession;
  }

  /**
   * Static initialization method for the BeaconCoordinator.
   * @param {Service} service The communication service configuration.
   * @returns {BeaconCoordinator} Initialized BeaconCoordinator instance.
   */
  static initialize(service: Service): BeaconCoordinator {
    const communicationService = CommunicationFactory.establish(service);
    const coordinator = new BeaconCoordinator({
      protocol : communicationService,
      did      : service.did,
      keys     : service.keys,
    });
    Logger.info(`BeaconCoordinator ${coordinator.name} initialized with DID ${coordinator.did}. Run .start() to listen for messages`);
    return coordinator;
  }
}