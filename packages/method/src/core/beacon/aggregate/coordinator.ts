import { Logger, Maybe } from '@did-btc1/common';
import { BeaconCoordinatorError } from '../error.js';
import { CommunicationFactory } from './communication/factory.js';
import { NostrAdapter } from './communication/nostr.js';
import { CommunicationService, Service } from './communication/service.js';
import { BaseMessage } from './messages/base.js';
import { COHORT_ADVERT, NONCE_CONTRIBUTION, OPT_IN, REQUEST_SIGNATURE, SIGNATURE_AUTHORIZATION, SUBSCRIBE, SUBSCRIBE_ACCEPT } from './messages/constants.js';
import { CohortAdvertMessage } from './messages/keygen/cohort-advert.js';
import { OptInMessage } from './messages/keygen/opt-in.js';
import { AggregatedNonceMessage } from './messages/sign/aggregated-nonce.js';
import { NonceContributionMessage } from './messages/sign/nonce-contribution.js';
import { RequestSignatureMessage } from './messages/sign/request-signature.js';
import { SignatureAuthorizationMessage } from './messages/sign/signature-authorization.js';
import { Musig2Cohort } from './models/cohort/index.js';
import { SignatureAuthorizationSession } from './models/session/index.js';
import { SIGNING_SESSION_STATUS } from './models/session/status.js';

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
  public name: string;

  /**
   * The DID of the BeaconCoordinator.
   * @type {Array<string>}
   */
  public did: string;

  /**
   * The communication protocol used by the BeaconCoordinator.
   * @type {CommunicationService}
   */
  public protocol: CommunicationService;

  /**
   * List of subscribers engaged in a Musig2 Cohort signing session with the BeaconCoordinator.
   * @type {Array<string>}
   */
  public cohorts: Array<Musig2Cohort> = [];

  /**
   * List of subscribers to the BeaconCoordinator service.
   * @type {Array<string>}
   */
  private subscribers: string[] = [];

  /**
   * Active signing sessions for the BeaconCoordinator.
   * @type {Record<string, SignatureAuthorizationSession>}
   */
  public activeSigningSessions: Map<string, SignatureAuthorizationSession> = new Map();

  /**
   * Constructs a new BeaconCoordinator instance.
   * @param {CommunicationService} protocol The protocol service used for communication.
   * @param {string} [did] Optional DID to use for the coordinator. If not provided, a new DID will be generated.
   */
  constructor(protocol: CommunicationService, name?: string, did?: string) {
    this.name = name || 'BeaconCoordinator';
    this.protocol = protocol || new NostrAdapter();
    this.did = did || this.protocol.generateIdentity();
  }

  /**
   * Sets up the and starts the BeaconCoordinator communication protocol.
   * @returns {void}
   */
  public start(): void {
    Logger.info(`Starting BeaconCoordinator (${this.did}) on ${this.protocol.name}!`);
    this.protocol.registerMessageHandler(SUBSCRIBE, this._handleSubscribe.bind(this));
    this.protocol.registerMessageHandler(OPT_IN, this._handleOptIn.bind(this));
    this.protocol.registerMessageHandler(REQUEST_SIGNATURE, this._handleRequestSignature.bind(this));
    this.protocol.registerMessageHandler(NONCE_CONTRIBUTION, this._handleNonceContribution.bind(this));
    this.protocol.registerMessageHandler(SIGNATURE_AUTHORIZATION, this._handleSignatureAuthorization.bind(this));
    this.protocol.start();
    Logger.info(`Started BeaconCoordinator (${this.did}) on ${this.protocol.name}, listening for messages ...`);
  }

  /**
   * Handles subscription requests from other participants.
   * @param {BaseMessage} message The message containing the subscription request.
   * @returns {Promise<void>}
   */
  private async _handleSubscribe(message: BaseMessage): Promise<void> {
    const sender = message.from;
    if (!this.subscribers.includes(sender)) {
      this.subscribers.push(sender);
      await this.acceptSubscription(sender);
    }
  }

  /**
   * Handles opt-in requests from participants to join a cohort.
   * @param {OptInMessage} message The message containing the opt-in request.
   * @returns {Promise<void>}
   */
  private async _handleOptIn(message: OptInMessage): Promise<void> {
    const optIn = OptInMessage.fromJSON(message);
    const cohortId = optIn.cohortId;
    const participant = optIn.from;
    const participantPk = optIn.participantPk;
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
   * @param {RequestSignatureMessage} message The message containing the request signature.
   * @returns {Promise<void>}
   */
  private async _handleRequestSignature(message: Maybe<RequestSignatureMessage>): Promise<void> {
    const signatureRequest = RequestSignatureMessage.fromJSON(message);
    const cohort = this.cohorts.find(c => c.id === signatureRequest.cohortId);
    if (!cohort) {
      Logger.error(`Cohort with ID ${signatureRequest.cohortId} not found.`);
      return;
    }
    cohort.addSignatureRequest(signatureRequest);
    Logger.info(`Received signature request from ${signatureRequest.from} for cohort ${signatureRequest.cohortId}.`);
  }

  /**
   * Handles nonce contribution messages from participants.
   * @param {NonceContributionMessage} message The message containing the nonce contribution.
   * @returns {Promise<void>}
   */
  private async _handleNonceContribution(message: NonceContributionMessage): Promise<void> {
    // Cast message to NonceContributionMessage type.
    const nonceContribMessage = NonceContributionMessage.fromJSON(message);

    // Get the signing session using the cohort ID from the message.
    const signingSession = this.activeSigningSessions.get(nonceContribMessage.cohortId);

    // If the signing session does not exist, log an error and return.
    if(!signingSession) {
      Logger.error(`Session ${nonceContribMessage.sessionId} not found.`);
      return;
    }

    // If the message.cohortId does not match the signingSession.cohortId, throw an error.
    if(nonceContribMessage.cohortId !== signingSession.cohort.id) {
      throw new BeaconCoordinatorError(
        `Nonce contribution for wrong cohort: ${signingSession.cohort.id} != ${nonceContribMessage.cohortId}`,
        'NONCE_CONTRIBUTION_ERROR', message
      );
    }

    // Add the nonce contribution to the signing session.
    signingSession.addNonceContribution(nonceContribMessage.from, nonceContribMessage.nonceContribution);
    Logger.info(`Nonce contribution received from ${nonceContribMessage.from} for session ${nonceContribMessage.sessionId}.`);

    if (signingSession.status !== SIGNING_SESSION_STATUS.NONCE_CONTRIBUTIONS_RECEIVED) {
      await this.sendAggregatedNonce(signingSession);
    }
  }

  /**
   * Handles signature authorization messages from participants.
   * @param {Maybe<SignatureAuthorizationMessage>} message The message containing the signature authorization request.
   * @returns {Promise<void>}
   */
  private async _handleSignatureAuthorization(message: Maybe<SignatureAuthorizationMessage>): Promise<void> {
    const sigAuthMessage = SignatureAuthorizationMessage.fromJSON(message);
    const signingSession = this.activeSigningSessions.get(sigAuthMessage.cohortId);
    if (!signingSession) {
      Logger.error(`Session ${sigAuthMessage.sessionId} not found.`);
      return;
    }

    if(signingSession.id !== sigAuthMessage.sessionId) {
      throw new BeaconCoordinatorError(
        `Signature authorization for wrong session: ${signingSession.id} != ${sigAuthMessage.sessionId}`,
        'SIGNATURE_AUTHORIZATION_ERROR', message
      );
    }

    if(signingSession.status !== SIGNING_SESSION_STATUS.AWAITING_PARTIAL_SIGNATURES) {
      throw new BeaconCoordinatorError(
        `Partial signature received but not expected. Current status: ${signingSession.status}`,
        'SIGNATURE_AUTHORIZATION_ERROR', message
      );
    }

    // Add the signature authorization to the signing session.
    signingSession.addPartialSignature(sigAuthMessage.from, sigAuthMessage.partialSignature);
    Logger.info(`Received partial signature from ${sigAuthMessage.from} for session ${sigAuthMessage.sessionId}.`);

    if(signingSession.partialSignatures.size === signingSession.cohort.participants.length) {
      signingSession.status = SIGNING_SESSION_STATUS.PARTIAL_SIGNATURES_RECEIVED;
    }

    if (signingSession.status === SIGNING_SESSION_STATUS.PARTIAL_SIGNATURES_RECEIVED) {
      const signature = await signingSession.generateFinalSignature();
      Logger.info(`Final signature ${signature.toHex()} generated for session ${signingSession.id}`);
    }
  }

  /**
   * Accepts a subscription request from a participant.
   * @param {string} sender The DID of the participant requesting the subscription.
   * @returns {Promise<void>}
   */
  public async acceptSubscription(sender: string): Promise<void> {
    Logger.info(`Accepting subscription from ${sender}`);
    const response = {
      type : SUBSCRIBE_ACCEPT,
      to   : sender,
      from : this.did
    };
    await this.protocol.sendMessage(response, sender, this.did);
  }

  /**
   * Sends the aggregated nonce to all participants in the session.
   * @param {SignatureAuthorizationSession} session The session containing the aggregated nonce.
   * @returns {Promise<void>}
   */
  public async sendAggregatedNonce(session: SignatureAuthorizationSession): Promise<void> {
    const aggregatedNonce = session.generateAggregatedNonce();
    Logger.info(`Aggregated Nonces for session ${session.id}:`, aggregatedNonce);

    session.status = SIGNING_SESSION_STATUS.AWAITING_PARTIAL_SIGNATURES;
    for (const participant of session.cohort.participants) {
      const message = new AggregatedNonceMessage({
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
   * @param {string} [network='signet'] The network on which the cohort operates (default is 'signet').
   * @param {string} [beaconType='SMTAggregateBeacon'] The type of beacon to be used (default is 'SMTAggregateBeacon').
   * @returns {Promise<Musig2Cohort>} The newly created cohort.
   */
  public async announceNewCohort(
    minParticipants: number,
    network: string = 'signet',
    beaconType: string = 'SMTAggregateBeacon'
  ): Promise<Musig2Cohort> {
    const cohort = new Musig2Cohort({ minParticipants, network, beaconType });
    Logger.info(`Creating new cohort and announcing to ${this.subscribers.length} subscribers.`);
    this.cohorts.push(cohort);
    for (const subscriber of this.subscribers) {
      const message = new CohortAdvertMessage({
        to         : subscriber,
        from       : this.did,
        cohortId   : cohort.id,
        cohortSize : cohort.minParticipants,
        network    : network,
        beaconType : beaconType
      });
      Logger.info(`Sending ${COHORT_ADVERT} message to ${subscriber}`);
      await this.protocol.sendMessage(message, subscriber, this.did).catch(error => {
        Logger.error(`Error sending cohort announcement to ${subscriber}: ${error.message}`);
        const idx = this.subscribers.indexOf(subscriber);
        this.subscribers.splice(idx, idx);
      });
    }
    return cohort;
  }

  /**
   * Starts the key generation process for a cohort once it has enough participants.
   * @param {Musig2Cohort} cohort The cohort for which to start key generation.
   * @returns {Promise<void>}
   */
  private async _startKeyGeneration(cohort: Musig2Cohort): Promise<void> {
    Logger.info(`Starting key generation for cohort ${cohort.id} with participants: ${cohort.participants.join(', ')}`);
    cohort.finalize();
    for(const participant of cohort.participants) {
      const message = cohort.getCohortSetMessage(participant, this.did);
      Logger.info(`Sending COHORT_SET message to ${participant}`);
      await this.protocol.sendMessage(message, participant, this.did);
    }
    Logger.info(`Finished sending COHORT_SET message to ${cohort.participants.length} participants`);
  }

  /**
   * Starts a signing session for a given cohort.
   * @param {string} cohortId The ID of the cohort for which to start a signing session.
   * @returns {Promise<SignatureAuthorizationSession>} The started signing session.
   * @throws {BeaconCoordinatorError} If the cohort with the given ID is not found.
   */
  public async startSigningSession(cohortId: string): Promise<SignatureAuthorizationSession> {
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
      await this.protocol.sendMessage(msg, participant, this.did).catch(error => {
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
  public static initialize(service: Service): BeaconCoordinator {
    const communicationService = CommunicationFactory.establish(service);
    const coordinator = new BeaconCoordinator(communicationService);
    Logger.info(`BeaconCoordinator ${coordinator.name} initialized with DID ${coordinator.did}. Run .start() to listen for messages`);
    return coordinator;
  }
}
