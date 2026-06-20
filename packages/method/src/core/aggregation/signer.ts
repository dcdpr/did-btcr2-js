import type { SchnorrKeyPair } from '@did-btcr2/keypair';
import { wipe } from '@did-btcr2/keypair';

/**
 * A signing capability for MuSig2 aggregation.
 *
 * MuSig2 (BIP-327) cannot be driven through a generic `sign(message)` primitive:
 * both nonce generation and partial signing need the raw 32-byte secret scalar
 * (see ADR 038). Rather than hand that scalar around as a long-lived field, the
 * participant holds an `AggregationSigner` and materializes the secret only for
 * the duration of a single operation via {@link AggregationSigner.withSecret},
 * which is responsible for wiping its working copy afterward.
 *
 * This is the seam a non-extractable / KMS-backed signer (or a session-scoped
 * signer that destroys its key after the cohort completes) plugs into without
 * changing the participant state machine.
 *
 * @interface AggregationSigner
 */
export interface AggregationSigner {
  /** Compressed 33-byte public key. Not secret; always available. */
  readonly publicKey: Uint8Array;

  /**
   * Materialize the raw 32-byte secret key, pass it to `fn`, and zeroize the
   * working copy before returning - even if `fn` throws. The secret must not
   * escape the callback.
   *
   * @typeParam T The callback's return type (e.g. a nonce contribution or partial signature).
   * @param {(secretKey: Uint8Array) => T} fn Operation that needs the raw secret for its duration.
   * @returns {T} Whatever `fn` returns.
   */
  withSecret<T>(fn: (secretKey: Uint8Array) => T): T;
}

/**
 * {@link AggregationSigner} backed by an in-memory {@link SchnorrKeyPair}.
 *
 * The keypair is held privately (never exposed as a public field) and each
 * `withSecret` call pulls a fresh copy of the secret bytes, hands it to the
 * callback, and wipes that copy on return. The underlying keypair is the
 * caller's to own and destroy; this signer never mutates or destroys it.
 *
 * @class KeyPairAggregationSigner
 * @implements {AggregationSigner}
 */
export class KeyPairAggregationSigner implements AggregationSigner {
  readonly publicKey: Uint8Array;
  readonly #keys: SchnorrKeyPair;

  /** @param {SchnorrKeyPair} keys The keypair whose secret backs this signer. */
  constructor(keys: SchnorrKeyPair) {
    this.#keys = keys;
    this.publicKey = keys.publicKey.compressed;
  }

  withSecret<T>(fn: (secretKey: Uint8Array) => T): T {
    // `.bytes` returns a fresh copy; wipe it once the operation completes so the
    // raw scalar does not linger on the heap beyond a single MuSig2 step.
    const secretKey = this.#keys.secretKey.bytes;
    try {
      return fn(secretKey);
    } finally {
      wipe(secretKey);
    }
  }
}
