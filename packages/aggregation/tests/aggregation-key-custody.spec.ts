import { SchnorrKeyPair, wipe } from '@did-btcr2/keypair';
import { expect } from 'chai';
import {
  AggregationParticipant,
  AggregationService,
  KeyPairAggregationSigner,
} from '../src/index.js';

/**
 * Executable guarantees for ADR 038 (MuSig2 key custody): the raw secret is
 * confined behind a withSecret boundary that wipes its working copy on every
 * path, is never a public field on the participant, and the coordinator holds a
 * public key only.
 */
describe('ADR 038: MuSig2 key custody', () => {
  describe('wipe()', () => {
    it('zeroes a buffer in place', () => {
      const b = new Uint8Array([1, 2, 3, 4]);
      wipe(b);
      expect([...b]).to.deep.equal([0, 0, 0, 0]);
    });

    it('is a no-op for nullish input', () => {
      expect(() => wipe(undefined)).to.not.throw();
      expect(() => wipe(null)).to.not.throw();
    });
  });

  describe('KeyPairAggregationSigner', () => {
    it('exposes the compressed public key, never the secret as a field', () => {
      const kp = SchnorrKeyPair.generate();
      const signer = new KeyPairAggregationSigner(kp);
      expect([...signer.publicKey]).to.deep.equal([...kp.publicKey.compressed]);
      // The secret backs the signer privately; it is not reachable as a field.
      expect((signer as unknown as Record<string, unknown>).keys).to.equal(undefined);
      expect((signer as unknown as Record<string, unknown>).secretKey).to.equal(undefined);
    });

    it('provides the raw secret to the callback and returns its value', () => {
      const kp = SchnorrKeyPair.generate();
      const signer = new KeyPairAggregationSigner(kp);
      const expected = [...kp.secretKey.bytes];
      const result = signer.withSecret(sk => {
        expect([...sk]).to.deep.equal(expected);
        return 'ok';
      });
      expect(result).to.equal('ok');
    });

    it('wipes the working copy after the callback returns', () => {
      const kp = SchnorrKeyPair.generate();
      const signer = new KeyPairAggregationSigner(kp);
      let captured: Uint8Array | undefined;
      signer.withSecret(sk => { captured = sk; });
      expect(captured).to.be.instanceOf(Uint8Array);
      expect(captured!.every(byte => byte === 0)).to.equal(true);
    });

    it('wipes the working copy even when the callback throws', () => {
      const kp = SchnorrKeyPair.generate();
      const signer = new KeyPairAggregationSigner(kp);
      let captured: Uint8Array | undefined;
      expect(() => signer.withSecret(sk => {
        captured = sk;
        throw new Error('boom');
      })).to.throw('boom');
      expect(captured!.every(byte => byte === 0)).to.equal(true);
    });

    it('does not mutate or destroy the underlying keypair', () => {
      const kp = SchnorrKeyPair.generate();
      const before = [...kp.secretKey.bytes];
      const signer = new KeyPairAggregationSigner(kp);
      signer.withSecret(() => undefined);
      // The caller's keypair is still intact and usable after signing.
      expect([...kp.secretKey.bytes]).to.deep.equal(before);
    });
  });

  describe('state machine custody', () => {
    it('AggregationParticipant exposes only the public key, not a secret-bearing keypair', () => {
      const kp = SchnorrKeyPair.generate();
      const participant = new AggregationParticipant({
        did    : 'did:btcr2:alice',
        signer : new KeyPairAggregationSigner(kp),
      });
      expect([...participant.publicKey]).to.deep.equal([...kp.publicKey.compressed]);
      // The pre-ADR-038 `public readonly keys` field is gone.
      expect((participant as unknown as Record<string, unknown>).keys).to.equal(undefined);
    });

    it('AggregationService is constructed with a public key only', () => {
      const kp = SchnorrKeyPair.generate();
      const service = new AggregationService({ did: 'did:btcr2:svc', publicKey: kp.publicKey });
      expect([...service.publicKey.compressed]).to.deep.equal([...kp.publicKey.compressed]);
    });
  });
});
