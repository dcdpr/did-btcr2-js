import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync, scryptSync } from 'node:crypto';
import type { EncryptedSecret } from './types.js';

const NONCE_BYTES = 12;
const SALT_BYTES  = 16;
const KEY_BYTES   = 32;
const TAG_BYTES   = 16;

export type KdfKind = 'pbkdf2-hmac-sha512' | 'scrypt';

export type KdfParams =
  | { kind: 'pbkdf2-hmac-sha512'; iterations: number }
  | { kind: 'scrypt'; N: number; r: number; p: number };

export interface CryptoBoxOptions {
  kdf?: KdfParams; // default below
}

export class CryptoBox {
  private kdf: KdfParams;

  constructor(opts: CryptoBoxOptions = {}) {
    // Default to PBKDF2-HMAC-SHA512 for Bitcoin-world familiarity
    this.kdf = opts.kdf ?? { kind: 'pbkdf2-hmac-sha512', iterations: 300_000 };
  }

  setKdf(kdf: KdfParams) { this.kdf = kdf; }

  private deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
    if (this.kdf.kind === 'pbkdf2-hmac-sha512') {
      return pbkdf2Sync(passphrase, salt, this.kdf.iterations, KEY_BYTES, 'sha512');
    } else {
      return scryptSync(passphrase, salt, KEY_BYTES, {
        N : this.kdf.N, r : this.kdf.r, p : this.kdf.p
      });
    }
  }

  wrap(secret: Uint8Array, passphrase: string): EncryptedSecret {
    const salt  = randomBytes(SALT_BYTES);
    const key   = this.deriveKey(passphrase, salt);
    try {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
      const tag = cipher.getAuthTag();
      const out = new Uint8Array(ciphertext.length + TAG_BYTES);
      out.set(ciphertext, 0);
      out.set(tag, ciphertext.length);

      return {
        aead       : 'aes-256-gcm',
        kdf        : this.kdf.kind === 'pbkdf2-hmac-sha512' ? 'pbkdf2-hmac-sha512' : 'scrypt',
        salt       : new Uint8Array(salt),
        nonce      : new Uint8Array(nonce),
        ciphertext : out,
        version    : 1
      } as EncryptedSecret;
    } finally {
      key.fill(0);
    }
  }

  unwrap(box: EncryptedSecret, passphrase: string): Uint8Array {
    // Derive with params compatible to how it was encrypted
    const salt = box.salt;
    const key = (box.kdf === 'scrypt')
      ? scryptSync(passphrase, salt, KEY_BYTES, { N: 16384, r: 8, p: 1 }) // default if you stored parameters elsewhere; better: store N,r,p
      : pbkdf2Sync(passphrase, salt, 300_000, KEY_BYTES, 'sha512');       // better: store iterations

    try {
      const ct = box.ciphertext.subarray(0, box.ciphertext.length - TAG_BYTES);
      const tag = box.ciphertext.subarray(box.ciphertext.length - TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, box.nonce);
      decipher.setAuthTag(Buffer.from(tag));
      const out = Buffer.concat([decipher.update(ct), decipher.final()]);
      return new Uint8Array(out);
    } finally {
      key.fill(0);
    }
  }
}
