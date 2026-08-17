import { DataIntegrityProofError } from '@did-btcr2/common';
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

  describe('verifyProof domain binding', () => {
    // Sign a fresh document with the given domain. Both arguments are built from scratch every
    // call: addProof mutates the document (attaching `proof`) and createProof mutates the config
    // (attaching `proofValue`), so reusing either across calls corrupts the hash.
    const sign = (domain?: string | string[]): string => {
      const document = { id: 'http://university.example/credentials/58473', validFrom: '2020-01-01T00:00:00Z' };
      const proofConfig: DataIntegrityProofOptions = {
        type               : 'DataIntegrityProof',
        cryptosuite        : 'bip340-jcs-2025',
        verificationMethod : `${controller}#initialKey`,
        proofPurpose       : 'attestationMethod'
      };
      if (domain !== undefined) proofConfig.domain = domain;
      return JSON.stringify(diProof.addProof(document, proofConfig));
    };
    const verify = (signed: string, expectedDomain?: string | string[]) =>
      diProof.verifyProof(signed, 'attestationMethod', undefined, expectedDomain);
    const MISMATCH = 'Domain mismatch: expectedDomain and proof.domain do not match';
    const LENGTH_MISMATCH = 'Domain mismatch: expectedDomain length does not match proof.domain length';

    it('should verify a proof whose domain matches the expected domain', () => {
      expect(verify(sign(['victim.example']), ['victim.example']).verified).to.be.true;
      expect(verify(sign(['a.example', 'b.example']), ['a.example', 'b.example']).verified).to.be.true;
    });

    it('should verify a matching domain regardless of order', () => {
      expect(verify(sign(['a.example', 'b.example']), ['b.example', 'a.example']).verified).to.be.true;
    });

    it('should reject a proof bound to a different domain of the same length', () => {
      expect(() => verify(sign(['attacker.example']), ['victim.example']))
        .to.throw(DataIntegrityProofError, MISMATCH);
      expect(() => verify(sign(['a.example', 'attacker.example']), ['a.example', 'victim.example']))
        .to.throw(DataIntegrityProofError, MISMATCH);
    });

    it('should reject a proof whose domain list differs in length', () => {
      expect(() => verify(sign(['a.example']), ['a.example', 'b.example']))
        .to.throw(DataIntegrityProofError, LENGTH_MISMATCH);
      expect(() => verify(sign(), ['victim.example']))
        .to.throw(DataIntegrityProofError, LENGTH_MISMATCH);
    });

    it('should reject an unexpected domain hidden behind a duplicated expected entry', () => {
      expect(() => verify(sign(['attacker.example', 'victim.example']), ['victim.example', 'victim.example']))
        .to.throw(DataIntegrityProofError, MISMATCH);
    });

    it('should treat a string domain as a single-entry list, not as a character sequence', () => {
      // Equivalent forms match in either direction.
      expect(verify(sign('victim.example'), ['victim.example']).verified).to.be.true;
      expect(verify(sign(['victim.example']), 'victim.example').verified).to.be.true;
      expect(verify(sign('victim.example'), 'victim.example').verified).to.be.true;

      // A string domain is never compared by character count or by substring.
      expect(() => verify(sign('victim.example.attacker.example'), ['victim.example']))
        .to.throw(DataIntegrityProofError, MISMATCH);
      expect(() => verify(sign('x'), ['a']))
        .to.throw(DataIntegrityProofError, MISMATCH);
      expect(() => verify(sign('attacker.example'), 'victim.example'))
        .to.throw(DataIntegrityProofError, MISMATCH);
    });

    it('should not check the domain when no expected domain is given', () => {
      expect(verify(sign(['victim.example'])).verified).to.be.true;
    });
  });
});