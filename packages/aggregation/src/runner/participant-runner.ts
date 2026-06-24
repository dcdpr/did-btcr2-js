import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { BaseMessage } from '../messages/base.js';
import {
  AGGREGATED_NONCE,
  AUTHORIZATION_REQUEST,
  COHORT_ADVERT,
  COHORT_OPT_IN_ACCEPT,
  COHORT_READY,
  DISTRIBUTE_AGGREGATED_DATA,
  FALLBACK_AUTHORIZATION_REQUEST,
} from '../messages/constants.js';
import type {
  CohortAdvert,
  PendingSigningRequest,
  PendingValidation} from '../participant.js';
import {
  AggregationParticipant
} from '../participant.js';
import { ParticipantCohortPhase } from '../phases.js';
import { KeyPairAggregationSigner } from '../signer.js';
import type { Transport } from '../transport/transport.js';
import type { AggregationParticipantEvents, CohortCompleteInfo } from './events.js';
import { TypedEventEmitter } from './typed-emitter.js';

/** Decision callback: filter discovered cohorts. Default rejects all. */
export type ShouldJoin = (advert: CohortAdvert) => Promise<boolean>;

/** Data callback: provide a signed BTCR2 update for a joined cohort. */
export type OnProvideUpdate = (info: {
  cohortId: string;
  beaconAddress: string;
}) => Promise<SignedBTCR2Update | null>;

/** Decision callback: approve or reject aggregated data. */
export type OnValidateData = (info: PendingValidation) => Promise<{ approved: boolean }>;

/** Decision callback: approve or reject signing. */
export type OnApproveSigning = (info: PendingSigningRequest) => Promise<{ approved: boolean }>;

export interface AggregationParticipantRunnerOptions {
  /** Underlying transport. */
  transport: Transport;

  /** Participant identity. */
  did: string;
  keys: SchnorrKeyPair;

  /**
   * Filter discovered cohorts. Returns true to join, false to skip.
   * Default: rejects all cohorts (caller MUST override or no cohorts will be joined).
   */
  shouldJoin?: ShouldJoin;

  /**
   * Provide a signed BTCR2 update for the cohort.
   * REQUIRED - no sensible default.
   */
  onProvideUpdate: OnProvideUpdate;

  /**
   * Approve or reject aggregated data.
   * Default: approve if validation matches the submitted update's hash.
   */
  onValidateData?: OnValidateData;

  /**
   * Approve or reject the signing request.
   * Default: approve.
   */
  onApproveSigning?: OnApproveSigning;
}

/**
 * High-level facade for an Aggregation Participant.
 *
 * Long-running listener: waits for cohort adverts, applies the `shouldJoin`
 * filter, and drives each accepted cohort through the full protocol to
 * completion in parallel.
 *
 * @example
 * ```typescript
 * const transport = new NostrTransport({ relays: [RELAY] });
 * transport.registerActor(myDid, myKeys);
 *
 * const runner = new AggregationParticipantRunner({
 *   transport,
 *   did: myDid,
 *   keys: myKeys,
 *   shouldJoin: async (advert) => advert.beaconType === 'CASBeacon',
 *   onProvideUpdate: async ({ beaconAddress }) => {
 *     return Updater.sign(myDid, unsigned, vm, secretKey);
 *   },
 * });
 *
 * runner.on('cohort-complete', ({ beaconAddress }) => {
 *   console.log(`Add to DID document: bitcoin:${beaconAddress}`);
 * });
 *
 * await runner.start();
 * ```
 *
 * For full manual control, drop down to the underlying state machine via
 * `runner.session`. The state machine has no transport coupling and exposes
 * every protocol decision as an explicit method.
 *
 * @class AggregationParticipantRunner
 * @extends TypedEventEmitter<AggregationParticipantEvents>
 */
export class AggregationParticipantRunner extends TypedEventEmitter<AggregationParticipantEvents> {
  /** Direct access to the underlying state machine for advanced use. */
  readonly session: AggregationParticipant;

  readonly #transport: Transport;
  readonly #did: string;
  readonly #shouldJoin: ShouldJoin;
  readonly #onProvideUpdate: OnProvideUpdate;
  readonly #onValidateData: OnValidateData;
  readonly #onApproveSigning: OnApproveSigning;

  #handlersRegistered = false;
  #stopped = false;

