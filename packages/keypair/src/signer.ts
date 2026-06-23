import type { Bytes, KeyBytes, SignatureBytes } from '@did-btcr2/common';
import { KeyPairError } from '@did-btcr2/common';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { taprootTweakPrivKey } from '@scure/btc-signer/utils.js';
import { Secp256k1SecretKey } from './secret.js';

/**
 * Sign `data` with a 32-byte raw secret key under the requested scheme. The
 * single source of truth for the prehash / lowS / taproot-tweak contract that
 * both {@link LocalSigner} (in this package) and `LocalKeyManager` (in
 * `@did-btcr2/key-manager`) need to honour.
 *
 * The caller passes secret bytes directly because both consumers already hold
 * them in scope: this helper is plumbing, not a key store. External KeyManager
 * implementations (HSM, cloud KMS) typically have their own native dispatch
 * and do not need to use this function.
 *
 * - `'ecdsa'`  : `data` must already be a 32-byte sighash. `prehash: false`,
 *   `lowS: true`, DER-encoded output. CHECKSIG verifies signatures over the
 *   sighash directly; if `prehash` were left at noble's default `true`, the
 *   library would SHA-256 the sighash again and produce a signature over the
 *   wrong message.
 * - `'bip340'` : raw BIP-340 Schnorr over the *untweaked* secret with random
 *   aux_rand. Used for Data Integrity proofs.
 * - `'bip341'` : BIP-341 taproot key-path. The secret is tweaked by
 *   `taprootTweakPrivKey(d, merkleRoot ?? empty)`; the resulting Schnorr
 *   signature verifies against the tweaked output internal key `Q = P + tG`.
 *   Pass `opts.merkleRoot` to commit to a script tree, or omit / pass `null`
 *   for key-path-only spending.
 *
 * @throws {KeyPairError} when `scheme` is not one of the three above.
 */
export function signWithScheme(
  secretKey: KeyBytes,
  data: Bytes,
  scheme: SigningScheme,
  opts?: SignOptions,
): SignatureBytes {
  if(scheme === 'ecdsa') {
    return secp256k1.sign(data, secretKey, {
      format  : 'der',
      lowS    : true,
      prehash : false,
    });
  }
  if(scheme === 'bip340') {
    return schnorr.sign(data, secretKey, randomBytes(32));
  }
  if(scheme === 'bip341') {
    const tweaked = taprootTweakPrivKey(
      secretKey,
      opts?.merkleRoot ?? new Uint8Array(0),
    );
    return schnorr.sign(data, tweaked, randomBytes(32));
  }
  throw new KeyPairError(
    `signWithScheme: unsupported signing scheme: ${scheme as string}`,
    'SIGN_ERROR'
  );
}

/**
 * Signature schemes supported by a {@link Signer}.
 *
 * - `'ecdsa'`  : DER-encoded, low-S ECDSA over secp256k1. Used by P2PKH and
 *   P2WPKH (BIP-143) Bitcoin inputs.
 * - `'bip340'` : Raw BIP-340 Schnorr signature using the *untweaked* secret
 *   key. Used by Data Integrity proofs and any other BIP-340-over-message
 *   context (NOT for Bitcoin taproot inputs, those need `'bip341'`).
 * - `'bip341'` : BIP-341 taproot key-path Schnorr signature. The signer
 *   applies the per-output tweak `t = H_taptweak(P || merkleRoot)` to the
 *   secret before signing, so the resulting signature verifies against the
 *   tweaked output internal key `Q = P + tG` that the P2TR scriptPubKey
 *   encodes. Pass `opts.merkleRoot` to commit to a script tree, or omit /
 *   pass `null` for key-path-only spending.
 */
export type SigningScheme = 'ecdsa' | 'bip340' | 'bip341';

