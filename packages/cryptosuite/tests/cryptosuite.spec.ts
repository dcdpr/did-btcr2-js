import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { expect } from 'chai';
import type {
  DataIntegrityProofOptions} from '../src/index.js';
import {
  BIP340Cryptosuite,
  BIP340DataIntegrityProof,
  MAX_PROOF_CLOCK_SKEW_MS,
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

describe('Cryptosuite', () => {
  const secretKey = new Secp256k1SecretKey(Buffer.from('80d5427d3191c13a0c8e7279abc538a31a1ea210158d38022a80b2fac1660a79', 'hex'));
  const keyPair = new SchnorrKeyPair({ secretKey });
  const multikey = new SchnorrMultikey({ id, controller, keyPair });
  const cryptosuite = new BIP340Cryptosuite(multikey);

  describe('Properties', () => {
    it('should include "type" = "DataIntegrityProof"', () => {
      expect(cryptosuite.type).to.equal('DataIntegrityProof');
    });

    it('should include "cryptosuite" = "bip340-jcs-2025"', () => {
      expect(cryptosuite.cryptosuite).to.equal('bip340-jcs-2025');
    });

    it('should include "multikey" as a valid SchnorrMultikey', () => {
      expect(cryptosuite.multikey).to.exist.and.to.be.instanceOf(SchnorrMultikey);
    });
  });

  describe('Create Proof', () => {
    it('should return Proof object with "proofValue"', () => {
      const proof = cryptosuite.createProof(unsecuredDocument, config);
      expect(proof).to.have.property('proofValue');
    });
  });

  describe('To Data Integrity Proof', () => {
    it('should return a valid Data Integrity Proof', () => {
      const diproof = cryptosuite.toDataIntegrityProof();
      expect(diproof).to.be.an.instanceOf(BIP340DataIntegrityProof);
    });
  });

  describe('Transform Document', () => {
    it('should return canonicalized document string', () => {
      const canonicalDocument = cryptosuite.transformDocument(unsecuredDocument, config);
      expect(canonicalDocument).to.be.a.string;
    });
  });

  describe('Verify Proof temporal validation', () => {
    const securedWith = (proofOptions: Partial<DataIntegrityProofOptions>) => {
      const proof = cryptosuite.createProof(unsecuredDocument, { ...config, ...proofOptions });
      return { ...unsecuredDocument, proof };
    };

    it('verifies a proof whose expires is after the reference time but in the past relative to now', () => {
      const secured = securedWith({ expires: '2024-01-01T00:00:00Z' });
      const result = cryptosuite.verifyProof(secured, { referenceTime: new Date('2023-06-01T00:00:00Z') });
      expect(result.verified).to.be.true;
    });

    it('rejects a proof whose expires equals the reference time exactly', () => {
      const secured = securedWith({ expires: '2030-06-01T00:00:00Z' });
      expect(() => cryptosuite.verifyProof(secured, { referenceTime: new Date('2030-06-01T00:00:00Z') }))
        .to.throw(/expired/);
    });

    it('rejects a proof whose expires is malformed', () => {
      const secured = securedWith({ expires: '2030-06-01T00:00:00Z' });
      secured.proof.expires = 'not-a-date';
      expect(() => cryptosuite.verifyProof(secured, { referenceTime: new Date('2023-06-01T00:00:00Z') }))
        .to.throw(/expires/);
    });

    it('rejects a proof created beyond the clock-skew tolerance', () => {
      const referenceTime = new Date('2030-06-01T00:00:00Z');
      const created = new Date(referenceTime.getTime() + MAX_PROOF_CLOCK_SKEW_MS + 60_000);
      const secured = securedWith({ created: created.toISOString() });
      expect(() => cryptosuite.verifyProof(secured, { referenceTime }))
        .to.throw(/created/);
    });

    it('accepts a proof created within the clock-skew tolerance', () => {
      const referenceTime = new Date('2030-06-01T00:00:00Z');
      const created = new Date(referenceTime.getTime() + MAX_PROOF_CLOCK_SKEW_MS - 60_000);
      const secured = securedWith({ created: created.toISOString() });
      const result = cryptosuite.verifyProof(secured, { referenceTime });
      expect(result.verified).to.be.true;
    });

    it('rejects a proof whose created is malformed', () => {
      const secured = securedWith({ created: '2030-06-01T00:00:00Z' });
      secured.proof.created = 'not-a-date';
      expect(() => cryptosuite.verifyProof(secured, { referenceTime: new Date('2030-06-01T00:00:00Z') }))
        .to.throw(/created/);
    });

    it('defaults the reference time to the wall clock', () => {
      const secured = securedWith({ expires: '2999-01-01T00:00:00Z' });
      const result = cryptosuite.verifyProof(secured);
      expect(result.verified).to.be.true;
    });
  });
});