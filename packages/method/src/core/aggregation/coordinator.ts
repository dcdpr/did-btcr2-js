import { BitcoinConnection } from '@did-btcr2/bitcoin';
import { Maybe } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { RawSchnorrKeyPair } from '@did-btcr2/keypair';
import { address as btcAddress, opcodes, script, Transaction } from 'bitcoinjs-lib';
import { BeaconCoordinatorError } from '../beacon/error.js';
import { AggregateBeaconCohort } from './cohort/index.js';
import { COHORT_STATUS } from './cohort/status.js';
import {
  BEACON_COHORT_ADVERT,
  BEACON_COHORT_NONCE_CONTRIBUTION,
  BEACON_COHORT_OPT_IN,
  BEACON_COHORT_REQUEST_SIGNATURE,
  BEACON_COHORT_SIGNATURE_AUTHORIZATION,
  BEACON_COHORT_SUBMIT_UPDATE,
  BEACON_COHORT_VALIDATION_ACK
} from './cohort/messages/constants.js';
import { BeaconCohortAdvertMessage } from './cohort/messages/keygen/cohort-advert.js';
import { BeaconCohortReadyMessage } from './cohort/messages/keygen/cohort-ready.js';
import { BeaconCohortOptInAcceptMessage } from './cohort/messages/keygen/opt-in-accept.js';
import { BeaconCohortOptInMessage, CohortOptInMessage } from './cohort/messages/keygen/opt-in.js';
import { BeaconCohortAggregatedNonceMessage } from './cohort/messages/sign/aggregated-nonce.js';
import { BeaconCohortNonceContributionMessage, CohortNonceContributionMessage } from './cohort/messages/sign/nonce-contribution.js';
import { BeaconCohortRequestSignatureMessage, CohortRequestSignatureMessage } from './cohort/messages/sign/request-signature.js';
import { BeaconCohortSignatureAuthorizationMessage, CohortSignatureAuthorizationMessage } from './cohort/messages/sign/signature-authorization.js';
import { BeaconCohortDistributeDataMessage } from './cohort/messages/update/distribute-data.js';
import { BeaconCohortSubmitUpdateMessage, CohortSubmitUpdateMessage } from './cohort/messages/update/submit-update.js';
import { BeaconCohortValidationAckMessage, CohortValidationAckMessage } from './cohort/messages/update/validation-ack.js';
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
    console.info(`Setting up BeaconCoordinator ${this.name} (${this.did}) on ${this.protocol.name} ...`);
    this.protocol.registerMessageHandler(BEACON_COHORT_OPT_IN, this.#handleOptIn.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_SUBMIT_UPDATE, this.#handleSubmitUpdate.bind(this));
    this.protocol.registerMessageHandler(BEACON_COHORT_VALIDATION_ACK, this.#handleValidationAck.bind(this));
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
      console.warn(`Invalid opt-in message from ${participant}: missing cohortId, participant or participantPk`);
      return;
    }
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (cohort && !cohort.participants.includes(participant)) {
      cohort.participants.push(participant);
      cohort.cohortKeys.push(participantPk);
      await this.acceptSubscription(participant);
      // If the cohort has enough participants, start the key generation process.
      if (cohort.participants.length >= cohort.minParticipants) {
        await this.#startKeyGeneration(cohort);
      }
    }
  }

  /**
   * Handles update submission messages from participants during the Announce Updates phase.
   * Validates the message, finds the cohort, and delegates to cohort.addUpdate().
   * @param {CohortSubmitUpdateMessage} message The message containing the signed update.
   * @returns {Promise<void>}
   */
  async #handleSubmitUpdate(message: Maybe<CohortSubmitUpdateMessage>): Promise<void> {
    const submitMessage = BeaconCohortSubmitUpdateMessage.fromJSON(message);
    const cohortId = submitMessage.body?.cohortId;
    if(!cohortId) {
      console.warn(`Submit update message missing cohort ID from ${submitMessage.from}`);
      return;
    }
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if(!cohort) {
      console.error(`Cohort with ID ${cohortId} not found.`);
      return;
    }
    const signedUpdate = submitMessage.body?.signedUpdate;
    if(!signedUpdate) {
      console.warn(`Submit update message missing signed update from ${submitMessage.from}`);
      return;
    }
    cohort.addUpdate(submitMessage.from, signedUpdate as unknown as SignedBTCR2Update);
    console.info(`Update received from ${submitMessage.from} for cohort ${cohortId}. Collected ${cohort.pendingUpdates.size}/${cohort.participants.length} updates.`);
  }

  /**
   * Handles validation acknowledgment messages from participants.
   * @private
   * @param {CohortValidationAckMessage} message The message containing the validation ack.
   * @returns {Promise<void>}
   */
  async #handleValidationAck(message: Maybe<CohortValidationAckMessage>): Promise<void> {
    const ackMessage = BeaconCohortValidationAckMessage.fromJSON(message);
    const cohortId = ackMessage.body?.cohortId;
    if(!cohortId) {
      console.warn(`Validation ack message missing cohort ID from ${ackMessage.from}`);
      return;
    }
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if(!cohort) {
      console.error(`Cohort with ID ${cohortId} not found.`);
      return;
    }
    const approved = ackMessage.body?.approved;
    if(approved === undefined) {
      console.warn(`Validation ack message missing approved field from ${ackMessage.from}`);
      return;
    }
    cohort.addValidation(ackMessage.from, approved);
    console.info(`Validation ack from ${ackMessage.from} for cohort ${cohortId}: ${approved ? 'approved' : 'rejected'}. ${cohort.validationAcks.size}/${cohort.participants.length} validations received.`);
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
      console.warn(`Signature request missing cohort ID from ${signatureRequest.from}`);
      return;
    }
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohort) {
      console.error(`Cohort with ID ${cohortId} not found.`);
      return;
    }
    cohort.addSignatureRequest(signatureRequest);
    console.info(`Received signature request from ${signatureRequest.from} for cohort ${cohortId}.`);
  }

  /**
   * Handles nonce contribution messages from participants.
   * @private
   * @param {CohortNonceContributionMessage} message The message containing the nonce contribution.
   * @returns {Promise<void>}
   */
  async #handleNonceContribution(message: CohortNonceContributionMessage): Promise<void> {
    // Cast message to NonceContributionMessage type.
    const nonceContribMessage = BeaconCohortNonceContributionMessage.fromJSON(message);
    const cohortId = nonceContribMessage.body?.cohortId;
    if (!cohortId) {
      console.warn(`Nonce contribution message missing cohort ID from ${nonceContribMessage.from}`);
      return;
    }
    const sessionId = nonceContribMessage.body?.sessionId;
    if (!sessionId) {
      console.warn(`Nonce contribution message missing session ID from ${nonceContribMessage.from}`);
      return;
    }
    // Get the signing session using the cohort ID from the message.
    const signingSession = this.activeSigningSessions.get(cohortId || sessionId);

    // If the signing session does not exist, log an error and return.
    if(!signingSession) {
      console.error(`Session ${cohortId || sessionId} not found.`);
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
      console.warn(`Nonce contribution message missing nonce contribution from ${nonceContribMessage.from}`);
      return;
    }
    // Add the nonce contribution to the signing session.
    signingSession.addNonceContribution(nonceContribMessage.from, nonceContribution);
    console.info(`Nonce contribution received from ${nonceContribMessage.from} for session ${sessionId}.`);

    if (signingSession.status !== SIGNING_SESSION_STATUS.NONCE_CONTRIBUTIONS_RECEIVED) {
      await this.sendAggregatedNonce(signingSession);
    }
  }

  /**
   * Handles signature authorization messages from participants.
   * @private
   * @param {Maybe<CohortSignatureAuthorizationMessage>} message The message containing the signature authorization request.
   * @returns {Promise<void>}
   */
  async #handleSignatureAuthorization(message: Maybe<CohortSignatureAuthorizationMessage>): Promise<void> {
    const sigAuthMessage = BeaconCohortSignatureAuthorizationMessage.fromJSON(message);
    const cohortId = sigAuthMessage.body?.cohortId;
    if (!cohortId) {
      console.warn(`Signature authorization message missing cohort ID from ${sigAuthMessage.from}`);
      return;
    }
    const sessionId = sigAuthMessage.body?.sessionId;
    if (!sessionId) {
      console.warn(`Signature authorization message missing session ID from ${sigAuthMessage.from}`);
      return;
    }
    const signingSession = this.activeSigningSessions.get(cohortId || sessionId);
    if (!signingSession) {
      console.error(`Session ${sessionId} not found.`);
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
      console.warn(`Signature authorization message missing partial signature from ${sigAuthMessage.from}`);
      return;
    }
    // Add the signature authorization to the signing session.
    signingSession.addPartialSignature(sigAuthMessage.from, partialSignature);
    console.info(`Received partial signature from ${sigAuthMessage.from} for session ${sessionId}.`);

    if(signingSession.partialSignatures.size === signingSession.cohort.participants.length) {
      signingSession.status = SIGNING_SESSION_STATUS.PARTIAL_SIGNATURES_RECEIVED;
    }

    if (signingSession.status === SIGNING_SESSION_STATUS.PARTIAL_SIGNATURES_RECEIVED) {
      const signature = await signingSession.generateFinalSignature();
      console.info(`Final signature ${Buffer.from(signature).toString('hex')} generated for session ${signingSession.id}`);
    }
  }

  /**
   * Starts the key generation process for a cohort once it has enough participants.
   * @private
   * @param {Musig2Cohort} cohort The cohort for which to start key generation.
   * @returns {Promise<void>}
   */
  async #startKeyGeneration(cohort: AggregateBeaconCohort): Promise<void> {
    console.info(`Starting key generation for cohort ${cohort.id} with participants: ${cohort.participants.join(', ')}`);
    cohort.finalize();
    for(const participant of cohort.participants) {
      const message = cohort.getCohortReadyMessage(participant, this.did);
      console.info(`Sending BEACON_COHORT_READY message to ${participant}`);
      await this.protocol.sendMessage(message, participant, this.did);
    }
    console.info(`Finished sending BEACON_COHORT_READY message to ${cohort.participants.length} participants`);
  }

  /**
   * Builds the aggregated data structure for a cohort once all updates are collected.
   * Dispatches to the appropriate builder based on the cohort's beaconType:
   * - CASBeacon: builds a CAS Announcement (DID → updateHash map)
   * - SMTBeacon: builds a BTCR2MerkleTree with per-participant proofs
   *
   * @param {string} cohortId The ID of the cohort to build aggregated data for.
   * @returns {void}
   * @throws {BeaconCoordinatorError} If the cohort is not found or the beacon type is unsupported.
   */
  buildAggregatedData(cohortId: string): void {
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if(!cohort) {
      throw new BeaconCoordinatorError(
        `Cohort with ID ${cohortId} not found.`,
        'COHORT_NOT_FOUND', { cohortId }
      );
    }
    switch(cohort.beaconType) {
      case 'CASBeacon': {
        const announcement = cohort.buildCASAnnouncement();
        console.info(`CAS Announcement built for cohort ${cohortId}: ${Object.keys(announcement).length} DID entries.`);
        break;
      }
      case 'SMTBeacon': {
        const proofs = cohort.buildSMTTree();
        console.info(`SMT tree built for cohort ${cohortId}: ${proofs.size} proofs generated.`);
        break;
      }
      default:
        throw new BeaconCoordinatorError(
          `Unsupported beacon type: ${cohort.beaconType}`,
          'UNSUPPORTED_BEACON_TYPE', { cohortId, beaconType: cohort.beaconType }
        );
    }
  }

  /**
   * Distributes the aggregated data to all participants for validation.
   * For CAS beacons, sends the full CAS Announcement to each participant.
   * For SMT beacons, sends each participant's individual SMT proof.
   * Transitions the cohort to AWAITING_VALIDATION status.
   *
   * @param {string} cohortId The ID of the cohort to distribute data for.
   * @returns {Promise<void>}
   * @throws {BeaconCoordinatorError} If the cohort is not found or not in DATA_AGGREGATED state.
   */
  async distributeAggregatedData(cohortId: string): Promise<void> {
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if(!cohort) {
      throw new BeaconCoordinatorError(
        `Cohort with ID ${cohortId} not found.`,
        'COHORT_NOT_FOUND', { cohortId }
      );
    }
    if(!cohort.signalBytes) {
      throw new BeaconCoordinatorError(
        `Cohort ${cohortId} has no signal bytes. Call buildAggregatedData() first.`,
        'DISTRIBUTION_ERROR', { cohortId }
      );
    }

    const signalBytesHex = Buffer.from(cohort.signalBytes).toString('hex');

    for(const participant of cohort.participants) {
      const message = new BeaconCohortDistributeDataMessage({
        to              : participant,
        from            : this.did,
        cohortId,
        beaconType      : cohort.beaconType,
        signalBytesHex,
        casAnnouncement : cohort.beaconType === 'CASBeacon' ? cohort.casAnnouncement : undefined,
        smtProof        : cohort.beaconType === 'SMTBeacon' ? cohort.smtProofs?.get(participant) as unknown as Record<string, unknown> : undefined,
      });
      await this.protocol.sendMessage(message, this.did, participant);
      console.info(`Distributed aggregated data to ${participant} for cohort ${cohortId}`);
    }

    cohort.status = COHORT_STATUS.AWAITING_VALIDATION;
    console.info(`Aggregated data distributed to ${cohort.participants.length} participants for cohort ${cohortId}. Awaiting validation.`);
  }

  /**
   * Builds an unsigned Bitcoin transaction for the beacon cohort.
   * The transaction spends the beacon UTXO and commits signal bytes via OP_RETURN.
   *
   * Structure:
   * - Input 0: beacon Taproot UTXO
   * - Output 0: change back to beacon address (value minus fee)
   * - Output 1: OP_RETURN with signal bytes (CAS announcement hash or SMT root)
   *
   * @param {string} cohortId The ID of the cohort to build the transaction for.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection for UTXO lookup.
   * @returns {Promise<Transaction>} The unsigned transaction ready for MuSig2 signing.
   * @throws {BeaconCoordinatorError} If the cohort is not found, has no signal bytes, or has no funded UTXO.
   */
  async buildBeaconTransaction(cohortId: string, bitcoin: BitcoinConnection): Promise<Transaction> {
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if(!cohort) {
      throw new BeaconCoordinatorError(
        `Cohort with ID ${cohortId} not found.`,
        'COHORT_NOT_FOUND', { cohortId }
      );
    }
    if(!cohort.signalBytes) {
      throw new BeaconCoordinatorError(
        `Cohort ${cohortId} has no signal bytes. Call buildAggregatedData() first.`,
        'TRANSACTION_BUILD_ERROR', { cohortId }
      );
    }
    if(!cohort.beaconAddress) {
      throw new BeaconCoordinatorError(
        `Cohort ${cohortId} has no beacon address.`,
        'TRANSACTION_BUILD_ERROR', { cohortId }
      );
    }

    // Fetch UTXOs for the beacon Taproot address
    const utxos = await bitcoin.rest.address.getUtxos(cohort.beaconAddress);
    if(!utxos.length) {
      throw new BeaconCoordinatorError(
        'No UTXOs found for beacon address. Please fund address!',
        'UNFUNDED_BEACON_ADDRESS', { bitcoinAddress: cohort.beaconAddress }
      );
    }

    // Select the most recent confirmed UTXO
    const utxo = utxos.sort(
      (a, b) => b.status.block_height - a.status.block_height
    ).shift()!;

    // Build the unsigned transaction
    const tx = new Transaction();
    tx.version = 2;

    // Input: beacon UTXO (txid reversed for bitcoinjs-lib internal byte order)
    tx.addInput(Buffer.from(utxo.txid, 'hex').reverse(), utxo.vout);

    // Output 0: change back to beacon Taproot address
    // TODO: calculate fee based on transaction vsize and current fee rates
    const changeScript = btcAddress.toOutputScript(cohort.beaconAddress, bitcoin.data);
    tx.addOutput(changeScript, BigInt(utxo.value) - 500n);

    // Output 1: OP_RETURN with signal bytes
    const opReturnScript = script.compile([opcodes.OP_RETURN, Buffer.from(cohort.signalBytes)]);
    tx.addOutput(opReturnScript, 0n);

    console.info(`Built beacon transaction for cohort ${cohortId}: input ${utxo.txid}:${utxo.vout}, change ${utxo.value - 500} sats`);
    return tx;
  }

  /**
   * Broadcasts the signed beacon transaction to the Bitcoin network.
   * Called after the MuSig2 signing session produces a final aggregated signature.
   * Sets the Taproot key-path witness on the input and broadcasts.
   *
   * @param {string} cohortId The ID of the cohort whose transaction to broadcast.
   * @param {BitcoinConnection} bitcoin The Bitcoin network connection for broadcasting.
   * @returns {Promise<string>} The txid of the broadcast transaction.
   * @throws {BeaconCoordinatorError} If no signing session exists or signature is missing.
   */
  async broadcastSignedTransaction(cohortId: string, bitcoin: BitcoinConnection): Promise<string> {
    const session = this.activeSigningSessions.get(cohortId);
    if(!session) {
      throw new BeaconCoordinatorError(
        `No active signing session for cohort ${cohortId}.`,
        'BROADCAST_ERROR', { cohortId }
      );
    }
    if(!session.signature) {
      throw new BeaconCoordinatorError(
        `Signing session for cohort ${cohortId} has no final signature.`,
        'BROADCAST_ERROR', { cohortId }
      );
    }

    // Set the Taproot key-path witness: [schnorrSignature]
    session.pendingTx.setWitness(0, [Buffer.from(session.signature)]);

    // Serialize and broadcast
    const signedTxHex = session.pendingTx.toHex();
    const txid = await bitcoin.rest.transaction.send(signedTxHex);

    console.info(`Beacon transaction broadcast for cohort ${cohortId} with txid: ${txid}`);
    return txid;
  }

  /**
   * Accepts a subscription request from a participant.
   * @param {string} participant The DID of the participant requesting the subscription.
   * @returns {Promise<void>}
   */
  async acceptSubscription(participant: string): Promise<void> {
    console.info(`Accepting subscription from ${participant}`);
    const message = new BeaconCohortOptInAcceptMessage({ to: participant, from: this.did });
    await this.protocol.sendMessage(message, this.did, participant);
  }

  /**
   * Sends the aggregated nonce to all participants in the session.
   * @param {BeaconCohortSigningSession} session The session containing the aggregated nonce.
   * @returns {Promise<void>}
   */
  async sendAggregatedNonce(session: BeaconCohortSigningSession): Promise<void> {
    const aggregatedNonce = session.generateAggregatedNonce();
    console.info(`Aggregated Nonces for session ${session.id}:`, aggregatedNonce);

    session.status = SIGNING_SESSION_STATUS.AWAITING_PARTIAL_SIGNATURES;
    for (const participant of session.cohort.participants) {
      const message = new BeaconCohortAggregatedNonceMessage({
        to              : participant,
        from            : this.did,
        cohortId        : session.cohort.id,
        sessionId       : session.id,
        aggregatedNonce : aggregatedNonce
      });
      console.info(`Sending AGGREGATED_NONCE message to ${participant}`);
      await this.protocol.sendMessage(message, participant, this.did);
    }
    console.info(`Successfully sent aggregated nonce message to all participants in session ${session.id}.`);
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
    console.info(`Advertising new cohort ${cohort.id} ...`);
    this.cohorts.push(cohort);
    const message = new BeaconCohortAdvertMessage({
      from       : this.did,
      cohortId   : cohort.id,
      cohortSize : cohort.minParticipants,
      network    : cohort.network,
      beaconType
    });
    console.info(`Sending ${BEACON_COHORT_ADVERT} message to network ...`, message);
    await this.protocol.sendMessage(message, this.did);
    console.info(`Cohort ${cohort.id} advertised successfully.`);
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
      console.error(`Cohort with ID ${cohortId} not found.`);
      throw new BeaconCoordinatorError(
        `Cohort with ID ${cohortId} not found.`,
        'COHORT_NOT_FOUND', { cohortId }
      );
    }
    console.info(`Announcing cohort ${cohort.id} to ${cohort.participants.length} subscribers...`);
    this.cohorts.push(cohort);
    for (const participant of cohort.participants) {
      const message = new BeaconCohortReadyMessage({
        to            : participant,
        from          : this.did,
        cohortId      : cohort.id,
        beaconAddress : cohort.beaconAddress,
        cohortKeys    : cohort.cohortKeys,
      });
      console.info(`Sending ${BEACON_COHORT_ADVERT} message to ${participant}`);

      await this.protocol.sendMessage(message, this.did, participant);
    }
    return cohort;
  }

  /**
   * Starts a signing session for a given cohort.
   * If a BitcoinConnection is provided, builds the real beacon transaction first
   * (spending the beacon UTXO with an OP_RETURN containing signal bytes).
   * Otherwise, uses an empty transaction (for testing or external TX construction).
   *
   * @param {string} cohortId The ID of the cohort for which to start a signing session.
   * @param {BitcoinConnection} [bitcoin] Optional Bitcoin connection for building the beacon transaction.
   * @returns {Promise<BeaconCohortSigningSession>} The started signing session.
   * @throws {BeaconCoordinatorError} If the cohort with the given ID is not found.
   */
  async startSigningSession(cohortId: string, bitcoin?: BitcoinConnection): Promise<BeaconCohortSigningSession> {
    console.info(`Attempting to start signing session for cohort ${cohortId}`);
    const cohort = this.cohorts.find(c => c.id === cohortId);
    if (!cohort) {
      console.error(`Cohort with ID ${cohortId} not found.`);
      throw new BeaconCoordinatorError(`Cohort with ID ${cohortId} not found.`, 'COHORT_NOT_FOUND');
    }

    // Build the real beacon transaction if a Bitcoin connection is available
    let pendingTx: Transaction | undefined;
    if(bitcoin) {
      pendingTx = await this.buildBeaconTransaction(cohortId, bitcoin);
    }

    console.info(`Cohort ${cohortId} found. Starting signing session.`);
    const signingSession = cohort.startSigningSession(pendingTx);
    console.info(`Starting signing session ${signingSession.id} for cohort ${cohortId}`);
    for (const participant of cohort.participants) {
      const msg = signingSession.getAuthorizationRequest(participant, this.did);
      console.info(`Sending authorization request to ${participant}`);
      await this.protocol.sendMessage(msg, this.did, participant).catch(error => {
        console.error(`Error sending authorization request to ${participant}: ${error.message}`);
      });
    }
    this.activeSigningSessions.set(cohortId, signingSession);
    console.info(`Signing session ${signingSession.id} started for cohort ${cohortId}`);
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
    console.info(`BeaconCoordinator ${coordinator.name} initialized with DID ${coordinator.did}. Run .start() to listen for messages`);
    return coordinator;
  }
}