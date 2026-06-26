import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { AggregationServiceError } from '../core/errors.js';
import type { BaseMessage } from '../core/messages/base.js';
import {
  COHORT_OPT_IN,
  FALLBACK_SIGNATURE,
  NONCE_CONTRIBUTION,
  SIGNATURE_AUTHORIZATION,
  SUBMIT_NONINCLUDED,
  SUBMIT_UPDATE,
  VALIDATION_ACK,
} from '../core/messages/constants.js';
import { ServiceCohortPhase } from '../core/phases.js';
import type { ServiceCohortPhaseType } from '../core/phases.js';
import type {
  AggregationResult,
  CohortConfig,
  PendingOptIn,
  SigningTxData} from './service.js';
import {
  AggregationService
} from './service.js';
import type { Transport } from '../core/transport/transport.js';
import { StaticFeeEstimator } from '@did-btcr2/bitcoin';
import type { FeeEstimator } from '@did-btcr2/bitcoin';
import type { AggregationServiceEvents } from './events.js';
import { TypedEventEmitter } from '../core/typed-emitter.js';

/** Default fee estimator the runner uses when a caller supplies none: a static 5 sat/vB rate. */
const DEFAULT_FEE_ESTIMATOR: FeeEstimator = new StaticFeeEstimator(5);

/** Decision callback: accept or reject a participant's opt-in. */
export type OnOptInReceived = (optIn: PendingOptIn) => Promise<{ accepted: boolean }>;

/** Decision callback: finalize keygen now, or wait for more participants. */
export type OnReadyToFinalize = (info: {
  acceptedCount: number;
  minRequired: number;
}) => Promise<{ finalize: boolean }>;

/** Data callback: provide the Bitcoin transaction data to sign. */
export type OnProvideTxData = (info: {
  cohortId: string;
  beaconAddress: string;
  signalBytes: Uint8Array;
  /**
   * Fee estimator the runner is configured with (the runner's `feeEstimator`
   * option, or a static 5 sat/vB default). Forward it to the beacon transaction
   * builder so a dynamic rate injected at the runner is honored, rather than
   * hard-coding a rate inside this callback (ADR 045).
   */
  feeEstimator: FeeEstimator;
}) => Promise<SigningTxData>;

export interface AggregationServiceRunnerOptions {
  /** Underlying transport (NostrTransport, MockTransport, etc.). */
  transport: Transport;

  /** This service's identity. */
  did: string;
  keys: SchnorrKeyPair;

  /**
   * Default cohort configuration for the {@link AggregationServiceRunner.run}
   * convenience path. Optional: omit it when driving the runner with
   * {@link AggregationServiceRunner.advertiseCohort}, which takes a per-cohort
   * config and can be called many times on one runner.
   */
  config?: CohortConfig;

  /**
   * Decide whether to accept a participant's opt-in.
   * Default: auto-accept all opt-ins.
   */
  onOptInReceived?: OnOptInReceived;

  /**
   * Decide whether to finalize keygen now or wait for more participants.
   * Called after each accepted opt-in once minParticipants is reached.
   * Default: finalize as soon as minParticipants is reached.
   */
  onReadyToFinalize?: OnReadyToFinalize;

  /**
   * Provide the Bitcoin transaction data to sign.
   * REQUIRED - no sensible default.
   */
  onProvideTxData: OnProvideTxData;

  /**
   * Fee estimator passed to {@link OnProvideTxData} so the beacon transaction the
   * callback builds is sized at a chosen rate. Inject a dynamic estimator (a mempool
   * API or Bitcoin Core `estimatesmartfee`) here as the single standard point for
   * fee-rate selection, instead of hard-coding a rate inside the callback (ADR 045).
   * Defaults to a static 5 sat/vB estimator.
   */
  feeEstimator?: FeeEstimator;

  /**
   * Maximum canonicalized byte-length of a signed update body. Submissions
   * above this cap are rejected and surfaced via the `message-rejected` event.
   * Defaults to {@link DEFAULT_MAX_UPDATE_SIZE_BYTES} (256 KiB).
   */
  maxUpdateSizeBytes?: number;

  /**
   * Overall wall-clock budget for each cohort, from advertise to
   * signing-complete. On expiry the cohort is dropped, `cohort-failed` is
   * emitted, and that cohort's completion rejects with a timeout error. Other
   * cohorts on the same runner are unaffected. Leave undefined to disable.
   */
  cohortTtlMs?: number;

  /**
   * Maximum time allowed between phase transitions for a cohort. Protects
   * against stalled cohorts (e.g. a participant vanishing mid-protocol). Reset
   * automatically on every observed phase change. Applied per cohort. Leave
   * undefined to disable.
   */
  phaseTimeoutMs?: number;

