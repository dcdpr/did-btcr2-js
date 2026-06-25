import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import { KeyStoreError } from './error.js';

/** Current keystore secret-envelope format version. */
export const ENVELOPE_VERSION = 1 as const;

/** Random salt length in bytes for argon2id. */
const SALT_BYTES = 16;
/** XChaCha20-Poly1305 extended nonce length in bytes (safe with random nonces). */
const NONCE_BYTES = 24;
/** Derived symmetric key length in bytes (the XChaCha20-Poly1305 key size). */
const KEY_BYTES = 32;

/**
 * argon2id cost parameters. Field names follow RFC 9106: `t` time cost
 * (passes), `m` memory cost in KiB, `p` parallelism (lanes), `dkLen` derived
 * key length in bytes.
 */
export type ArgonParams = {
  t     : number;
  m     : number;
  p     : number;
  dkLen : number;
};

/**
 * Production argon2id parameters: 3 passes over 64 MiB across 4 lanes, deriving
 * a 32-byte key. Recorded in every envelope so the cost can be raised later
 * without making previously sealed envelopes undecryptable.
 */
export const DEFAULT_ARGON_PARAMS: ArgonParams = { t: 3, m: 65536, p: 4, dkLen: KEY_BYTES };

/**
 * A self-describing, versioned envelope sealing one secret at rest. The header
 * (version, key-derivation parameters, cipher) is bound as the AEAD additional
 * data, so a tampered header fails authentication. All byte fields are
 * base64url with no padding.
 */
export type SecretEnvelope = {
  v   : typeof ENVELOPE_VERSION;
  kdf : {
    alg   : 'argon2id';
    salt  : string;
    t     : number;
    m     : number;
    p     : number;
    dkLen : number;
  };
  cipher     : 'xchacha20poly1305';
  nonce      : string;
  ciphertext : string;
};

/** The header bound as AEAD additional data (everything except nonce and ciphertext). */
type EnvelopeHeader = Pick<SecretEnvelope, 'v' | 'kdf' | 'cipher'>;

/**
 * Builds the header with a fixed key order so the additional-data bytes are
 * byte-identical on the encrypt and decrypt paths.
 */
function buildHeader(saltB64: string, params: ArgonParams): EnvelopeHeader {
  return {
    v   : ENVELOPE_VERSION,
    kdf : {
      alg   : 'argon2id',
      salt  : saltB64,
      t     : params.t,
      m     : params.m,
      p     : params.p,
      dkLen : params.dkLen,
    },
    cipher : 'xchacha20poly1305',
  };
}

/** Serializes the header into the AEAD additional-data byte string. */
function headerAad(header: EnvelopeHeader): Uint8Array {
  return utf8ToBytes(JSON.stringify(header));
}

/**
 * Stretches a passphrase into the symmetric key. The transient UTF-8 copy of
 * the passphrase is zeroized here; the caller is responsible for zeroizing the
 * returned key after use.
 */
function deriveKey(passphrase: string, salt: Uint8Array, params: ArgonParams): Uint8Array {
  const password = utf8ToBytes(passphrase);
  try {
    return argon2id(password, salt, { t: params.t, m: params.m, p: params.p, dkLen: params.dkLen });
  } finally {
    password.fill(0);
  }
}

/**
 * Seals a secret under a passphrase into a {@link SecretEnvelope}. A fresh
 * random salt and nonce are generated per call, so encrypting the same secret
 * twice yields different envelopes.
 *
 * @param secret - The secret bytes to encrypt. Must be non-empty.
 * @param passphrase - The passphrase the encryption key is derived from.
 * @param params - argon2id cost parameters. Defaults to {@link DEFAULT_ARGON_PARAMS}.
 * @returns The versioned, authenticated envelope.
 * @throws {KeyStoreError} `ENVELOPE_ENCRYPT_ERROR` when `secret` is empty.
 */
export function encryptSecret(
  secret     : Uint8Array,
  passphrase : string,
  params     : ArgonParams = DEFAULT_ARGON_PARAMS,
): SecretEnvelope {
  if (secret.length === 0) {
    throw new KeyStoreError('Cannot encrypt an empty secret.', 'ENVELOPE_ENCRYPT_ERROR');
  }
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const header = buildHeader(base64urlnopad.encode(salt), params);
  const key = deriveKey(passphrase, salt, params);
  try {
    const ciphertext = xchacha20poly1305(key, nonce, headerAad(header)).encrypt(secret);
    return {
      ...header,
      nonce      : base64urlnopad.encode(nonce),
      ciphertext : base64urlnopad.encode(ciphertext),
    };
  } finally {
    key.fill(0);
  }
}

/**
 * Opens a {@link SecretEnvelope} sealed by {@link encryptSecret} and returns the
 * plaintext secret. A wrong passphrase, corrupted ciphertext, or a tampered
 * header all fail authentication and raise `DECRYPT_ERROR`.
 *
 * @param env - The envelope to open.
 * @param passphrase - The passphrase the envelope was sealed with.
 * @returns The decrypted secret bytes.
 * @throws {KeyStoreError} `ENVELOPE_VERSION_ERROR` for an unknown version or
 *   algorithm; `DECRYPT_ERROR` for failed authentication.
 */
export function decryptSecret(env: SecretEnvelope, passphrase: string): Uint8Array {
  if (env.v !== ENVELOPE_VERSION) {
    throw new KeyStoreError(
      `Unsupported keystore envelope version: ${String(env.v)}.`,
      'ENVELOPE_VERSION_ERROR',
      { version: env.v },
    );
  }
  if (env.kdf?.alg !== 'argon2id' || env.cipher !== 'xchacha20poly1305') {
    throw new KeyStoreError('Unsupported keystore envelope algorithm.', 'ENVELOPE_VERSION_ERROR');
  }
  const params: ArgonParams = { t: env.kdf.t, m: env.kdf.m, p: env.kdf.p, dkLen: env.kdf.dkLen };
  const salt = base64urlnopad.decode(env.kdf.salt);
  const nonce = base64urlnopad.decode(env.nonce);
  const ciphertext = base64urlnopad.decode(env.ciphertext);
  const header = buildHeader(env.kdf.salt, params);
  const key = deriveKey(passphrase, salt, params);
  try {
    return xchacha20poly1305(key, nonce, headerAad(header)).decrypt(ciphertext);
  } catch (error) {
    if (error instanceof KeyStoreError) throw error;
    throw new KeyStoreError(
      'Keystore decryption failed: wrong passphrase or corrupted keystore.',
      'DECRYPT_ERROR',
    );
  } finally {
    key.fill(0);
  }
}
