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

  /**
   * Errors are routinely logged and shipped to telemetry, and these throws sit
   * on routine failure paths (type / cryptosuite / verificationMethod
   * mismatch). The suite reaches the multikey and its secret key, so an error's
   * `data` must describe the suite rather than carry it.
   */
  describe('Error data (secret material)', () => {
    const secretHex = secretKey.hex;
    const secretSeed = secretKey.seed.toString();
    const secretBytes = JSON.stringify(Array.from(secretKey.bytes));
    const expectedSuite = {
      type               : 'DataIntegrityProof',
      cryptosuite        : 'bip340-jcs-2025',
      verificationMethod : multikey.fullId()
    };

    // The suite mutates the config it is handed (createProof casts it and
    // attaches proofValue), so every case builds its own.
    const freshConfig = (overrides: Record<string, unknown> = {}): DataIntegrityProofOptions => ({
      type               : 'DataIntegrityProof',
      cryptosuite        : 'bip340-jcs-2025',
      verificationMethod : `${controller}${id}`,
      proofPurpose       : 'attestationMethod',
      ...overrides
    } as DataIntegrityProofOptions);

    const dataFrom = (fn: () => unknown): Record<string, any> => {
      try {
        fn();
      } catch (error: any) {
        return error.data;
      }
      throw new Error('expected the call to throw');
    };

    const expectSafe = (data: Record<string, any>) => {
      expect(data).to.not.have.property('this');
      expect(data).to.have.property('config');
      expect(data.suite).to.deep.equal(expectedSuite);
      const serialized = JSON.stringify(data);
      expect(serialized).to.not.include(secretHex);
      expect(serialized).to.not.include(secretSeed);
      expect(serialized).to.not.include(secretBytes);
    };

    it('transformDocument type mismatch carries no secret', () => {
      expectSafe(dataFrom(() =>
        cryptosuite.transformDocument(unsecuredDocument, freshConfig({ type: 'NotAProof' }))));
    });

    it('transformDocument cryptosuite mismatch carries no secret', () => {
      expectSafe(dataFrom(() =>
        cryptosuite.transformDocument(unsecuredDocument, freshConfig({ cryptosuite: 'eddsa-jcs-2022' }))));
    });

    it('proofConfiguration type mismatch carries no secret', () => {
      expectSafe(dataFrom(() =>
        cryptosuite.proofConfiguration(freshConfig({ type: 'NotAProof' }))));
    });

    it('proofConfiguration cryptosuite mismatch carries no secret', () => {
      expectSafe(dataFrom(() =>
        cryptosuite.proofConfiguration(freshConfig({ cryptosuite: 'eddsa-jcs-2022' }))));
    });

    it('proofSerialization verificationMethod mismatch carries no secret', () => {
      expectSafe(dataFrom(() =>
        cryptosuite.proofSerialization(
          new Uint8Array(32),
          freshConfig({ verificationMethod: `${controller}#otherKey` })
        )));
    });

    it('proofVerification verificationMethod mismatch carries no secret', () => {
      expectSafe(dataFrom(() =>
        cryptosuite.proofVerification(
          new Uint8Array(32),
          new Uint8Array(64),
          freshConfig({ verificationMethod: `${controller}#otherKey` })
        )));
    });

    it('a serialized error data payload still names what the suite expected', () => {
      // The replacement is not just a deletion: the diagnostic a caller needs
      // (what this suite is, and which key it speaks for) survives.
      const data = dataFrom(() =>
        cryptosuite.transformDocument(unsecuredDocument, freshConfig({ type: 'NotAProof' })));
      expect(JSON.parse(JSON.stringify(data)).suite).to.deep.equal(expectedSuite);
      expect(data.config.type).to.equal('NotAProof');
    });
  });
});