import { KeyManagerError } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, SchnorrKeyPair } from '@did-btcr2/keypair';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { expect } from 'chai';
import { KeyManagerSigner, LocalKeyManager } from '../src/index.js';

describe('KeyManagerSigner', () => {
  describe('publicKey', () => {
    it('returns the compressed public key for the supplied id', () => {
      const kms = new LocalKeyManager();
      const kp = SchnorrKeyPair.generate();
      const id = kms.importKey(kp);

      const signer = new KeyManagerSigner(kms, id);
      expect(Array.from(signer.publicKey)).to.deep.equal(Array.from(kp.publicKey.compressed));
    });

    it('falls back to the active key when no id is supplied', () => {
      const kms = new LocalKeyManager();
      const kp = SchnorrKeyPair.generate();
      kms.importKey(kp, { setActive: true });

      const signer = new KeyManagerSigner(kms);
      expect(Array.from(signer.publicKey)).to.deep.equal(Array.from(kp.publicKey.compressed));
    });

    it('throws when no id is supplied and no active key is set', () => {
      const kms = new LocalKeyManager();
      const signer = new KeyManagerSigner(kms);
      expect(() => signer.publicKey).to.throw(KeyManagerError, /No active key/i);
    });

    it('constructor throws when the supplied id does not exist (fail-fast)', () => {
      const kms = new LocalKeyManager();
      // With eager resolution, the bad id surfaces at construction time, not at
      // first publicKey/sign access. Catches typos and stale ids before any
      // downstream work (UTXO selection, etc.) has been spent.
      expect(() => new KeyManagerSigner(kms, 'urn:kms:secp256k1:nonexistent'))
        .to.throw(KeyManagerError, /not found/i);
    });

    it('constructor without keyId defers active-key resolution to first access', () => {
      // No keyId means "use whatever is active at sign-time". Constructor must
      // not eagerly probe — there might be no active key yet.
      const kms = new LocalKeyManager();
      expect(() => new KeyManagerSigner(kms)).to.not.throw();
    });
  });

  describe('sign', () => {
    it('produces a verifiable bip340 signature delegating through LocalKeyManager', () => {
      const kms = new LocalKeyManager();
      const kp = SchnorrKeyPair.generate();
      const id = kms.importKey(kp);

      const signer = new KeyManagerSigner(kms, id);
      const msg = sha256(utf8ToBytes('kms-signer bip340 round-trip'));
      const sig = signer.sign(msg, 'bip340');

      expect(sig).to.be.instanceOf(Uint8Array);
      expect(sig.length).to.equal(64);
      expect(kp.publicKey.verify(sig, msg, { scheme: 'schnorr' })).to.be.true;
    });

    it('produces an ecdsa signature that the LocalKeyManager verifier accepts', () => {
      const kms = new LocalKeyManager();
      const kp = SchnorrKeyPair.generate();
      const id = kms.importKey(kp);

      const signer = new KeyManagerSigner(kms, id);
      const digest = sha256(utf8ToBytes('kms-signer ecdsa round-trip'));
      const sig = signer.sign(digest, 'ecdsa');

      expect(sig).to.be.instanceOf(Uint8Array);
      // The LocalKeyManager's own verify path is the ground-truth round-trip.
      expect(kms.verify(sig, digest, id, { scheme: 'ecdsa' })).to.be.true;
    });

    it('signs with the active key when no id is supplied', () => {
      const kms = new LocalKeyManager();
      const kp = SchnorrKeyPair.generate();
      kms.importKey(kp, { setActive: true });

      const signer = new KeyManagerSigner(kms);
      const msg = sha256(utf8ToBytes('active key signing'));
      const sig = signer.sign(msg, 'bip340');
      expect(kp.publicKey.verify(sig, msg, { scheme: 'schnorr' })).to.be.true;
    });

    it('throws when wrapping a watch-only entry (public key only)', () => {
      const kms = new LocalKeyManager();
      const kp = SchnorrKeyPair.generate();
      // Build a public-key-only KeyPair and import it as a watch-only entry.
      const watchOnly = new SchnorrKeyPair({ publicKey: kp.publicKey });
      const id = kms.importKey(watchOnly);

      const signer = new KeyManagerSigner(kms, id);
      const msg = sha256(utf8ToBytes('watch-only sign attempt'));
      expect(() => signer.sign(msg, 'bip340'))
        .to.throw(KeyManagerError, /not a signing key/i);
    });

    it('parity: KeyManagerSigner signature verifies with the same key as direct keyManager.sign', () => {
      const kms = new LocalKeyManager();
      const kp = SchnorrKeyPair.generate();
      const id = kms.importKey(kp);

      const signer = new KeyManagerSigner(kms, id);
      const msg = sha256(utf8ToBytes('parity check'));

      const viaSigner = signer.sign(msg, 'bip340');
      const viaKms = kms.sign(msg, id, { scheme: 'bip340' });

      // Both must verify against the same public key. (Schnorr uses random
      // aux_rand by default so the signature bytes themselves differ.)
      expect(kp.publicKey.verify(viaSigner, msg, { scheme: 'schnorr' })).to.be.true;
      expect(kp.publicKey.verify(viaKms, msg, { scheme: 'schnorr' })).to.be.true;
    });
  });

  describe('Signer interface compatibility', () => {
    it('publicKey + sign satisfy the Signer contract', () => {
      const kms = new LocalKeyManager();
      kms.importKey(SchnorrKeyPair.generate(), { setActive: true });
      const signer = new KeyManagerSigner(kms);

      expect(signer.publicKey).to.be.instanceOf(Uint8Array);
      expect(signer.publicKey.length).to.equal(33);
      expect(signer.sign).to.be.a('function');

      // publicKey must round-trip through CompressedSecp256k1PublicKey
      // (proves the bytes are a valid compressed secp256k1 point).
      expect(() => new CompressedSecp256k1PublicKey(signer.publicKey)).to.not.throw();
    });

    it('caches publicKey across accesses (no repeat KeyManager calls)', () => {
      const kms = new LocalKeyManager();
      const kp = SchnorrKeyPair.generate();
      const id = kms.importKey(kp);

      // Spy on getPublicKey by replacing it with a counter.
      let calls = 0;
      const original = kms.getPublicKey.bind(kms);
      kms.getPublicKey = (...args) => {
        calls++;
        return original(...args);
      };

      const signer = new KeyManagerSigner(kms, id);
      // Three accesses but only one underlying call.
      const a = signer.publicKey;
      const b = signer.publicKey;
      const c = signer.publicKey;
      expect(calls).to.equal(1);
      expect(Array.from(a)).to.deep.equal(Array.from(b));
      expect(Array.from(a)).to.deep.equal(Array.from(c));
    });
  });
});
