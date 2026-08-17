import { wipe } from '@did-btcr2/keypair';
import type { Transaction } from '@scure/btc-signer';
import { SigHash } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import type { AggregationCohort } from './cohort.js';
import { SigningSessionError } from './errors.js';
import type { SigningSessionPhaseType } from './phases.js';
import { SigningSessionPhase } from './phases.js';

type PublicKeyHex = string;
type Nonce = Uint8Array;

export interface SigningSessionParams {
  id?: string;
  cohort: AggregationCohort;
  pendingTx: Transaction;
  prevOutScripts?: Uint8Array[];
  prevOutValues?: bigint[];
}

/**
 * MuSig2 signing session for a beacon transaction.
 *
 * Implements the BIP-327 signing protocol over a Taproot key-path-only
 * transaction. The session is used by both AggregationService (collecting
 * nonces and partial signatures, computing the final signature) and
 * AggregationParticipant (generating their nonce and partial signature).
 *
 * @class BeaconSigningSession
 */
export class BeaconSigningSession {
  /** Unique identifier for this signing session. */
  public id: string;

  /** The cohort this session signs for. */
  public cohort: AggregationCohort;

  /** The Bitcoin transaction being signed. */
  public pendingTx: Transaction;

  /** Previous output scripts for Taproot sighash computation (BIP-341). */
  public prevOutScripts: Uint8Array[];

  /** Previous output values for Taproot sighash computation. */
  public prevOutValues: bigint[];

  /** Map of participant publicKey-hex to public nonce contribution. */
  public nonceContributions: Map<PublicKeyHex, Nonce> = new Map();

  /** Aggregated MuSig2 nonce (66 bytes). */
  public aggregatedNonce?: Uint8Array;

  /** Map of participant DID to partial signature. */
  public partialSignatures: Map<string, Uint8Array> = new Map();

  /** Final 64-byte Schnorr signature. */
  public signature?: Uint8Array;

  /** Current signing session phase. */
  public phase: SigningSessionPhaseType;

  /**
   * Participant's MuSig2 secret nonce, held only on the participant side
   * between {@link generateNonceContribution} and {@link generatePartialSignature}.
   * Private and cleared on every terminal path (success, failure, or teardown
   * via {@link clearSecrets}) so a spent or abandoned nonce cannot be reused or
   * serialized.
   */
  #secretNonce?: Uint8Array;

  constructor({ id, cohort, pendingTx, prevOutScripts, prevOutValues }: SigningSessionParams) {
    this.id = id || crypto.randomUUID();
    this.cohort = cohort;
    this.pendingTx = pendingTx;
    this.prevOutScripts = prevOutScripts || [];
    this.prevOutValues = prevOutValues || [];
    this.phase = SigningSessionPhase.AwaitingNonceContributions;
  }

  /**
   * Computes the Taproot sighash (BIP-341) for the first input.
   */
  get sigHash(): Uint8Array {
    if(!this.prevOutScripts.length || !this.prevOutValues.length) {
      throw new SigningSessionError(
        'Cannot compute sighash: missing prevOutScripts or prevOutValues.',
        'SIGHASH_ERROR'
      );
    }
    return this.pendingTx.preimageWitnessV1(
      0,
      this.prevOutScripts,
      SigHash.DEFAULT,
      this.prevOutValues
    );
  }

  public addNonceContribution(participantDid: string, nonceContribution: Uint8Array): void {
    if(this.phase !== SigningSessionPhase.AwaitingNonceContributions) {
      throw new SigningSessionError(
        `Nonce contributions not expected. Current phase: ${this.phase}`,
        'INVALID_PHASE', { phase: this.phase }
      );
    }
    if(!this.cohort.participants.includes(participantDid)) {
      throw new SigningSessionError(
        `Participant ${participantDid} is not a member of cohort ${this.cohort.id}.`,
        'UNKNOWN_PARTICIPANT', { cohortId: this.cohort.id, participantDid }
      );
    }
    if(nonceContribution.length !== 66) {
      throw new SigningSessionError(
        `Invalid nonce contribution: expected 66 bytes, got ${nonceContribution.length}.`,
        'INVALID_NONCE_LENGTH'
      );
    }
    if(this.nonceContributions.has(participantDid)) {
      throw new SigningSessionError(
        `Duplicate nonce contribution from ${participantDid}.`,
        'DUPLICATE_NONCE'
      );
    }
    this.nonceContributions.set(participantDid, nonceContribution);

    if(this.nonceContributions.size === this.cohort.participants.length) {
      this.phase = SigningSessionPhase.NonceContributionsReceived;
    }
  }

