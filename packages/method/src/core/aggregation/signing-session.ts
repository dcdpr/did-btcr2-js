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

  /** Map of participant publicKey-hex → public nonce contribution. */
  public nonceContributions: Map<PublicKeyHex, Nonce> = new Map();

  /** Aggregated MuSig2 nonce (66 bytes). */
  public aggregatedNonce?: Uint8Array;

  /** Map of participant DID → partial signature. */
  public partialSignatures: Map<string, Uint8Array> = new Map();

  /** Final 64-byte Schnorr signature. */
  public signature?: Uint8Array;

  /** Current signing session phase. */
  public phase: SigningSessionPhaseType;

  /** Participant's secret nonce (held only by the participant during signing). */
  public secretNonce?: Uint8Array;

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
    const session = new musig2.Session(
      this.aggregatedNonce,
      this.cohort.cohortKeys,
      this.sigHash,
      [this.cohort.trMerkleRoot],
      [true]
    );
    this.signature = session.partialSigAgg([...this.partialSignatures.values()]);
    this.phase = SigningSessionPhase.Complete;
    return this.signature;
  }

  /**
   * Generates a fresh MuSig2 nonce contribution for the participant.
   * Stores the secret nonce internally for use in `generatePartialSignature()`.
   */
  public generateNonceContribution(participantPublicKey: Uint8Array, participantSecretKey: Uint8Array): Uint8Array {
    const aggPublicKey = musig2.keyAggExport(musig2.keyAggregate(this.cohort.cohortKeys));
    const nonces = musig2.nonceGen(participantPublicKey, participantSecretKey, aggPublicKey);
    this.secretNonce = nonces.secret;
    return nonces.public;
  }

  /**
   * Generates a partial signature using the participant's secret key + secret nonce.
   * Requires the aggregated nonce to have been set first (via the service).
   */
  public generatePartialSignature(participantSecretKey: Uint8Array): Uint8Array {
    if(!this.aggregatedNonce) {
      throw new SigningSessionError('Aggregated nonce not available.', 'MISSING_AGGREGATED_NONCE');
    }
    if(!this.secretNonce) {
      throw new SigningSessionError('Secret nonce not available — generateNonceContribution() must be called first.', 'MISSING_SECRET_NONCE');
    }
    const session = new musig2.Session(
      this.aggregatedNonce,
      this.cohort.cohortKeys,
      this.sigHash,
      [this.cohort.trMerkleRoot],
      [true]
    );
    return session.sign(this.secretNonce, participantSecretKey);
  }

  public isComplete(): boolean {
    return this.phase === SigningSessionPhase.Complete;
  }

  public isFailed(): boolean {
    return this.phase === SigningSessionPhase.Failed;
  }
}
