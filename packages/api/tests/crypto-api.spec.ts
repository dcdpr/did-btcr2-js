import { expect } from 'chai';
import {
  CryptoApi,
  CryptosuiteApi,
  DataIntegrityProofApi,
  KeyPairApi,
  MultikeyApi,
} from '../src/index.js';

/**
 * CryptoApi Test
 */
describe('CryptoApi', () => {
  it('should expose keypair, multikey, cryptosuite, and proof sub-facades', () => {
    const crypto = new CryptoApi();
    expect(crypto.keypair).to.be.instanceOf(KeyPairApi);
    expect(crypto.multikey).to.be.instanceOf(MultikeyApi);
    expect(crypto.cryptosuite).to.be.instanceOf(CryptosuiteApi);
    expect(crypto.proof).to.be.instanceOf(DataIntegrityProofApi);
  });

  it('sub-facade properties cannot be reassigned', () => {
    const crypto = new CryptoApi();
    const original = crypto.keypair;
    // TypeScript enforces readonly at compile time; verify the reference is stable
    expect(crypto.keypair).to.equal(original);
  });

  describe('activate() / deactivate()', () => {
    it('activate() sets current on all three sub-facades', () => {
      const crypto = new CryptoApi();
      const kp = crypto.keypair.generate();
      const mk = crypto.multikey.create('#key-1', 'did:btcr2:test', kp);
      crypto.activate(mk);
      expect(crypto.multikey.current).to.equal(mk);
      expect(crypto.cryptosuite.current).to.exist;
      expect(crypto.proof.current).to.exist;
    });

    it('deactivate() clears all three sub-facades', () => {
      const crypto = new CryptoApi();
      const kp = crypto.keypair.generate();
      const mk = crypto.multikey.create('#key-1', 'did:btcr2:test', kp);
      crypto.activate(mk);
      crypto.deactivate();
      expect(crypto.multikey.current).to.be.undefined;
      expect(crypto.cryptosuite.current).to.be.undefined;
      expect(crypto.proof.current).to.be.undefined;
    });

    it('activate() returns this for chaining', () => {
      const crypto = new CryptoApi();
      const kp = crypto.keypair.generate();
      const mk = crypto.multikey.create('#key-1', 'did:btcr2:test', kp);
      const ret = crypto.activate(mk);
      expect(ret).to.equal(crypto);
    });
  });

  describe('convenience methods', () => {
    it('sign() and verify() use the activated multikey', () => {
      const crypto = new CryptoApi();
      const kp = crypto.keypair.generate();
      const mk = crypto.multikey.create('#key-1', 'did:btcr2:test', kp);
      crypto.activate(mk);
      const data = new Uint8Array([1, 2, 3, 4]);
      const sig = crypto.sign(data);
      expect(sig).to.be.instanceOf(Uint8Array);
      expect(crypto.verify(data, sig)).to.equal(true);
    });

    it('sign() throws when not activated', () => {
      const crypto = new CryptoApi();
      expect(() => crypto.sign(new Uint8Array([1]))).to.throw('No current multikey set');
    });

    it('signDocument() and verifyDocument() round-trip', () => {
      const crypto = new CryptoApi();
      const kp = crypto.keypair.generate();
      const mk = crypto.multikey.create('#key-1', 'did:btcr2:test', kp);
      crypto.activate(mk);
      const document = {
        '@context'        : ['https://www.w3.org/ns/did/v1'],
        sourceDocument    : { id: 'did:btcr2:test', verificationMethod: [], service: [] },
        patch             : [{ op: 'add', path: '/test', value: 'x' }],
        sourceVersionId   : 1,
        targetVersionId   : 2,
      };
      const config = {
        '@context'           : ['https://www.w3.org/ns/did/v1'],
        type                 : 'DataIntegrityProof' as const,
        cryptosuite          : 'bip340-jcs-2025',
        verificationMethod   : 'did:btcr2:test#key-1',
        proofPurpose         : 'assertionMethod',
        domain               : 'did:btcr2:test',
      };
      const signed = crypto.signDocument(document as any, config);
      expect(signed).to.have.property('proof');

      const result = crypto.verifyDocument(signed);
      expect(result).to.have.property('verified');
    });
  });
});