  /**
   * Re-publish COHORT_ADVERT on this interval until a cohort's keygen is
   * finalized. Works around relays that don't backfill historical events to
   * late subscribers - a republish gives late joiners a window to discover the
   * advert without protocol changes. The first publish is immediate;
   * subsequent publishes fire every `advertRepeatIntervalMs` until that
   * cohort's keygen completes, fails, or is stopped. Defaults to
   * {@link DEFAULT_ADVERT_REPEAT_INTERVAL_MS} (60 s). Set to 0 to publish
   * once and never retry.
   */
  advertRepeatIntervalMs?: number;

  /**
   * When a cohort stalls (phase timeout) while the optimistic n-of-n signing
   * round is in flight, fall back to the k-of-n script path instead of failing
   * the cohort (graceful liveness, ADR 042). Off by default: enabling it trades a
   * cheaper/private key-path spend for a larger script-path spend whenever the
   * optimistic round does not complete in time. A stall outside the signing
   * phases still fails the cohort. Operators can also drive the fallback
   * explicitly via {@link AggregationServiceRunner.triggerFallback}.
   */
  autoFallbackOnStall?: boolean;
}

/** Default cadence for re-publishing COHORT_ADVERT until keygen completes: 60 seconds. */
export const DEFAULT_ADVERT_REPEAT_INTERVAL_MS = 60_000;

/**
 * Per-cohort runtime bookkeeping the runner keeps for each advertised cohort.
 * One {@link RunContext} per cohortId lives in the runner's `#contexts` map so
 * many cohorts run concurrently on a single runner, each with its own
 * completion promise, finalize guard, timers, and advert-republish loop. The
 * underlying {@link AggregationService} state machine is already keyed by
 * cohortId; this struct is the runner-layer counterpart (see ADR 040).
 */
interface RunContext {
  /** The cohort this context drives. */
  cohortId: string;
  /** The conditions this cohort was advertised with. */
  config: CohortConfig;
  /** Resolve this cohort's completion with its aggregation result. */
  resolve: (result: AggregationResult) => void;
  /** Reject this cohort's completion. */
  reject: (err: Error) => void;
  /** The promise handed back from {@link AggregationServiceRunner.advertiseCohort}. */
  completion: Promise<AggregationResult>;
  /**
   * Guard against the async race where two concurrent #handleOptIn invocations
   * for THIS cohort both pass the `participants.length >= minParticipants`
   * check before either mutates the cohort phase. Set synchronously before any
   * `await` so subsequent handlers observe it on their next resumption.
   */
  finalizing: boolean;
  /** Once settled (resolved or rejected), late timers/messages must not re-settle. */
  settled: boolean;
  /**
   * The spend path this cohort is committed to once signing reaches a decision:
   * `optimistic` (n-of-n key path) or `fallback` (k-of-n script path). A cohort
   * spends its single beacon UTXO exactly once, so this latch (set synchronously
   * before any await) ensures the optimistic completion and the fallback never
   * both finalize and broadcast the same UTXO (the ADR-042 double-spend hazard).
   */
  committedPath?: 'optimistic' | 'fallback';
  cohortTtlTimer?: ReturnType<typeof setTimeout>;
  phaseTimer?: ReturnType<typeof setTimeout>;
  lastObservedPhase?: string;
  /** Stop handle for THIS cohort's repeating COHORT_ADVERT publish loop. */
  stopAdvertRepeat?: () => void;
}

/**
 * High-level facade for running an Aggregation Service over a Transport.
 *
 * Wires the {@link AggregationService} state machine to a {@link Transport},
 * encapsulating message handler registration, outgoing message dispatch,
 * and decision callback orchestration.
 *
 * A single runner is a long-lived multiplexer: it advertises and drives many
 * cohorts concurrently over one transport. Each advertised cohort owns an
 * independent completion promise and fails in isolation - a stalled or failed
 * cohort never settles its siblings (see ADR 040). Use
 * {@link AggregationServiceRunner.advertiseCohort} for the multi-cohort path;
 * {@link AggregationServiceRunner.run} is a thin single-cohort convenience over
 * it.
 *
 * @example
 * ```typescript
 * const transport = new NostrTransport({ relays: [RELAY] });
 * transport.registerActor(serviceDid, serviceKeys);
 *
 * const runner = new AggregationServiceRunner({
 *   transport,
 *   did: serviceDid,
 *   keys: serviceKeys,
 *   onProvideTxData: async ({ beaconAddress, signalBytes, feeEstimator }) => {
 *     // Forward feeEstimator so a dynamic rate injected at the runner is honored.
 *     return await buildBeaconTransaction(beaconAddress, signalBytes, bitcoin, feeEstimator);
 *   },
 * });
 *
 * runner.on('keygen-complete', ({ cohortId, beaconAddress }) => console.log(beaconAddress));
 * runner.on('signing-complete', ({ cohortId, signature }) => console.log('done', cohortId));
 *
 * // Multi-cohort: advertise several cohorts; each completion resolves independently.
 * const a = runner.advertiseCohort({ minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' });
 * const b = runner.advertiseCohort({ minParticipants: 3, network: 'mutinynet', beaconType: 'SMTBeacon' });
 * const [ra, rb] = await Promise.all([a.completion, b.completion]);
 *
 * // Single-cohort convenience (requires `config` in the options):
 * // const result = await runner.run();
 * ```
 *
 * For full manual control, drop down to the underlying state machine via
 * `runner.session`. The state machine has no transport coupling and exposes
 * every protocol decision as an explicit method.
 *
 * @class AggregationServiceRunner
 */