  /**
   * True when `nonceContribution` is a well-formed MuSig2 public nonce: 66 bytes
   * carrying two valid, non-infinity secp256k1 points.
   *
   * {@link generateAggregatedNonce} throws on anything else, and it runs long
   * after the contribution arrived, so a receive path that stores an unchecked
   * nonce turns one inbound message into a cohort-wide failure. Callers driving
   * the session from untrusted input validate here first and drop the message
   * instead.
   */
  public static isValidNonceContribution(nonceContribution: Uint8Array): boolean {
    try {
      // Aggregating the single contribution is the validity check itself: it
      // decodes both points and rejects infinity, exactly as the real
      // aggregation will.
      musig2.nonceAggregate([nonceContribution]);
      return true;
    } catch {
      return false;
    }
  }

  public generateAggregatedNonce(): Uint8Array {
    if(this.phase !== SigningSessionPhase.NonceContributionsReceived) {
      throw new SigningSessionError(
        `Cannot aggregate nonces: phase is ${this.phase}, expected NonceContributionsReceived.`,
        'INVALID_PHASE'
      );
    }
    this.aggregatedNonce = musig2.nonceAggregate([...this.nonceContributions.values()]);
    this.phase = SigningSessionPhase.AwaitingPartialSignatures;
    return this.aggregatedNonce;
  }

  public addPartialSignature(participantDid: string, partialSig: Uint8Array): void {
    if(this.phase !== SigningSessionPhase.AwaitingPartialSignatures) {
      throw new SigningSessionError(
        `Partial signatures not expected. Current phase: ${this.phase}`,
        'INVALID_PHASE'
      );
    }
    if(!this.cohort.participants.includes(participantDid)) {
      throw new SigningSessionError(
        `Participant ${participantDid} is not a member of cohort ${this.cohort.id}.`,
        'UNKNOWN_PARTICIPANT', { cohortId: this.cohort.id, participantDid }
      );
    }
    if(this.partialSignatures.has(participantDid)) {
      throw new SigningSessionError(
        `Duplicate partial signature from ${participantDid}.`,
        'DUPLICATE_PARTIAL_SIG'
      );
    }
    this.partialSignatures.set(participantDid, partialSig);

    if(this.partialSignatures.size === this.cohort.participants.length) {
      this.phase = SigningSessionPhase.PartialSignaturesReceived;
    }
  }

  public generateFinalSignature(): Uint8Array {
    if(this.phase !== SigningSessionPhase.PartialSignaturesReceived) {
      throw new SigningSessionError(
        `Cannot generate final signature: phase is ${this.phase}.`,
        'INVALID_PHASE'
      );
    }
    if(!this.aggregatedNonce) {
      throw new SigningSessionError('Aggregated nonce missing.', 'MISSING_AGGREGATED_NONCE');
    }
    const session = this.#musig2Session(this.aggregatedNonce);

    // Pre-verify each partial signature against the signer's public key before
    // aggregating (BIP-327 §2.3.5). Delegating verification to partialSigAgg
    // alone makes it impossible to attribute a bad contribution; pinpointing
    // the offending participant lets the service blame and retry without the
    // whole cohort.
    const pubNoncesByIndex = this.#pubNoncesByIndex();

    for(const [did, partialSig] of this.partialSignatures) {
      const idx = this.cohort.indexOfParticipant(did);
      if(idx < 0) {
        throw new SigningSessionError(
          `Cannot verify partial signature from ${did}: participant key missing from cohort.`,
          'UNKNOWN_PARTICIPANT_KEY', { participantDid: did }
        );
      }
      const ok = session.partialSigVerify(partialSig, pubNoncesByIndex, idx);
      if(!ok) {
        throw new SigningSessionError(
          `Bad partial signature from ${did}.`,
          'BAD_PARTIAL_SIG', { participantDid: did, index: idx }
        );
      }
    }

    this.signature = session.partialSigAgg([...this.partialSignatures.values()]);
    this.phase = SigningSessionPhase.Complete;
    return this.signature;
  }

