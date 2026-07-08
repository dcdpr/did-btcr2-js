import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  changeKeystorePassphrase,
  FileKeyStore,
  initKeystore,
  keystoreProtection,
  keystoreSummary,
} from '../src/keystore/file-key-store.js';
import type { ArgonParams } from '../src/keystore/envelope.js';
import { KeyStoreError } from '../src/keystore/error.js';
import { expect } from './helpers.js';

/** Low-cost argon2id so the lifecycle tests do not pay the production key-derivation cost. */
const FAST: ArgonParams = { t: 1, m: 256, p: 1, dkLen: 32 };

const SECRET = new Uint8Array(32).fill(7);
const PUBLIC = new Uint8Array(33).fill(2);
const ID = 'urn:kms:secp256k1:testkey';
const ID2 = 'urn:kms:secp256k1:testkey2';

describe('keystore lifecycle (ADR 080)', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'btcr2-kslife-'));
    path = join(dir, 'keystore.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function readFile(): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  describe('dev (unencrypted) keystore', () => {
    it('round-trips a secret with no passphrase prompt', () => {
      const never = (): string => { throw new Error('passphrase must never be requested for a dev keystore'); };
      const store = new FileKeyStore({ path, protection: 'none', getPassphrase: never });
      store.set(ID, { publicKey: PUBLIC, secretKey: SECRET });

      // Stored in the clear, marked as a dev keystore.
      const file = readFile();
      expect(file.protection).to.equal('none');
      expect((file.keys as Record<string, { plainSecret?: string; secret?: unknown }>)[ID].plainSecret).to.be.a('string');
      expect((file.keys as Record<string, { secret?: unknown }>)[ID].secret).to.equal(undefined);

      // A fresh store (new process) reads the secret back without a prompt.
      const reopened = new FileKeyStore({ path, getPassphrase: never });
      const entry = reopened.get(ID);
      expect(entry?.secretKey).to.deep.equal(SECRET);
    });

    it('is reported as dev by keystoreProtection', () => {
      initKeystore(path, { protection: 'none', getPassphrase: () => 'unused' });
      expect(keystoreProtection(path)).to.equal('dev');
    });
  });

  describe('first passphrase is confirmed', () => {
    it('requests confirm on the establishing seal only', () => {
      const confirmSeen: boolean[] = [];
      const getPassphrase = (opts?: { confirm?: boolean }): string => {
        confirmSeen.push(Boolean(opts?.confirm));
        return 'correct-horse';
      };
      const store = new FileKeyStore({ path, argonParams: FAST, getPassphrase });
      store.set(ID, { publicKey: PUBLIC, secretKey: SECRET });   // establishing -> confirm
      store.set(ID2, { publicKey: PUBLIC, secretKey: SECRET });  // established -> no confirm
      expect(confirmSeen[0]).to.equal(true);
      expect(confirmSeen[1]).to.equal(false);
      // A verifier was written when the passphrase was established.
      expect(readFile().verifier).to.be.an('object');
    });

    it('does not write a key when the confirmation fails on establishment', () => {
      const getPassphrase = (opts?: { confirm?: boolean }): string => {
        if (opts?.confirm) throw new KeyStoreError('Passphrases did not match.', 'PASSPHRASE_MISMATCH_ERROR');
        return 'x';
      };
      const store = new FileKeyStore({ path, argonParams: FAST, getPassphrase });
      expect(() => store.set(ID, { publicKey: PUBLIC, secretKey: SECRET }))
        .to.throw(KeyStoreError, /did not match/);
      // Nothing was persisted: the establishing seal aborted before the flush.
      const reopened = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'x' });
      expect(reopened.list()).to.deep.equal([]);
    });
  });

  describe('a wrong passphrase fails loudly against an established keystore', () => {
    it('rejects a wrong passphrase before sealing a second key', () => {
      new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'correct' })
        .set(ID, { publicKey: PUBLIC, secretKey: SECRET });

      // A second invocation with the wrong passphrase must throw, and must not
      // seal the second key under a divergent passphrase.
      const wrong = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'wrong' });
      expect(() => wrong.set(ID2, { publicKey: PUBLIC, secretKey: SECRET }))
        .to.throw(KeyStoreError, /Incorrect passphrase/);

      const reopened = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'correct' });
      expect(reopened.list()).to.have.length(1);
      expect(reopened.get(ID)?.secretKey).to.deep.equal(SECRET);
    });

    it('rejects a wrong passphrase when opening an existing secret', () => {
      new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'correct' })
        .set(ID, { publicKey: PUBLIC, secretKey: SECRET });
      const wrong = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'wrong' });
      expect(() => wrong.get(ID)?.secretKey).to.throw(KeyStoreError, /Incorrect passphrase/);
    });
  });

  describe('change-passphrase', () => {
    it('re-seals every key so the new passphrase opens them and the old does not', () => {
      const store = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'old-pass' });
      store.set(ID, { publicKey: PUBLIC, secretKey: SECRET });
      store.set(ID2, { publicKey: PUBLIC, secretKey: new Uint8Array(32).fill(9) });

      const rekeyed = changeKeystorePassphrase(path, 'old-pass', 'new-pass', FAST);
      expect(rekeyed).to.equal(2);

      const withNew = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'new-pass' });
      expect(withNew.get(ID)?.secretKey).to.deep.equal(SECRET);

      const withOld = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'old-pass' });
      expect(() => withOld.get(ID)?.secretKey).to.throw(KeyStoreError, /Incorrect passphrase/);
    });

    it('rejects a wrong current passphrase and leaves keys unchanged', () => {
      new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'old-pass' })
        .set(ID, { publicKey: PUBLIC, secretKey: SECRET });
      expect(() => changeKeystorePassphrase(path, 'not-the-old-pass', 'new-pass', FAST))
        .to.throw(KeyStoreError, /Incorrect/);
      // The original passphrase still opens the key.
      const store = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'old-pass' });
      expect(store.get(ID)?.secretKey).to.deep.equal(SECRET);
    });

    it('refuses to change the passphrase of a dev keystore', () => {
      initKeystore(path, { protection: 'none', getPassphrase: () => 'unused' });
      expect(() => changeKeystorePassphrase(path, 'a', 'b', FAST))
        .to.throw(KeyStoreError, /dev keystore/);
    });
  });

  describe('initKeystore and keystoreSummary', () => {
    it('establishes an empty encrypted keystore with a verifier', () => {
      initKeystore(path, { protection: 'passphrase', argonParams: FAST, getPassphrase: () => 'pw' });
      const summary = keystoreSummary(path);
      expect(summary.protection).to.equal('encrypted');
      expect(summary.established).to.equal(true);
      expect(summary.keyCount).to.equal(0);
      expect(readFile().verifier).to.be.an('object');
    });

    it('reports absent for a missing keystore', () => {
      expect(keystoreSummary(path)).to.deep.equal({ protection: 'absent', established: false, keyCount: 0, active: undefined });
    });

    it('refuses to load a keystore with no recognized protection header', () => {
      // A file this CLI never writes (protection header stripped) is not silently
      // treated as encrypted: opening it is refused rather than guessed at.
      const store = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'pw' });
      store.set(ID, { publicKey: PUBLIC, secretKey: SECRET });
      const file = readFile();
      delete file.protection;
      writeFileSync(path, JSON.stringify(file));
      expect(() => new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'pw' }))
        .to.throw(KeyStoreError, /protection header/i);
    });

    it('refuses an encrypted keystore that holds sealed keys but no verifier', () => {
      const store = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'pw' });
      store.set(ID, { publicKey: PUBLIC, secretKey: SECRET });
      const file = readFile();
      delete file.verifier; // protection stays 'passphrase'
      writeFileSync(path, JSON.stringify(file));
      expect(() => new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'pw' }))
        .to.throw(KeyStoreError, /verifier/i);
    });

    it('refuses a plaintext secret inside an encrypted keystore (tamper guard)', () => {
      const store = new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'pw' });
      store.set(ID, { publicKey: PUBLIC, secretKey: SECRET });
      const file = readFile();
      const keys = file.keys as Record<string, { secret?: unknown; plainSecret?: string }>;
      delete keys[ID].secret;
      keys[ID].plainSecret = 'AAAA'; // rejected before it is ever decoded
      writeFileSync(path, JSON.stringify(file));
      expect(() => new FileKeyStore({ path, argonParams: FAST, getPassphrase: () => 'pw' }))
        .to.throw(KeyStoreError, /plaintext secret in an encrypted keystore/i);
    });

    it('reports a header-less file as absent without throwing (keystoreSummary is safe)', () => {
      writeFileSync(path, JSON.stringify({ v: 1, keys: {} }));
      expect(keystoreSummary(path).protection).to.equal('absent');
    });
  });
});