export class AggregationServiceRunner extends TypedEventEmitter<AggregationServiceEvents> {
  /** Direct access to the underlying state machine for advanced use. */
  readonly session: AggregationService;

  readonly #transport: Transport;
  readonly #did: string;
  readonly #defaultConfig?: CohortConfig;
  readonly #onOptInReceived: OnOptInReceived;
  readonly #onReadyToFinalize: OnReadyToFinalize;
  readonly #onProvideTxData: OnProvideTxData;
  readonly #feeEstimator: FeeEstimator;
  readonly #cohortTtlMs?: number;
  readonly #phaseTimeoutMs?: number;
  readonly #advertRepeatIntervalMs: number;
  readonly #autoFallbackOnStall: boolean;

  /** Phases during which a stall can be salvaged by the k-of-n fallback (ADR 042). */
  static readonly #SIGNING_PHASES: readonly ServiceCohortPhaseType[] = [
    ServiceCohortPhase.SigningStarted,
    ServiceCohortPhase.NoncesCollected,
    ServiceCohortPhase.AwaitingPartialSigs,
  ];

  /** Per-cohort run state, keyed by cohortId. */
  readonly #contexts: Map<string, RunContext> = new Map();
  #handlersRegistered = false;
  #stopped = false;

  constructor(options: AggregationServiceRunnerOptions) {
    super();
    this.#transport = options.transport;
    this.#did = options.did;
    this.#defaultConfig = options.config;
    this.#onOptInReceived = options.onOptInReceived ?? (async () => ({ accepted: true }));
    this.#onReadyToFinalize = options.onReadyToFinalize ?? (async ({ acceptedCount, minRequired }) => ({
      finalize : acceptedCount >= minRequired,
    }));
    this.#onProvideTxData = options.onProvideTxData;
    this.#feeEstimator = options.feeEstimator ?? DEFAULT_FEE_ESTIMATOR;
    this.#cohortTtlMs = options.cohortTtlMs;
    this.#phaseTimeoutMs = options.phaseTimeoutMs;
    this.#advertRepeatIntervalMs = options.advertRepeatIntervalMs ?? DEFAULT_ADVERT_REPEAT_INTERVAL_MS;
    this.#autoFallbackOnStall = options.autoFallbackOnStall ?? false;

    this.session = new AggregationService({
      // The coordinator never signs, so the state machine receives only the
      // public half of the operator's keypair (see ADR 038). The full keypair
      // remains the operator's transport/communication identity.
      did                : options.did,
      publicKey          : options.keys.publicKey,
      maxUpdateSizeBytes : options.maxUpdateSizeBytes,
    });
  }

  /** Resolve the {@link RunContext} an inbound message belongs to, by cohortId. */
  #contextFor(msg: BaseMessage): RunContext | undefined {
    const cohortId = msg.body?.cohortId;
    if(!cohortId) return undefined;
    return this.#contexts.get(cohortId);
  }

  /**
   * Drain any silent rejections the state machine recorded for a cohort during
   * the most recent receive() and surface them as `message-rejected` events.
   */
  #drainRejections(ctx: RunContext): void {
    for(const r of this.session.drainRejections(ctx.cohortId)) {
      this.emit('message-rejected', { cohortId: ctx.cohortId, ...r });
    }
  }

  /**
   * Advertise a new cohort and begin driving it to completion. Callable many
   * times on one runner; each cohort runs concurrently and independently.
   *
   * @param config Per-cohort conditions + network (see {@link CohortConfig}).
   * @returns The new cohort's id and a `completion` promise that resolves with
   *   that cohort's {@link AggregationResult} (or rejects if it fails/stalls).
   * @throws If the runner has been stopped, or the config is invalid
   *   (fail-fast via `createCohort`).
   */
  advertiseCohort(config: CohortConfig): { cohortId: string; completion: Promise<AggregationResult> } {
    if(this.#stopped) {
      throw new AggregationServiceError('Cannot advertise on a stopped runner.', 'RUNNER_STOPPED', {});
    }
    this.#registerHandlers();
    // createCohort validates the conditions and throws on a bad config before
    // any context exists - fail-fast, nothing to clean up.
    const cohortId = this.session.createCohort(config);

    let resolve!: (result: AggregationResult) => void;
    let reject!: (err: Error) => void;
    const completion = new Promise<AggregationResult>((res, rej) => { resolve = res; reject = rej; });
    const ctx: RunContext = {
      cohortId,
      config,
      resolve,
      reject,
      completion,
      finalizing : false,
      settled    : false,
    };
    this.#contexts.set(cohortId, ctx);

    try {
      this.#startTimers(ctx);
      // Emit cohort-advertised BEFORE the send so the event fires before any downstream cascade.
      const advertMsgs = this.session.advertise(cohortId);
      this.#onPhaseMaybeChanged(ctx);
      this.emit('cohort-advertised', { cohortId });
      // Publish the advert. If advertRepeatIntervalMs > 0 we republish on that
      // cadence until this cohort's keygen-complete / fail / stop - works around
      // relays that don't backfill historical events to late subscribers.
      // Otherwise fall back to a single send.
      if(this.#advertRepeatIntervalMs > 0) {
        this.#startAdvertRepeat(ctx, advertMsgs);
      } else {
        this.#sendAll(advertMsgs).catch(err => this.#failCohort(ctx, err as Error));
      }
    } catch(err) {
      this.#failCohort(ctx, err as Error);
    }

    return { cohortId, completion };
  }

  /**
   * Run a single cohort to completion using the `config` supplied in the
   * runner options. Thin convenience over {@link advertiseCohort} for the
   * single-cohort case (and the path {@link AggregationRunner.solo} rides).
   *
   * @returns {Promise<AggregationResult>} The final result with signature and signed tx.
   */
  run(): Promise<AggregationResult> {
    if(!this.#defaultConfig) {
      return Promise.reject(new AggregationServiceError(
        'run() requires `config` in the runner options; use advertiseCohort(config) to drive cohorts explicitly.',
        'MISSING_COHORT_CONFIG', {}
      ));
    }
    try {
      return this.advertiseCohort(this.#defaultConfig).completion;
    } catch(err) {
      return Promise.reject(err as Error);
    }
  }

  /**
   * Wait for every currently-outstanding cohort to settle and return the
   * successful results. Dynamic drain: cohorts advertised while this is pending
   * are included, and it resolves only once no cohorts remain. Failed cohorts
   * are surfaced via `error` / `cohort-failed` events and their rejected
   * `completion` promises; they are omitted from the returned array (this
   * method does not throw). Bound long-running cohorts with `cohortTtlMs` /
   * `phaseTimeoutMs` or this may never resolve.
   *
   * @returns {Promise<AggregationResult[]>} Results of the cohorts that completed.
   */
  async runAll(): Promise<AggregationResult[]> {
    const collected = new Map<string, AggregationResult>();
    // Capture every completion, including a cohort that is advertised and
    // finishes entirely within one drain round (so it never appears in a
    // snapshot below).
    const onComplete = (result: AggregationResult): void => { collected.set(result.cohortId, result); };
    this.on('signing-complete', onComplete);
    try {
      // Block until the live set empties; re-snapshot each round to pick up
      // cohorts advertised mid-drain.
      while(this.#contexts.size > 0) {
        await Promise.allSettled([ ...this.#contexts.values() ].map(c => c.completion));
      }
    } finally {
      this.off('signing-complete', onComplete);
    }
    return [ ...collected.values() ];
  }

  /**
   * Begin publishing a cohort's advert immediately and on a repeating interval
   * until the cohort's advert loop is stopped. Each advert is broadcast (no
   * recipient) via the transport's `publishRepeating` primitive.
   */
  #startAdvertRepeat(ctx: RunContext, advertMsgs: BaseMessage[]): void {
    // COHORT_ADVERT is always a single broadcast message in the current
    // protocol, but iterate for generality.
    const stops: Array<() => void> = [];
    for(const msg of advertMsgs) {
      stops.push(this.#transport.publishRepeating(msg, this.#did, this.#advertRepeatIntervalMs));
    }
    ctx.stopAdvertRepeat = () => {
      for(const stop of stops) {
        try { stop(); } catch { /* ignore */ }
      }
    };
  }

  /** Stop a cohort's advert republish loop. Idempotent. */
  #stopAdvertRepeating(ctx: RunContext): void {
    if(!ctx.stopAdvertRepeat) return;
    const stop = ctx.stopAdvertRepeat;
    ctx.stopAdvertRepeat = undefined;
    stop();
  }

  /** Schedule a cohort's TTL + phase timeout when it is advertised. */
  #startTimers(ctx: RunContext): void {
    if(this.#cohortTtlMs !== undefined) {
      ctx.cohortTtlTimer = setTimeout(() => {
        const reason = `Cohort ${ctx.cohortId} exceeded TTL of ${this.#cohortTtlMs}ms`;
        this.emit('cohort-failed', { cohortId: ctx.cohortId, reason });
        this.#failCohort(ctx, new Error(reason));
      }, this.#cohortTtlMs);
    }
    this.#resetPhaseTimer(ctx);
  }

  /** Reset a cohort's per-phase stall timer. Called when a phase transition is observed. */
  #resetPhaseTimer(ctx: RunContext): void {
    if(ctx.phaseTimer) clearTimeout(ctx.phaseTimer);
    ctx.phaseTimer = undefined;
    if(this.#phaseTimeoutMs === undefined) return;
    ctx.phaseTimer = setTimeout(() => {
      // A stall during the optimistic signing round can be salvaged by the k-of-n
      // fallback rather than failing the whole cohort (graceful liveness, ADR
      // 042) - but only if enabled and not already committed to a path.
      const phase = this.session.getCohortPhase(ctx.cohortId);
      const inSigning = phase !== undefined && AggregationServiceRunner.#SIGNING_PHASES.includes(phase);
      if(this.#autoFallbackOnStall && inSigning && !ctx.committedPath && !ctx.settled) {
        this.triggerFallback(ctx.cohortId).catch(err => this.#failCohort(ctx, err as Error));
        return;
      }
      const reason = `Cohort ${ctx.cohortId} stalled in phase ${ctx.lastObservedPhase ?? '?'} for ${this.#phaseTimeoutMs}ms`;
      this.emit('cohort-failed', { cohortId: ctx.cohortId, reason });
      this.#failCohort(ctx, new Error(reason));
    }, this.#phaseTimeoutMs);
  }

  /**
   * Abandon the optimistic n-of-n key path for a cohort and collect k-of-n
   * fallback (script-path) signatures instead (ADR 042). Idempotent and safe
   * against the optimistic completion: it commits the cohort to the fallback
   * path synchronously (the `committedPath` latch) before sending anything, so a
   * late optimistic signature can no longer complete-and-broadcast a competing
   * spend of the same UTXO. No-op if the cohort is unknown, already settled, or
   * already committed to a path.
   *
   * Wired automatically to the phase-stall timer when `autoFallbackOnStall` is
   * set; otherwise call it from an operator decision (a UI "fall back now"
   * action). Throws only if the underlying state machine rejects the transition
   * (e.g. signing has not started).
   */
  async triggerFallback(cohortId: string): Promise<void> {
    const ctx = this.#contexts.get(cohortId);
    if(!ctx || ctx.settled || ctx.committedPath) return;
    // startFallbackSigning is synchronous and throws if the cohort is not in a
    // signing phase (e.g. a premature operator call). Run it FIRST so a rejected
    // transition cannot poison the latch: only after it commits the state machine
    // to the fallback do we set committedPath. This still happens synchronously
    // before any await, so a concurrent optimistic completion observes the latch
    // and stands down - but a bad-phase call leaves the optimistic path intact.
    const messages = this.session.startFallbackSigning(cohortId);
    ctx.committedPath = 'fallback';
    this.#stopAdvertRepeating(ctx);
    this.#onPhaseMaybeChanged(ctx);
    const sessionId = this.session.getSigningSessionId(cohortId) ?? '';
    this.emit('fallback-started', { cohortId, sessionId });
    await this.#sendAll(messages);
  }

  /** Detect a phase change for a cohort since the last observation and reset its phase timer. */
  #onPhaseMaybeChanged(ctx: RunContext): void {
    const phase = this.session.getCohortPhase(ctx.cohortId);
    if(phase !== ctx.lastObservedPhase) {
      ctx.lastObservedPhase = phase;
      this.#resetPhaseTimer(ctx);
    }
  }

  /** Clear a cohort's timers. Called on completion, stop, and failure. */
  #clearTimers(ctx: RunContext): void {
    if(ctx.cohortTtlTimer) clearTimeout(ctx.cohortTtlTimer);
    if(ctx.phaseTimer) clearTimeout(ctx.phaseTimer);
    ctx.cohortTtlTimer = undefined;
    ctx.phaseTimer = undefined;
  }

  /**
   * Reclaim one cohort's runner-layer bookkeeping: stop its advert loop, clear
   * its timers, and drop its {@link RunContext}. Does NOT touch sibling cohorts
   * and does NOT detach the shared transport handlers. Leaves the cohort in the
   * state machine; whether that cohort's `session` state is also removed is the
   * caller's choice (see {@link #completeCohort} vs {@link #failCohort}).
   */
  #disposeCohort(ctx: RunContext): void {
    this.#stopAdvertRepeating(ctx);
    this.#clearTimers(ctx);
    this.#contexts.delete(ctx.cohortId);
  }

  /**
   * Settle one cohort successfully. Reclaims the runner context but leaves the
   * completed cohort in `session` so callers can read its beaconAddress / cohort
   * via `session.getCohort(result.cohortId)`; reclaim it with
   * `session.removeCohort(cohortId)` when done. Idempotent via `ctx.settled`.
   */
  #completeCohort(ctx: RunContext, result: AggregationResult): void {
    if(ctx.settled) return;
    ctx.settled = true;
    this.#disposeCohort(ctx);
    this.emit('signing-complete', result);
    ctx.resolve(result);
  }

  /**
   * Fail one cohort. Reclaims its runner context, drops its now-dead state from
   * the state machine, and rejects only its completion; siblings keep running
   * and the shared transport handlers stay registered. Idempotent via
   * `ctx.settled`.
   */
  #failCohort(ctx: RunContext, err: Error): void {
    if(ctx.settled) return;
    ctx.settled = true;
    this.#disposeCohort(ctx);
    this.session.removeCohort(ctx.cohortId);
    this.emit('error', err);
    ctx.reject(err);
  }

  /**
   * Stop a single cohort early without affecting the rest of the runner. Drops
   * the cohort's state machine state; its `completion` promise rejects with a
   * stopped error.
   */
  stopCohort(cohortId: string): void {
    const ctx = this.#contexts.get(cohortId);
    if(!ctx || ctx.settled) return;
    ctx.settled = true;
    this.#disposeCohort(ctx);
    this.session.removeCohort(cohortId);
    ctx.reject(new AggregationServiceError(`Cohort ${cohortId} stopped.`, 'COHORT_STOPPED', { cohortId }));
  }

  /**
   * Stop the whole runner. Fails every outstanding cohort, then detaches the
   * shared transport handlers so a restart or a new runner doesn't inherit
   * stale dispatch. Safe to call repeatedly.
   */
  stop(): void {
    this.#stopped = true;
    for(const ctx of [ ...this.#contexts.values() ]) {
      if(ctx.settled) continue;
      ctx.settled = true;
      this.#disposeCohort(ctx);
      this.session.removeCohort(ctx.cohortId);
      ctx.reject(new AggregationServiceError('Service runner stopped.', 'RUNNER_STOPPED', { cohortId: ctx.cohortId }));
    }
    this.#contexts.clear();
    this.#unregisterHandlers();
  }

  /** Message types this runner listens for on the transport. */
  static readonly #HANDLED_MESSAGE_TYPES: readonly string[] = [
    COHORT_OPT_IN,
    SUBMIT_UPDATE,
    SUBMIT_NONINCLUDED,
    VALIDATION_ACK,
    NONCE_CONTRIBUTION,
    SIGNATURE_AUTHORIZATION,
    FALLBACK_SIGNATURE,
  ];

  /**
   * Internal: handler registration with the transport. Idempotent. Handlers
   * are DID-scoped and cohort-agnostic - one registration serves every cohort
   * this runner drives; demux to the right {@link RunContext} happens in each
   * handler via the inbound message's cohortId.
   */
  #registerHandlers(): void {
    if(this.#handlersRegistered) return;
    this.#handlersRegistered = true;

    this.#transport.registerMessageHandler(this.#did, COHORT_OPT_IN, this.#handleOptIn.bind(this));
    this.#transport.registerMessageHandler(this.#did, SUBMIT_UPDATE, this.#handleSubmitUpdate.bind(this));
    // A non-inclusion (decline) is an update-phase response handled identically:
    // session.receive() routes by type, and the response gate + distribute
    // trigger are shared with SUBMIT_UPDATE.
    this.#transport.registerMessageHandler(this.#did, SUBMIT_NONINCLUDED, this.#handleSubmitUpdate.bind(this));
    this.#transport.registerMessageHandler(this.#did, VALIDATION_ACK, this.#handleValidationAck.bind(this));
    this.#transport.registerMessageHandler(this.#did, NONCE_CONTRIBUTION, this.#handleNonceContribution.bind(this));
    this.#transport.registerMessageHandler(this.#did, SIGNATURE_AUTHORIZATION, this.#handleSignatureAuthorization.bind(this));
    this.#transport.registerMessageHandler(this.#did, FALLBACK_SIGNATURE, this.#handleFallbackSignature.bind(this));
  }

  /** Internal: detach from the transport. Safe to call repeatedly. */
  #unregisterHandlers(): void {
    if(!this.#handlersRegistered) return;
    this.#handlersRegistered = false;
    for(const type of AggregationServiceRunner.#HANDLED_MESSAGE_TYPES) {
      this.#transport.unregisterMessageHandler(this.#did, type);
    }
  }

  /**
   * Internal: message handlers for each protocol step. Each handler:
   * 1) resolves the cohort the message belongs to (by cohortId); ignores it if unknown
   * 2) feeds the message into the state machine via session.receive()
   * 3) emits a high-level event (carrying cohortId) for external observers
   * 4) checks if the new state triggers any automatic next steps, and if so:
   *    a) calls the appropriate decision callback(s)
   *    b) sends any resulting messages from the state machine
   * Errors fail only the owning cohort. A stopped runner ignores messages.
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
   */
  async #handleOptIn(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    const ctx = this.#contextFor(msg);
    if(!ctx) return;
    try {
      this.session.receive(msg);
      this.#drainRejections(ctx);
      this.#onPhaseMaybeChanged(ctx);

      const optIn = this.session.pendingOptIns(ctx.cohortId).get(msg.from);
      if(!optIn) return;
      // PendingOptIn already carries cohortId, so this event is cohort-identified.
      this.emit('opt-in-received', optIn);

      // Register peer key for encrypted messaging
      if(optIn.communicationPk) {
        this.#transport.registerPeer(msg.from, optIn.communicationPk);
      }

      const decision = await this.#onOptInReceived(optIn);
      if(!decision.accepted) return;

      // Don't accept past the advertised maxParticipants: acceptParticipant
      // would throw COHORT_FULL and fail the cohort. Silently ignore the surplus
      // opt-in (the cohort is full).
      const maxParticipants = ctx.config.maxParticipants;
      const cohortNow = this.session.getCohort(ctx.cohortId);
      if(maxParticipants !== undefined && cohortNow && cohortNow.participants.length >= maxParticipants) {
        return;
      }

      await this.#sendAll(this.session.acceptParticipant(ctx.cohortId, msg.from));
      this.emit('participant-accepted', { cohortId: ctx.cohortId, participantDid: msg.from });

      // Check if it's time to finalize. The per-cohort `finalizing` flag is set
      // synchronously before the first await so concurrent opt-in handlers for
      // the same cohort observe it and skip - otherwise two handlers could both
      // pass the minParticipants check and both call finalizeKeygen, the second
      // of which would throw (phase mismatch).
      const cohort = this.session.getCohort(ctx.cohortId)!;
      if(cohort.participants.length >= ctx.config.minParticipants && !ctx.finalizing) {
        ctx.finalizing = true;
        const finalizeDecision = await this.#onReadyToFinalize({
          acceptedCount : cohort.participants.length,
          minRequired   : ctx.config.minParticipants,
        });
        if(!finalizeDecision.finalize) {
          // Operator declined - reset the flag so a later opt-in can retry.
          ctx.finalizing = false;
          return;
        }
        // finalizeKeygen() computes the beacon address synchronously
        // emit BEFORE awaiting sendAll. Otherwise the downstream cascade
        // (which can run all the way to signing-complete) would resolve the
        // cohort's completion promise before this event fires.
        const readyMsgs = this.session.finalizeKeygen(ctx.cohortId);
        // Keygen done - stop re-advertising the cohort. New participants
        // arriving after this point would be rejected anyway.
        this.#stopAdvertRepeating(ctx);
        this.emit('keygen-complete', {
          cohortId      : ctx.cohortId,
          beaconAddress : cohort.beaconAddress,
        });
        await this.#sendAll(readyMsgs);
      }
    } catch(err) {
      this.#failCohort(ctx, err as Error);
    }
  }

  /**
   * Handler for receiving participant updates. When all updates are received, automatically builds
   * and distributes the data for validation.
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
   */
  async #handleSubmitUpdate(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    const ctx = this.#contextFor(msg);
    if(!ctx) return;
    try {
      this.session.receive(msg);
      this.#drainRejections(ctx);
      this.#onPhaseMaybeChanged(ctx);
      this.emit('update-received', { cohortId: ctx.cohortId, participantDid: msg.from });

      // When all updates collected, build and distribute
      if(this.session.getCohortPhase(ctx.cohortId) === ServiceCohortPhase.UpdatesCollected) {
        const distributeMsgs = this.session.buildAndDistribute(ctx.cohortId);
        this.emit('data-distributed', { cohortId: ctx.cohortId });
        await this.#sendAll(distributeMsgs);
      }
    } catch(err) {
      this.#failCohort(ctx, err as Error);
    }
  }

  /**
   * Handler for receiving validation acknowledgments. When all validations are received,
   * automatically requests tx data and starts signing.
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
   */
  async #handleValidationAck(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    const ctx = this.#contextFor(msg);
    if(!ctx) return;
    try {
      this.session.receive(msg);
      this.#drainRejections(ctx);
      this.#onPhaseMaybeChanged(ctx);
      const approved = !!msg.body?.approved;
      this.emit('validation-received', { cohortId: ctx.cohortId, participantDid: msg.from, approved });

      const phase = this.session.getCohortPhase(ctx.cohortId);

      // A participant rejection flips the cohort to Failed. Emit a structured
      // event so the runner/caller sees the failure instead of the cohort
      // silently stalling.
      if(phase === ServiceCohortPhase.Failed) {
        const reason = `Validation rejected by participant ${msg.from}`;
        this.emit('cohort-failed', { cohortId: ctx.cohortId, reason });
        this.#failCohort(ctx, new Error(reason));
        return;
      }

      // When all validations received, request tx data and start signing
      if(phase === ServiceCohortPhase.Validated) {
        const cohort = this.session.getCohort(ctx.cohortId)!;
        const txData = await this.#onProvideTxData({
          cohortId      : ctx.cohortId,
          beaconAddress : cohort.beaconAddress,
          signalBytes   : cohort.signalBytes!,
          feeEstimator  : this.#feeEstimator,
        });
        const authMsgs = this.session.startSigning(ctx.cohortId, txData);
        const sessionId = this.session.getSigningSessionId(ctx.cohortId) ?? '';
        this.emit('signing-started', { cohortId: ctx.cohortId, sessionId });
        await this.#sendAll(authMsgs);
      }
    } catch(err) {
      this.#failCohort(ctx, err as Error);
    }
  }

  /**
   * Handler for receiving nonce contributions. When all nonces are received, sends the aggregated
   * nonce back to the cohort.
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
   */
  async #handleNonceContribution(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    const ctx = this.#contextFor(msg);
    if(!ctx) return;
    try {
      this.session.receive(msg);
      this.#drainRejections(ctx);
      this.#onPhaseMaybeChanged(ctx);
      this.emit('nonce-received', { cohortId: ctx.cohortId, participantDid: msg.from });

      // When all nonces collected, send aggregated nonce
      if(this.session.getCohortPhase(ctx.cohortId) === ServiceCohortPhase.NoncesCollected) {
        await this.#sendAll(this.session.sendAggregatedNonce(ctx.cohortId));
      }
    } catch(err) {
      this.#failCohort(ctx, err as Error);
    }
  }

  /**
   * Handler for receiving signature authorizations. When all partial signatures are received, the
   * session automatically completes; the final result is emitted and the cohort's completion
   * promise resolves.
   * @param {BaseMessage} msg - The incoming message to handle.
   * @returns {Promise<void>} Resolves when handling is complete.
   */
  async #handleSignatureAuthorization(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    const ctx = this.#contextFor(msg);
    if(!ctx) return;
    try {
      this.session.receive(msg);
      this.#drainRejections(ctx);
      this.#onPhaseMaybeChanged(ctx);

      // If the cohort already committed to the fallback path, ignore a late
      // optimistic completion: only one path may finalize the single beacon UTXO.
      if(ctx.committedPath === 'fallback') return;

      // The state machine auto-completes when all partial sigs received.
      const result = this.session.getResult(ctx.cohortId);
      if(result) {
        ctx.committedPath = 'optimistic';
        this.#completeCohort(ctx, result);
      }
    } catch(err) {
      this.#failCohort(ctx, err as Error);
    }
  }

  /**
   * Handler for receiving fallback (k-of-n script-path) signatures. The state
   * machine assembles and finalizes the fallback spend once k valid signatures
   * are in; the result is then emitted and the cohort's completion resolves. The
   * cohort is already committed to the fallback path (via {@link triggerFallback}).
   * @param {BaseMessage} msg - The incoming FALLBACK_SIGNATURE message.
   * @returns {Promise<void>} Resolves when handling is complete.
   */
  async #handleFallbackSignature(msg: BaseMessage): Promise<void> {
    if(this.#stopped) return;
    const ctx = this.#contextFor(msg);
    if(!ctx) return;
    try {
      this.session.receive(msg);
      this.#drainRejections(ctx);
      this.#onPhaseMaybeChanged(ctx);

      const result = this.session.getResult(ctx.cohortId);
      if(result) {
        this.#completeCohort(ctx, result);
      }
    } catch(err) {
      this.#failCohort(ctx, err as Error);
    }
  }

  /**
   * Internal: helper to send all messages sequentially. Catches and propagates errors.
   * @param {BaseMessage[]} msgs - The messages to send.
   * @returns {Promise<void>} Resolves when all messages have been sent.
   */
  async #sendAll(msgs: BaseMessage[]): Promise<void> {
    for(const m of msgs) {
      await this.#transport.sendMessage(m, this.#did, m.to);
    }
  }
}