  /**
   * True when `partialSig` is a valid MuSig2 partial signature from
   * `participantDid` for this session's aggregated nonce and sighash.
   *
   * The same check {@link generateFinalSignature} runs before aggregating, hoisted
   * so a caller can apply it when the contribution arrives rather than when the
   * round completes: a bad partial signature stored now is a `BAD_PARTIAL_SIG`
   * throw later, by which point one member's message has failed the whole cohort.
   * Never throws - an unknown signer, a missing nonce, or malformed bytes are all
   * `false`.
   *
   * Cost is one key aggregation over the cohort keys plus one verification, so it
   * is linear in cohort size per call; cap the cohort with the `maxParticipants`
   * condition if inbound signature messages are unmetered.
   */
  public verifyPartialSignature(participantDid: string, partialSig: Uint8Array): boolean {
    try {
      if(!this.aggregatedNonce) return false;
      const index = this.cohort.indexOfParticipant(participantDid);
      if(index < 0) return false;
      return this.#musig2Session(this.aggregatedNonce)
        .partialSigVerify(partialSig, this.#pubNoncesByIndex(), index);
    } catch {
      return false;
    }
  }

  /**
   * Build the MuSig2 session for this round. Deliberately rebuilt per call: the
   * sighash is recomputed from the live transaction every time, so a session is
   * never verified or aggregated against a stale message.
   */
  #musig2Session(aggregatedNonce: Uint8Array): musig2.Session {
    return new musig2.Session(
      aggregatedNonce,
      this.cohort.cohortKeys,
      this.sigHash,
      [this.cohort.tapTweak],
      [true]
    );
  }

  /**
   * Public nonces ordered to match `cohort.cohortKeys`, the layout
   * `partialSigVerify(partialSig, pubNonces, i)` indexes with the signer's
   * position `i`.
   */
  #pubNoncesByIndex(): Uint8Array[] {
    const pubNoncesByIndex: Uint8Array[] = new Array(this.cohort.cohortKeys.length);
    for(const [did, nonce] of this.nonceContributions) {
      const idx = this.cohort.indexOfParticipant(did);
      if(idx < 0) {
        throw new SigningSessionError(
          `Cannot verify nonce from ${did}: participant key missing from cohort.`,
          'UNKNOWN_PARTICIPANT_KEY', { participantDid: did }
        );
      }
      pubNoncesByIndex[idx] = nonce;
    }
    return pubNoncesByIndex;
  }

  /**
   * Generates a fresh MuSig2 nonce contribution for the participant.
   * Stores the secret nonce internally for use in `generatePartialSignature()`.
   */
  public generateNonceContribution(participantPublicKey: Uint8Array, participantSecretKey: Uint8Array): Uint8Array {
    const aggPublicKey = musig2.keyAggExport(musig2.keyAggregate(this.cohort.cohortKeys));
    const nonces = musig2.nonceGen(participantPublicKey, participantSecretKey, aggPublicKey);
    this.#secretNonce = nonces.secret;
    return nonces.public;
  }

  /**
   * Generates a partial signature using the participant's secret key + secret nonce.
   * Requires the aggregated nonce to have been set first (via the service).
   *
   * Clears the stored secret nonce after use on every path (success or throw)
   * via {@link clearSecrets}. JS cannot truly erase memory (GC may relocate
   * buffers), but overwriting the bytes shortens the exposure window and
   * prevents accidental reuse or serialization of a spent nonce - reuse of a
   * MuSig2 nonce leaks the secret key.
   */
  public generatePartialSignature(participantSecretKey: Uint8Array): Uint8Array {
    if(!this.aggregatedNonce) {
      throw new SigningSessionError('Aggregated nonce not available.', 'MISSING_AGGREGATED_NONCE');
    }
    if(!this.#secretNonce) {
      throw new SigningSessionError('Secret nonce not available - generateNonceContribution() must be called first.', 'MISSING_SECRET_NONCE');
    }
    const session = this.#musig2Session(this.aggregatedNonce);
    try {
      return session.sign(this.#secretNonce, participantSecretKey);
    } finally {
      this.clearSecrets();
    }
  }

  /**
   * Zeroize any retained secret nonce. Safe to call repeatedly and on any path
   * (completion, failure, or teardown of an abandoned session). Callers that
   * drop a session before it reaches a partial signature should invoke this so
   * the secret nonce does not linger on the live object.
   */
  public clearSecrets(): void {
    if(this.#secretNonce) {
      wipe(this.#secretNonce);
      this.#secretNonce = undefined;
    }
  }

  public isComplete(): boolean {
    return this.phase === SigningSessionPhase.Complete;
  }

  public isFailed(): boolean {
    return this.phase === SigningSessionPhase.Failed;
  }
}