  constructor(options: AggregationParticipantRunnerOptions) {
    super();
    this.#transport = options.transport;
    this.#did = options.did;
    this.#shouldJoin = options.shouldJoin ?? (async () => false);
    this.#onProvideUpdate = options.onProvideUpdate;
    this.#onValidateData = options.onValidateData ?? (async (info) => ({ approved: info.matches }));
    this.#onApproveSigning = options.onApproveSigning ?? (async () => ({ approved: true }));

    this.session = new AggregationParticipant({
      did    : options.did,
      signer : new KeyPairAggregationSigner(options.keys),
    });
  }

  /**
   * Start listening for cohorts. The runner stays active until {@link stop}
   * is called or the underlying transport disconnects.
   */
  async start(): Promise<void> {
    this.#registerHandlers();
  }

  /** Stop the runner and detach transport handlers. Safe to call repeatedly. */
  stop(): void {
    this.#stopped = true;
    this.#unregisterHandlers();
    // Deterministically wipe any secret nonce left on an abandoned signing
    // session. The signing key itself lives behind the AggregationSigner and is
    // never retained here.
    this.session.clearSecrets();
  }

  /** Message types this runner listens for on the transport. */
  static readonly #HANDLED_MESSAGE_TYPES: readonly string[] = [
    COHORT_ADVERT,
    COHORT_OPT_IN_ACCEPT,
    COHORT_READY,
    DISTRIBUTE_AGGREGATED_DATA,
    AUTHORIZATION_REQUEST,
    AGGREGATED_NONCE,
    FALLBACK_AUTHORIZATION_REQUEST,
  ];

  /** Internal: detach from the transport. Safe to call repeatedly. */
  #unregisterHandlers(): void {
    if(!this.#handlersRegistered) return;
    this.#handlersRegistered = false;
    for(const type of AggregationParticipantRunner.#HANDLED_MESSAGE_TYPES) {
      this.#transport.unregisterMessageHandler(this.#did, type);
    }
  }

  /**
   * Single-shot helper: start, join the first cohort that passes `shouldJoin`,
   * drive it to completion, and resolve. Convenient for tests and demos. The
   * single-cohort special case of {@link joinMatching} (count = 1).
   */
  static async joinFirst(
    options: AggregationParticipantRunnerOptions
  ): Promise<CohortCompleteInfo> {
    return new Promise((resolve, reject) => {
      const runner = new AggregationParticipantRunner(options);
      runner.once('cohort-complete', (info) => {
        runner.stop();
        resolve(info);
      });
      runner.on('error', reject);
      runner.start().catch(reject);
    });
  }

  /**
   * Multi-cohort helper: start, join EVERY cohort whose advert passes
   * `shouldJoin`, drive each to completion in parallel, and resolve once
   * `count` cohorts have completed (the runner stops at that point). The
   * N-cohort generalization of {@link joinFirst}, for a participant that joins
   * several cohorts advertised by one service.
   *
   * For an open-ended, long-lived subscriber (no fixed count), construct an
   * {@link AggregationParticipantRunner} directly, set `shouldJoin`, call
   * `start()`, and listen for `cohort-complete` - the runner already drives
   * any number of cohorts concurrently.
   *
   * @param options Participant runner options (set `shouldJoin` to select cohorts).
   * @param count Number of completed cohorts to collect before resolving.
   * @returns The {@link CohortCompleteInfo} for each completed cohort, in completion order.
   */
  static async joinMatching(
    options: AggregationParticipantRunnerOptions,
    count: number,
  ): Promise<CohortCompleteInfo[]> {
    return new Promise((resolve, reject) => {
      const runner = new AggregationParticipantRunner(options);
      const completed: CohortCompleteInfo[] = [];
      runner.on('cohort-complete', (info) => {
        completed.push(info);
        if(completed.length >= count) {
          runner.stop();
          resolve(completed);
        }
      });
      runner.on('error', reject);
      runner.start().catch(reject);
    });
  }

  /**
   * Internal: handler registration with the transport. Idempotent and safe to call multiple times,
   * but only registers handlers once.
   */
  #registerHandlers(): void {
    if (this.#handlersRegistered) return;
    this.#handlersRegistered = true;

    this.#transport.registerMessageHandler(this.#did, COHORT_ADVERT, this.#handleAdvert.bind(this));
    this.#transport.registerMessageHandler(this.#did, COHORT_OPT_IN_ACCEPT, this.#handleOptInAccept.bind(this));
    this.#transport.registerMessageHandler(this.#did, COHORT_READY, this.#handleCohortReady.bind(this));
    this.#transport.registerMessageHandler(this.#did, DISTRIBUTE_AGGREGATED_DATA, this.#handleDistributeData.bind(this));
    this.#transport.registerMessageHandler(this.#did, AUTHORIZATION_REQUEST, this.#handleAuthorizationRequest.bind(this));
    this.#transport.registerMessageHandler(this.#did, AGGREGATED_NONCE, this.#handleAggregatedNonce.bind(this));
    this.#transport.registerMessageHandler(this.#did, FALLBACK_AUTHORIZATION_REQUEST, this.#handleFallbackAuthorizationRequest.bind(this));
  }

  /**
   * Internal: handler for cohort adverts. Applies the `shouldJoin` filter and joins if approved.
   * @param {BaseMessage} msg - The received cohort advert message.
   * @returns {Promise<void>} Resolves when processing is complete.
   */
  async #handleAdvert(msg: BaseMessage): Promise<void> {
    if (this.#stopped) return;
    try {
      this.session.receive(msg);

      const advert = this.session.discoveredCohorts.get(msg.body?.cohortId ?? '');
      if (!advert) return;
      this.emit('cohort-discovered', advert);

      // Register the service's communication key for encrypted message routing
      if (advert.serviceCommunicationPk) {
        this.#transport.registerPeer(advert.serviceDid, advert.serviceCommunicationPk);
      }

      const join = await this.#shouldJoin(advert);
      if (!join) return;

      await this.#sendAll(this.session.joinCohort(advert.cohortId));
      this.emit('cohort-joined', { cohortId: advert.cohortId });
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  /**
   * Internal: handler for opt-in accept messages. Updates the session state accordingly.
   * @param {BaseMessage} msg - The received opt-in accept message.
   */
  #handleOptInAccept(msg: BaseMessage): void {
    if (this.#stopped) return;
    try {
      this.session.receive(msg);
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  /**
   * Internal: handler for cohort ready messages. Updates the session state, emits a 'cohort-ready'
   * event, and triggers the update submission flow via the `onProvideUpdate` callback.
   * @param {BaseMessage} msg - The received cohort ready message.
   * @returns {Promise<void>} Resolves when processing is complete.
    */
  async #handleCohortReady(msg: BaseMessage): Promise<void> {
    if (this.#stopped) return;
    try {
      this.session.receive(msg);

      const cohortId = msg.body?.cohortId;
      if (!cohortId) return;

      const info = this.session.joinedCohorts.get(cohortId);
      if (!info) return;
      this.emit('cohort-ready', { cohortId, beaconAddress: info.beaconAddress });

      // Construct the signed update via caller callback and submit. A null return
      // means the member has no update this round: it declines (cooperative
      // non-inclusion) but stays in the cohort and still signs.
      const signedUpdate = await this.#onProvideUpdate({
        cohortId,
        beaconAddress : info.beaconAddress,
      });
      if(signedUpdate === null) {
        await this.#sendAll(this.session.declineUpdate(cohortId));
        this.emit('update-declined', { cohortId });
      } else {
        await this.#sendAll(this.session.submitUpdate(cohortId, signedUpdate));
        this.emit('update-submitted', { cohortId });
      }
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  /**
   * Internal: handler for distribute aggregated data messages. Updates the session state, emits a
   * 'validation-requested' event, and triggers the validation decision flow via the `onValidateData`
   * callback. Depending on the decision, sends an approval or rejection message.
   * @param {BaseMessage} msg - The received distribute aggregated data message.
   * @returns {Promise<void>} Resolves when processing is complete.
   * @throws {Error} If an error occurs during message processing or callback execution.
   */
  async #handleDistributeData(msg: BaseMessage): Promise<void> {
    if (this.#stopped) return;
    try {
      this.session.receive(msg);

      const cohortId = msg.body?.cohortId;
      if (!cohortId) return;

      const validation = this.session.pendingValidations.get(cohortId);
      if (!validation) return;
      this.emit('validation-requested', validation);

      const decision = await this.#onValidateData(validation);
      if (decision.approved) {
        await this.#sendAll(this.session.approveValidation(cohortId));
      } else {
        await this.#sendAll(this.session.rejectValidation(cohortId));
        this.emit('cohort-failed', { cohortId, reason: 'Validation rejected by participant' });
      }
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  /**
   * Internal: handler for authorization request messages. Updates the session state, emits a
   * 'signing-requested' event, and triggers the signing approval flow via the `onApproveSigning`
   * callback. Depending on the decision, sends a nonce approval message or emits a 'cohort-failed'
   * event.
   * @param {BaseMessage} msg - The received authorization request message.
   * @returns {Promise<void>} Resolves when processing is complete.
   * @throws {Error} If an error occurs during message processing or callback execution.
   */
  async #handleAuthorizationRequest(msg: BaseMessage): Promise<void> {
    if (this.#stopped) return;
    try {
      this.session.receive(msg);

      const cohortId = msg.body?.cohortId;
      if (!cohortId) return;

      const req = this.session.pendingSigningRequests.get(cohortId);
      if (!req) return;
      this.emit('signing-requested', req);

      const decision = await this.#onApproveSigning(req);
      if (!decision.approved) {
        this.emit('cohort-failed', { cohortId, reason: 'Signing rejected by participant' });
        return;
      }

      await this.#sendAll(this.session.approveNonce(cohortId));
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  /**
   * Internal: handler for aggregated nonce messages. Updates the session state, triggers partial
   * signature generation, and sends the partial signature to the aggregator. If the cohort reaches
   * completion after processing the nonce, emits a 'cohort-complete' event.
   * @param {BaseMessage} msg - The received aggregated nonce message.
   * @returns {Promise<void>} Resolves when processing is complete.
   * @throws {Error} If an error occurs during message processing or partial signature generation.
   */
  async #handleAggregatedNonce(msg: BaseMessage): Promise<void> {
    if (this.#stopped) return;
    try {
      this.session.receive(msg);

      const cohortId = msg.body?.cohortId;
      if (!cohortId) return;

      await this.#sendAll(this.session.generatePartialSignature(cohortId));

      // Check if we've reached completion
      this.#emitCohortCompleteIfDone(cohortId);
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  /**
   * Internal: handler for fallback authorization requests. The service abandoned
   * the optimistic key path; the member authorizes the k-of-n script-path spend
   * of the same beacon transaction (ADR 042). Reuses `onApproveSigning` to gate
   * the decision, signs the fallback, and completes once it has contributed (the
   * service needs only k members).
   * @param {BaseMessage} msg - The received fallback authorization request message.
   * @returns {Promise<void>} Resolves when processing is complete.
   */
  async #handleFallbackAuthorizationRequest(msg: BaseMessage): Promise<void> {
    if (this.#stopped) return;
    try {
      this.session.receive(msg);

      const cohortId = msg.body?.cohortId;
      if (!cohortId) return;

      const req = this.session.pendingFallbackRequests.get(cohortId);
      if (!req) return;
      this.emit('fallback-requested', req);

      const decision = await this.#onApproveSigning(req);
      if (!decision.approved) {
        this.emit('cohort-failed', { cohortId, reason: 'Fallback signing rejected by participant' });
        return;
      }

      await this.#sendAll(this.session.approveFallback(cohortId));
      // The member has contributed its fallback signature and is done from its
      // own perspective, regardless of whether the service has yet collected k.
      this.#emitCohortCompleteIfDone(cohortId);
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  /**
   * Internal: emit `cohort-complete` with the participant's retained sidecar once
   * the cohort has reached the Complete phase. Surfaces the CAS Announcement map
   * (CAS beacons) or the SMT proof (SMT beacons) the participant keeps for future
   * DID resolution. Read via getValidation (not pendingValidations, which lists
   * only the AwaitingValidation phase) so the sidecar is still available at
   * Complete. Shared by the optimistic and fallback completion paths.
   */
  #emitCohortCompleteIfDone(cohortId: string): void {
    if (this.session.getCohortPhase(cohortId) !== ParticipantCohortPhase.Complete) return;
    const info = this.session.joinedCohorts.get(cohortId);
    if (!info) return;
    const validation = this.session.getValidation(cohortId);
    this.emit('cohort-complete', {
      cohortId,
      beaconAddress   : info.beaconAddress,
      beaconType      : validation?.beaconType ?? '',
      included        : validation?.included ?? true,
      casAnnouncement : validation?.casAnnouncement,
      smtProof        : validation?.smtProof,
    });
  }

  /**
   * Internal: send helper to ensure messages are sent sequentially. This is important for protocol
   * correctness, as some transports may not guarantee message order if sent in parallel.
   * @param {BaseMessage[]} msgs - The messages to send.
   * @returns {Promise<void>} Resolves when all messages have been sent.
   * @throws {Error} If an error occurs during message sending.
   */
  async #sendAll(msgs: BaseMessage[]): Promise<void> {
    for (const m of msgs) {
      await this.#transport.sendMessage(m, this.#did, m.to);
    }
  }
}
