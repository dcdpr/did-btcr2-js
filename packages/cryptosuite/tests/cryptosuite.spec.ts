import { ProofOptions } from '@did-btcr2/common';
import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { expect } from 'chai';
import { Cryptosuite, DataIntegrityProof, SchnorrMultikey } from '../src/index.js';

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
const options: ProofOptions = {
  type               : 'DataIntegrityProof',
  cryptosuite        : 'bip340-jcs-2025',
  verificationMethod : 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialKey',
  proofPurpose       : 'attestationMethod'
};

describe('Cryptosuite', () => {
  const secretKey = new Secp256k1SecretKey(Buffer.from('80d5427d3191c13a0c8e7279abc538a31a1ea210158d38022a80b2fac1660a79', 'hex'));
  const keys = new SchnorrKeyPair({ secretKey });
  const multikey = new SchnorrMultikey({ id, controller, keys });
  const cryptosuite = new Cryptosuite({ cryptosuite: 'bip340-jcs-2025', multikey });

  describe('Properties', () => {
    it('should include "type" = "DataIntegrityProof"', () => {
      expect(cryptosuite.type).to.equal('DataIntegrityProof');
    });

    it('should include "cryptosuite" = "bip340-jcs-2025"', () => {
      expect(cryptosuite.cryptosuite).to.equal('bip340-jcs-2025');
    });

    it('should include "algorithm" = "jcs"', () => {
      expect(cryptosuite.algorithm).to.equal('jcs');
    });

    it('should include "multikey" as a valid SchnorrMultikey', () => {
      expect(cryptosuite.multikey).to.exist.and.to.be.instanceOf(SchnorrMultikey);
    });
  });

  describe('Create Proof', () => {
    it('should return Proof object with "proofValue"', async () => {
      const proof = await cryptosuite.createProof({ document: unsecuredDocument, options });
      expect(proof).to.have.property('proofValue');
    });
  });

  describe('To Data Integrity Proof', () => {
    it('should return a valid Data Integrity Proof', () => {
      const diproof = cryptosuite.toDataIntegrityProof();
      expect(diproof).to.be.an.instanceOf(DataIntegrityProof);
    });
  });

  describe('Transform Document', () => {
    it('should return canonicalized document string', async () => {
      const canonicalDocument = await cryptosuite.transformDocument({ document: unsecuredDocument, options});
      expect(canonicalDocument).to.be.a.string;
    });
  });
});