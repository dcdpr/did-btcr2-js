import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { expect } from 'chai';
import type {
  DataIntegrityProofOptions} from '../src/index.js';
import {
  BIP340Cryptosuite,
  BIP340DataIntegrityProof,
  SchnorrMultikey
} from '../src/index.js';

const unsecuredDocument = {
  '@context' : [
    'https://www.w3.org/ns/credentials/v2',
    'https://www.w3.org/ns/credentials/examples/v2',
  ],
  id                : 'http://university.example/credentials/58473',
  type              : ['VerifiableCredential', 'ExampleAlumniCredential'],
  validFrom         : '2020-01-01T00:00:00Z',
  issuer            : 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r',
  credentialSubject : {
    id       : 'did:example:ebfeb1f712ebc6f1c276e12ec21',
    alumniOf : {
      id   : 'did:example:c276e12ec21ebfeb1f712ebc6f1',
      name : 'Example University',
    },
  },
} as any;
const id = '#initialKey';
const controller = 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r';
const SECRET = 58272841933928377480411201276100309631103600890521640850330825422752012700281n;
const config: DataIntegrityProofOptions = {
  '@context' : [
    'https://w3id.org/security/v2',
    'https://w3id.org/zcap/v1',
    'https://w3id.org/json-ld-patch/v1',
    'https://btcr2.dev/context/v1'
  ],
  type               : 'DataIntegrityProof',
  cryptosuite        : 'bip340-jcs-2025',
  verificationMethod : 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialKey',
  proofPurpose       : 'attestationMethod'
};

describe('Data Integrity Proof', () => {
  const secretKey = Secp256k1SecretKey.fromBigInt(SECRET);
  const keyPair = new SchnorrKeyPair({ secretKey });
  const multikey = new SchnorrMultikey({ id, controller, keyPair });
  const cryptosuite = new BIP340Cryptosuite(multikey);
  const diProof = new BIP340DataIntegrityProof(cryptosuite);

  describe('addProof and verifyProof', () => {
    it('should return a document secured with a "proof" and verify true', () => {
      const securedDocument = diProof.addProof(unsecuredDocument, config);
      expect(securedDocument).to.have.property('proof');

      const verifiedProof = diProof.verifyProof(JSON.stringify(securedDocument), 'attestationMethod');
      expect(verifiedProof.verified).to.be.true;
    });
  });

  describe('verifyProof domain validation', () => {
    // addProof mutates its inputs (attaches proof / proofValue in place), and the
    // shared fixtures above are already secured by the time these tests run.
    // Describe bodies execute at load time, so these captures are pristine.
    const pristineDocument = { ...unsecuredDocument };
    const pristineConfig = { ...config };

    it('passes when the expected domain (string) matches proof.domain (string)', () => {
      const securedDocument = diProof.addProof(
        { ...pristineDocument }, { ...pristineConfig, domain: 'https://example.com' }
      );
      const result = diProof.verifyProof(
        JSON.stringify(securedDocument), 'attestationMethod', undefined, 'https://example.com'
      );
      expect(result.verified).to.be.true;
    });

    it('passes when every expected domain is present in proof.domain (arrays)', () => {
      const securedDocument = diProof.addProof(
        { ...pristineDocument }, { ...pristineConfig, domain: ['https://a.example', 'https://b.example'] }
      );
      const result = diProof.verifyProof(
        JSON.stringify(securedDocument), 'attestationMethod', undefined, ['https://a.example', 'https://b.example']
      );
      expect(result.verified).to.be.true;
    });

    it('passes when a single expected domain is one of several proof domains', () => {
      const securedDocument = diProof.addProof(
        { ...pristineDocument }, { ...pristineConfig, domain: ['https://a.example', 'https://b.example'] }
      );
      const result = diProof.verifyProof(
        JSON.stringify(securedDocument), 'attestationMethod', undefined, 'https://b.example'
      );
      expect(result.verified).to.be.true;
    });

    it('throws when the expected domain is not present in proof.domain', () => {
      const securedDocument = diProof.addProof(
        { ...pristineDocument }, { ...pristineConfig, domain: 'https://attacker.example' }
      );
      expect(() => diProof.verifyProof(
        JSON.stringify(securedDocument), 'attestationMethod', undefined, 'https://example.com'
      )).to.throw(/Domain mismatch/);
    });

    it('throws when the proof carries no domain but one is expected', () => {
      const securedDocument = diProof.addProof({ ...pristineDocument }, { ...pristineConfig });
      expect(() => diProof.verifyProof(
        JSON.stringify(securedDocument), 'attestationMethod', undefined, 'https://example.com'
      )).to.throw(/Domain mismatch/);
    });
  });

  describe('expiry enforcement', () => {
    const pristineDocument = { ...unsecuredDocument };
    const pristineConfig = { ...config };

    it('verifies a proof whose expires is in the future', () => {
      const securedDocument = diProof.addProof(
        { ...pristineDocument }, { ...pristineConfig, expires: '2999-01-01T00:00:00Z' }
      );
      const result = diProof.verifyProof(JSON.stringify(securedDocument), 'attestationMethod');
      expect(result.verified).to.be.true;
    });

    it('throws for a proof whose expires is in the past', () => {
      const securedDocument = diProof.addProof(
        { ...pristineDocument }, { ...pristineConfig, expires: '2020-01-01T00:00:00Z' }
      );
      expect(() => diProof.verifyProof(
        JSON.stringify(securedDocument), 'attestationMethod'
      )).to.throw(/expired/);
    });

    it('throws for a malformed expires', () => {
      // addProof validates the format at generation, so tamper post-signing
      const securedDocument = diProof.addProof(
        { ...pristineDocument }, { ...pristineConfig, expires: '2999-01-01T00:00:00Z' }
      );
      securedDocument.proof.expires = 'not-a-date';
      expect(() => diProof.verifyProof(
        JSON.stringify(securedDocument), 'attestationMethod'
      )).to.throw(/expires/);
    });
  });

  describe('input isolation', () => {
    it('addProof mutates neither the caller document nor the caller config', () => {
      const doc = { ...unsecuredDocument };
      const cfg = { ...config };

      const secured = diProof.addProof(doc, cfg);

      // The returned document carries the proof...
      expect(secured).to.have.property('proof');
      expect(secured.proof).to.have.property('proofValue');

      // ...but the caller's objects are untouched
      expect(doc).to.not.have.property('proof');
      expect(cfg).to.not.have.property('proofValue');
    });

    it('mutating the caller config after addProof does not alter the secured proof', () => {
      const cfg = { ...config, domain: 'https://example.com' };
      const secured = diProof.addProof({ ...unsecuredDocument }, cfg);

      cfg.domain = 'https://attacker.example';

      expect(secured.proof.domain).to.equal('https://example.com');
    });
  });
});