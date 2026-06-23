import { KeyPairError } from '@did-btcr2/common';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';
import { taprootTweakPubkey } from '@scure/btc-signer/utils.js';
import { expect } from 'chai';
import { LocalSigner } from '../src/signer.js';

describe('LocalSigner', () => {
  // Deterministic test key.
  const secretKeyBytes = new Uint8Array([
    115, 253, 220, 18, 252, 147, 66, 187,
    41, 174, 155, 94, 212, 118, 50,  59,
    220, 105,  58, 17, 110,  54, 81,  36,
    85, 174, 232, 48, 254, 138, 37, 162
  ]);
  const expectedPublicKey = secp256k1.getPublicKey(secretKeyBytes, true);
  const expectedSchnorrPubKey = schnorr.getPublicKey(secretKeyBytes);

  describe('constructor', () => {
    it('accepts a 32-byte Uint8Array', () => {
      expect(() => new LocalSigner(secretKeyBytes)).to.not.throw();
    });

    it('throws KeyPairError on a 31-byte input', () => {
      expect(() => new LocalSigner(new Uint8Array(31)))
        .to.throw(KeyPairError, /32-byte/);
    });

    it('throws KeyPairError on a 33-byte input', () => {
      expect(() => new LocalSigner(new Uint8Array(33)))
        .to.throw(KeyPairError, /32-byte/);
    });

    it('throws KeyPairError on a non-Uint8Array', () => {
      expect(() => new LocalSigner('not bytes' as unknown as Uint8Array))
        .to.throw(KeyPairError, /32-byte/);
    });

    it('rejects an invalid scalar (all-zero)', () => {
      // 32-byte length, but invalid as a secp256k1 scalar - Secp256k1SecretKey throws.
      expect(() => new LocalSigner(new Uint8Array(32))).to.throw();
    });

    it('defensive-copies the input - mutating caller buffer does not affect signer', () => {
      const input = new Uint8Array(secretKeyBytes);
      const signer = new LocalSigner(input);
      const pubkeyBefore = Array.from(signer.publicKey);

      // Stomp the caller's buffer with all-ones (a different valid scalar).
      input.fill(0xff);
      input[31] = 0xfe; // keep below curve order n

      // Signer's pubkey is unchanged.
      expect(Array.from(signer.publicKey)).to.deep.equal(pubkeyBefore);

      // Signatures still verify against the original public key.
      const digest = sha256(utf8ToBytes('post-mutation sign'));
      const sig = signer.sign(digest, 'ecdsa');
      // `prehash: false` matches LocalSigner's sign contract: data IS the
      // digest. noble v2 defaults `prehash` to `true` on both sign and verify;
      // since LocalSigner pins it to `false`, verifiers must too.
      expect(secp256k1.verify(sig, digest, expectedPublicKey, { format: 'der', prehash: false })).to.be.true;
    });
  });

  describe('publicKey', () => {
    const signer = new LocalSigner(secretKeyBytes);

    it('returns a 33-byte compressed secp256k1 public key', () => {
      expect(signer.publicKey).to.be.instanceOf(Uint8Array);
      expect(signer.publicKey.length).to.equal(33);
      expect(signer.publicKey[0]).to.be.oneOf([0x02, 0x03]);
    });

    it('matches the public key derived from the secret key', () => {
      expect(Array.from(signer.publicKey)).to.deep.equal(Array.from(expectedPublicKey));
    });

    it('returns a defensive copy (mutation does not affect the signer)', () => {
      const first = signer.publicKey;
      first[0] = 0xff;
      const second = signer.publicKey;
      expect(second[0]).to.be.oneOf([0x02, 0x03]);
    });
  });

  describe('sign(data, "bip340")', () => {
    const signer = new LocalSigner(secretKeyBytes);
    const message = sha256(utf8ToBytes('local-signer test message'));

    it('returns a 64-byte BIP-340 signature', () => {
      const sig = signer.sign(message, 'bip340');
      expect(sig).to.be.instanceOf(Uint8Array);
      expect(sig.length).to.equal(64);
    });

    it('produces a signature that verifies via schnorr.verify', () => {
      const sig = signer.sign(message, 'bip340');
      expect(schnorr.verify(sig, message, expectedSchnorrPubKey)).to.be.true;
    });

    it('produces signatures that round-trip across different messages', () => {
      const m1 = sha256(utf8ToBytes('one'));
      const m2 = sha256(utf8ToBytes('two'));
      expect(schnorr.verify(signer.sign(m1, 'bip340'), m1, expectedSchnorrPubKey)).to.be.true;
      expect(schnorr.verify(signer.sign(m2, 'bip340'), m2, expectedSchnorrPubKey)).to.be.true;
    });
  });

  describe('sign(data, "ecdsa")', () => {
    const signer = new LocalSigner(secretKeyBytes);
    const digest = sha256(utf8ToBytes('local-signer test digest'));

    it('returns DER-encoded bytes (0x30 prefix, length 70-72)', () => {
      const sig = signer.sign(digest, 'ecdsa');
      expect(sig).to.be.instanceOf(Uint8Array);
      expect(sig[0]).to.equal(0x30);
      expect(sig.length).to.be.within(70, 72);
    });

    it('produces a signature that verifies via secp256k1.verify (DER) with prehash:false', () => {
      // LocalSigner signs the digest directly (`prehash: false`); the verifier
      // contract must match - Bitcoin's CHECKSIG verifies signatures against
      // the legacy/BIP-143 sighash directly, never re-hashing it.
      const sig = signer.sign(digest, 'ecdsa');
      expect(secp256k1.verify(sig, digest, expectedPublicKey, { format: 'der', prehash: false })).to.be.true;
    });

    it('signature does NOT verify under default-prehash verify', () => {
      // LocalSigner.sign pins `prehash: false`, so the produced signature
      // is over `digest` directly. noble v2's `secp256k1.verify` defaults
      // `prehash` to `true`, which re-hashes the message before verifying;
      // that gives `sha256(digest)` on the verify side. The two sides must
      // disagree under default-prehash verify, since the signing message
      // and verifying message differ. Bitcoin's CHECKSIG never re-hashes a
      // sighash, so its semantics match `prehash: false` on both sides.
      const sig = signer.sign(digest, 'ecdsa');
      expect(secp256k1.verify(sig, digest, expectedPublicKey, { format: 'der' })).to.be.false;
    });

    it('uses low-S normalization (S < n/2)', () => {
      const sig = signer.sign(digest, 'ecdsa');
      // Parse the DER R and S; Bitcoin requires low-S to avoid malleability.
      const decoded = secp256k1.Signature.fromBytes(sig, 'der');
      expect(decoded.hasHighS()).to.be.false;
    });

    it('is deterministic across calls (RFC 6979)', () => {
      // Without extraEntropy, ECDSA is deterministic. Two signs of the same
      // digest with the same key must produce identical bytes.
      const sigA = signer.sign(digest, 'ecdsa');
      const sigB = signer.sign(digest, 'ecdsa');
      expect(Array.from(sigA)).to.deep.equal(Array.from(sigB));
    });
  });

  describe('sign with invalid scheme', () => {
    const signer = new LocalSigner(secretKeyBytes);
    const data = sha256(utf8ToBytes('any'));

    it('throws KeyPairError on an unsupported scheme', () => {
      expect(() => signer.sign(data, 'rsa' as never))
        .to.throw(KeyPairError, /unsupported signing scheme/);
    });
  });

  describe('sign(data, "bip341")', () => {
    const signer = new LocalSigner(secretKeyBytes);
    const sighash = sha256(utf8ToBytes('taproot test sighash'));

    it('produces a 64-byte signature', () => {
      const sig = signer.sign(sighash, 'bip341');
      expect(sig).to.be.instanceOf(Uint8Array);
      expect(sig.length).to.equal(64);
    });

    it('signature verifies against the BIP-341-tweaked output internal key', () => {
      // Spec-mandated tweak: signed against Q = P + H_taptweak(P || merkleRoot)*G
      // (merkleRoot = empty bytes for key-path-only). The local untweaked Schnorr
      // pubkey P is `expectedSchnorrPubKey`.
      const sig = signer.sign(sighash, 'bip341');
      const [tweakedPubkey] = taprootTweakPubkey(expectedSchnorrPubKey, new Uint8Array(0));
      expect(schnorr.verify(sig, sighash, tweakedPubkey)).to.equal(true);
    });

    it('signature does NOT verify against the untweaked schnorr pubkey', () => {
      // BIP-341 §3 requires that key-path signatures verify under the
      // tweaked output internal key Q = P + tG, where t depends on P (and
      // the merkle root, if any). Since BIP-341 never tweaks by zero, Q
      // and P are different pubkeys and the same signature cannot verify
      // under both. Verifying under P must fail.
      const sig = signer.sign(sighash, 'bip341');
      expect(schnorr.verify(sig, sighash, expectedSchnorrPubKey)).to.equal(false);
    });

    it('different merkle roots produce different signatures (tweak respects input)', () => {
      const sigKeyPath = signer.sign(sighash, 'bip341');
      const sigScriptPath = signer.sign(sighash, 'bip341', {
        merkleRoot : sha256(utf8ToBytes('script tree')),
      });
      // Different tweak inputs derive different secrets, so the signatures
      // differ. Aux_rand randomness also makes them differ on its own, so
      // this is a weak sanity check rather than a definitive proof of the
      // tweak path - the verify-against-tweakedPubkey assertion above is.
      expect(sigKeyPath).to.not.deep.equal(sigScriptPath);
    });

    it('explicit merkleRoot: null is equivalent to omitting opts', () => {
      // The `bip341` scheme treats `merkleRoot: null | undefined | missing`
      // as the same key-path-only case (no script tree, merkle-root = 0x).
      // Verify both forms produce a valid taproot signature.
      const sigA = signer.sign(sighash, 'bip341');
      const sigB = signer.sign(sighash, 'bip341', { merkleRoot: null });
      const [tweakedPubkey] = taprootTweakPubkey(expectedSchnorrPubKey, new Uint8Array(0));
      expect(schnorr.verify(sigA, sighash, tweakedPubkey)).to.equal(true);
      expect(schnorr.verify(sigB, sighash, tweakedPubkey)).to.equal(true);
    });
  });
});
