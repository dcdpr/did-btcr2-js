import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { expect } from 'chai';
import {
  BIP340Cryptosuite,
  BIP340DataIntegrityProof,
  DataIntegrityConfig,
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
const config: DataIntegrityConfig = {
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
  const secretKey = Secp256k1SecretKey.fromEntropy(SECRET);
  const keys = new SchnorrKeyPair({ secretKey });
  const multikey = new SchnorrMultikey({ id, controller, keys });
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
});