/** Options for the unified {@link Signer.sign} method. */
export interface SignOptions {
  /**
   * Merkle root of the taproot script tree. Only consumed when
   * `scheme === 'bip341'`. Pass `null` or omit for key-path-only spending
   * (no script tree); pass the 32-byte tap-tweak input for a committed tree.
   * Ignored for `'ecdsa'` and `'bip340'`.
   */
  merkleRoot?: Bytes | null;
}

/**
 * Abstract signer over secp256k1. The DID method's update path and the beacon
 * broadcast path both depend on a `Signer` rather than raw secret-key bytes,
 * so callers can wire in any key store behind a single interface: keys held
 * locally in this process, in a KMS, in an HSM, in a hardware wallet, in a
 * browser extension, or behind a remote signing service.
 *
 * Built-in implementations:
 * - {@link LocalSigner}: secret key bytes in this process's heap.
 * - `KeyManagerSigner` (in `@did-btcr2/key-manager`): secret key managed by a `KeyManager`.
 *
 * Custom signers should sign deterministically when possible and must produce
 * signatures compatible with `@noble/curves` for the requested scheme.
 *
 * @interface Signer
 */
export interface Signer {
  /** Compressed secp256k1 public key bytes (33 bytes). */
  readonly publicKey: KeyBytes;

  /**
   * Sign the given data with the requested scheme. See {@link SigningScheme}
   * for the contract of each scheme. The signer is responsible for any
   * key-derivation step that the scheme requires (BIP-341 taproot tweak); the
   * caller never sees the secret.
   *
   * The caller is responsible for hashing `data` to the correct digest before
   * passing it in - no scheme prehashes internally.
   *
   * @param data Bytes to sign.
   * @param scheme Signature scheme.
   * @param opts Scheme-specific options. Only `'bip341'` consumes `merkleRoot`.
   * @returns Signature bytes.
   */
  sign(data: Bytes, scheme: SigningScheme, opts?: SignOptions): SignatureBytes;
}

/**
 * {@link Signer} that holds a 32-byte secret key inside the current JS process
 * heap. "Local" because the secret material is in-process: convenient for tests,
 * scripts, and any caller that has already loaded the key into memory.
 *
 * Production callers whose keys live outside the process (KMS, HSM, hardware
 * wallet, browser extension) should use `KeyManagerSigner` from
 * `@did-btcr2/key-manager` or implement {@link Signer} against their own key
 * store.
 *
 * @class LocalSigner
 * @implements {Signer}
 */
export class LocalSigner implements Signer {
  readonly #secretKey: Secp256k1SecretKey;
  readonly #publicKey: KeyBytes;

  /**
   * @param secretKey Raw 32-byte secret key. A defensive copy is made before
   * use so that mutating the caller's buffer after construction does not
   * affect this signer.
   */
  constructor(secretKey: KeyBytes) {
    if(!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
      throw new KeyPairError(
        'LocalSigner: secret key must be a 32-byte Uint8Array.',
        'CONSTRUCTOR_ERROR'
      );
    }
    this.#secretKey = new Secp256k1SecretKey(new Uint8Array(secretKey));
    this.#publicKey = this.#secretKey.computePublicKey().compressed;
  }

  /** Compressed secp256k1 public key bytes (33 bytes). */
  get publicKey(): KeyBytes {
    return new Uint8Array(this.#publicKey);
  }

  /**
   * Sign the given data. See {@link SigningScheme}:
   * - `'ecdsa'`  : DER-encoded, low-S ECDSA over secp256k1
   * - `'bip340'` : raw BIP-340 Schnorr (no tweak) with random aux_rand
   * - `'bip341'` : taproot tweak applied to the secret, then BIP-340 Schnorr
   *
   * Delegates to {@link signWithScheme}: the dispatch contract lives in one
   * place so this signer and `LocalKeyManager` cannot drift.
   */
  sign(data: Bytes, scheme: SigningScheme, opts?: SignOptions): SignatureBytes {
    return signWithScheme(this.#secretKey.bytes, data, scheme, opts);
  }
}
