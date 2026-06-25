import { decryptSecret, encryptSecret } from '../src/keystore/envelope.js';
import type { ArgonParams, SecretEnvelope } from '../src/keystore/envelope.js';
import { KeyStoreError } from '../src/keystore/error.js';
import { expect } from './helpers.js';

// Low-cost argon2id parameters for fast tests. The production defaults (64 MiB)
// would push a spec that runs several derivations past the 5s mocha timeout.
// The envelope records its own parameters, so a low-cost test vector decrypts
// without touching the production defaults.
const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };

const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i);
const PASS = 'correct horse battery staple';

/** Flips the first base64url character of a field to corrupt its decoded bytes. */
function tamper(env: SecretEnvelope, field: 'ciphertext' | 'nonce'): SecretEnvelope {
  const value = env[field];
  const swapped = value[0] === 'A' ? 'B' : 'A';
  return { ...env, [field]: swapped + value.slice(1) };
}

describe('keystore envelope', () => {
  it('round-trips a secret', () => {
    const env = encryptSecret(SECRET, PASS, FAST);
    const out = decryptSecret(env, PASS);
    expect(Array.from(out)).to.deep.equal(Array.from(SECRET));
  });

  it('produces a self-describing, versioned envelope', () => {
    const env = encryptSecret(SECRET, PASS, FAST);
    expect(env.v).to.equal(1);
    expect(env.kdf.alg).to.equal('argon2id');
    expect(env.cipher).to.equal('xchacha20poly1305');
    expect(env.kdf).to.include({ t: 1, m: 256, p: 1, dkLen: 32 });
    expect(env.kdf.salt).to.be.a('string').with.length.greaterThan(0);
    expect(env.nonce).to.be.a('string').with.length.greaterThan(0);
    expect(env.ciphertext).to.be.a('string').with.length.greaterThan(0);
  });

  it('rejects an empty secret', () => {
    expect(() => encryptSecret(new Uint8Array(0), PASS, FAST))
      .to.throw(KeyStoreError).with.property('type', 'ENVELOPE_ENCRYPT_ERROR');
  });

  it('rejects a wrong passphrase', () => {
    const env = encryptSecret(SECRET, PASS, FAST);
    expect(() => decryptSecret(env, 'wrong passphrase'))
      .to.throw(KeyStoreError).with.property('type', 'DECRYPT_ERROR');
  });

  it('rejects tampered ciphertext', () => {
    const env = encryptSecret(SECRET, PASS, FAST);
    expect(() => decryptSecret(tamper(env, 'ciphertext'), PASS))
      .to.throw(KeyStoreError).with.property('type', 'DECRYPT_ERROR');
  });

  it('rejects a tampered nonce', () => {
    const env = encryptSecret(SECRET, PASS, FAST);
    expect(() => decryptSecret(tamper(env, 'nonce'), PASS))
      .to.throw(KeyStoreError).with.property('type', 'DECRYPT_ERROR');
  });

  it('rejects a tampered header (KDF parameter)', () => {
    const env = encryptSecret(SECRET, PASS, FAST);
    const tampered: SecretEnvelope = { ...env, kdf: { ...env.kdf, t: env.kdf.t + 1 } };
    expect(() => decryptSecret(tampered, PASS))
      .to.throw(KeyStoreError).with.property('type', 'DECRYPT_ERROR');
  });

  it('rejects an unknown envelope version', () => {
    const env = encryptSecret(SECRET, PASS, FAST);
    const tampered = { ...env, v: 2 } as unknown as SecretEnvelope;
    expect(() => decryptSecret(tampered, PASS))
      .to.throw(KeyStoreError).with.property('type', 'ENVELOPE_VERSION_ERROR');
  });

  it('uses a fresh salt and nonce per encryption', () => {
    const a = encryptSecret(SECRET, PASS, FAST);
    const b = encryptSecret(SECRET, PASS, FAST);
    expect(a.kdf.salt).to.not.equal(b.kdf.salt);
    expect(a.nonce).to.not.equal(b.nonce);
    expect(a.ciphertext).to.not.equal(b.ciphertext);
  });
});
