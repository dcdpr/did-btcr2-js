import { CryptosuiteError, DataIntegrityProofError } from '@did-btcr2/common';
import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { expect } from 'chai';
import type {
  DataIntegrityProofOptions,
  VerificationResult
} from '../src/index.js';
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

/** The fixed title of each error type that Verify Proof returns (one title per type). */
const TITLES: Record<string, string> = {
  PARSING_ERROR            : 'The secured document or its proof is not a map',
  PROOF_VERIFICATION_ERROR : 'The proof does not pass a check of Verify Proof',
  INVALID_DOMAIN_ERROR     : 'The proof domain is not the expected domain',
  INVALID_CHALLENGE_ERROR  : 'The proof challenge is not the expected challenge',
};

/**
 * Check a result of a step that raises an error: verified false and one ProblemDetails.
 * @param {VerificationResult} result The verification result.
 * @param {string} code The error type.
 * @param {string} detail The expected error text.
 */
const expectFailure = (result: VerificationResult, code: string, detail: string) => {
  expect(result.verified).to.be.false;
  expect(result.verifiedDocument).to.be.null;
  expect(result.mediaType).to.be.null;
  expect(result.warnings).to.deep.equal([]);
  expect(result.errors).to.have.length(1);
  expect(result.errors[0].type).to.equal(`https://w3id.org/security#${code}`);
  expect(result.errors[0].title).to.equal(TITLES[code]);
  expect(result.errors[0].detail).to.equal(detail);
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
    // Sign a fresh document with the given domain.
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
    const refused = (result: VerificationResult, detail: string) => expectFailure(result, 'INVALID_DOMAIN_ERROR', detail);

    it('should verify a proof whose domain matches the expected domain', () => {
      expect(verify(sign(['victim.example']), ['victim.example']).verified).to.be.true;
      expect(verify(sign(['a.example', 'b.example']), ['a.example', 'b.example']).verified).to.be.true;
    });

    it('should verify a matching domain regardless of order', () => {
      expect(verify(sign(['a.example', 'b.example']), ['b.example', 'a.example']).verified).to.be.true;
    });

    it('should reject a proof bound to a different domain of the same length', () => {
      refused(verify(sign(['attacker.example']), ['victim.example']), MISMATCH);
      refused(verify(sign(['a.example', 'attacker.example']), ['a.example', 'victim.example']), MISMATCH);
    });

    it('should reject a proof whose domain list differs in length', () => {
      refused(verify(sign(['a.example']), ['a.example', 'b.example']), MISMATCH);
      refused(verify(sign(), ['victim.example']), MISMATCH);
    });

    it('compares the domains as sets: a repeated expected string does not change the set', () => {
      expect(verify(sign('a.example'), ['a.example', 'a.example']).verified).to.be.true;
      expect(verify(sign(['a.example', 'b.example']), ['b.example', 'a.example', 'b.example']).verified).to.be.true;
    });

    it('refuses a proof domain that does not hold each expected string', () => {
      refused(verify(sign(['a.example']), ['a.example', 'b.example']), MISMATCH);
      refused(verify(sign('a.example'), ['b.example', 'a.example']), MISMATCH);
    });

    it('should reject an unexpected domain hidden behind a duplicated expected entry', () => {
      refused(verify(sign(['attacker.example', 'victim.example']), ['victim.example', 'victim.example']), MISMATCH);
    });

    it('should treat a string domain as a single-entry list, not as a character sequence', () => {
      // Equivalent forms match in either direction.
      expect(verify(sign('victim.example'), ['victim.example']).verified).to.be.true;
      expect(verify(sign(['victim.example']), 'victim.example').verified).to.be.true;
      expect(verify(sign('victim.example'), 'victim.example').verified).to.be.true;

      // A string domain is never compared by character count or by substring.
      refused(verify(sign('victim.example.attacker.example'), ['victim.example']), MISMATCH);
      refused(verify(sign('x'), ['a']), MISMATCH);
      refused(verify(sign('attacker.example'), 'victim.example'), MISMATCH);
    });

    it('should not check the domain when no expected domain is given', () => {
      expect(verify(sign(['victim.example'])).verified).to.be.true;
    });
  });

  describe('addProof (VC Data Integrity, Add Proof)', () => {
    const newDocument = () => ({ '@context': ['https://www.w3.org/ns/credentials/v2'], id: 'urn:uuid:1', a: { b: [1] } });
    const options = (): DataIntegrityProofOptions => ({
      type               : 'DataIntegrityProof',
      cryptosuite        : 'bip340-jcs-2025',
      verificationMethod : `${controller}#initialKey`,
      proofPurpose       : 'attestationMethod'
    });
    const expectGenerationError = (fn: () => unknown, message: string) => {
      expect(fn).to.throw(DataIntegrityProofError, message)
        .with.property('type', 'PROOF_GENERATION_ERROR');
    };

    it('returns a copy of the document and does not change the inputs', () => {
      const document = newDocument();
      const config = { ...options(), domain: ['a.example'], challenge: 'c1' };
      const documentText = JSON.stringify(document);
      const configText = JSON.stringify(config);
      const secured = diProof.addProof(document, config);
      expect(secured).to.not.equal(document);
      expect(JSON.stringify(document)).to.equal(documentText);
      expect(JSON.stringify(config)).to.equal(configText);
      expect(document).to.not.have.property('proof');
      expect(secured.proof).to.include({ proofPurpose: 'attestationMethod', challenge: 'c1' });
      expect(secured.proof.domain).to.deep.equal(['a.example']);
      expect(diProof.verifyProof(JSON.stringify(secured), 'attestationMethod', undefined, 'a.example', 'c1').verified)
        .to.be.true;
    });

    it('refuses a document that already has a proof (VC DI 4.3)', () => {
      const secured = diProof.addProof(newDocument(), options());
      expectGenerationError(() => diProof.addProof(secured, options()),
        'Invalid document: the document already has a proof. This suite adds one proof and does not '
        + 'make proof sets or chains (VC Data Integrity, Add Proof Set/Chain).');
      expectGenerationError(() => diProof.addProof({ ...newDocument(), proof: null }, options()),
        'the document already has a proof');
    });

    it('refuses options with a previousProof', () => {
      expectGenerationError(() => diProof.addProof(newDocument(), { ...options(), previousProof: 'urn:uuid:p' }),
        'Invalid proof options: "previousProof" needs a proof chain (VC Data Integrity, Add Proof '
        + 'Set/Chain), which this suite does not make.');
      expectGenerationError(() => diProof.addProof(newDocument(), { ...options(), previousProof: '' }),
        '"previousProof" needs a proof chain');
    });

    it('passes the cryptosuite errors through', () => {
      expect(() => diProof.addProof(null as any, options())).to.throw(CryptosuiteError, 'must be a JSON object');
      expect(() => diProof.addProof(newDocument(), { ...options(), challenge: 7 } as any))
        .to.throw(CryptosuiteError, '"challenge"');
    });

    describe('steps 2 to 4 with a cryptosuite that returns another proof', () => {
      const withProof = (proof: Record<string, unknown>) => new BIP340DataIntegrityProof(
        { createProof: () => ({ ...options(), proofValue: 'z', ...proof }) } as unknown as BIP340Cryptosuite
      );

      it('refuses a proof with no type, verificationMethod, or proofPurpose (step 2)', () => {
        for (const member of ['type', 'verificationMethod', 'proofPurpose']) {
          expectGenerationError(() => withProof({ [member]: undefined }).addProof(newDocument(), options()),
            'Invalid proof: missing proof.type, proof.verificationMethod and/or proof.proofPurpose');
        }
        // An empty string is set.
        expect(withProof({ proofPurpose: '' }).addProof(newDocument(), options()).proof.proofPurpose).to.equal('');
      });

      it('refuses a proof whose domain is not the options domain (step 3)', () => {
        const message = 'Domain mismatch: proof.domain !== config.domain';
        expectGenerationError(() => withProof({ domain: 'b.example' }).addProof(newDocument(), { ...options(), domain: 'a.example' }), message);
        expectGenerationError(() => withProof({ domain: ['a.example', 'b.example'] })
          .addProof(newDocument(), { ...options(), domain: ['b.example', 'a.example'] }), message);
        expectGenerationError(() => withProof({}).addProof(newDocument(), { ...options(), domain: '' }), message);
        // An equal array value passes; a null domain is not checked.
        expect(withProof({ domain: ['a.example'] }).addProof(newDocument(), { ...options(), domain: ['a.example'] }).proof.domain)
          .to.deep.equal(['a.example']);
        expect(withProof({}).addProof(newDocument(), { ...options(), domain: null } as any).proof.domain).to.be.undefined;
      });

      it('refuses a proof whose challenge is not the options challenge (step 4)', () => {
        const message = 'Challenge mismatch: proof.challenge !== config.challenge';
        expectGenerationError(() => withProof({ challenge: 'x' }).addProof(newDocument(), { ...options(), challenge: 'y' }), message);
        expectGenerationError(() => withProof({}).addProof(newDocument(), { ...options(), challenge: '' }), message);
        expect(withProof({}).addProof(newDocument(), { ...options(), challenge: null } as any).proof.challenge).to.be.undefined;
      });
    });
  });

  describe('verifyProof (VC Data Integrity, Verify Proof)', () => {
    const options = (): DataIntegrityProofOptions => ({
      type               : 'DataIntegrityProof',
      cryptosuite        : 'bip340-jcs-2025',
      verificationMethod : `${controller}#initialKey`,
      proofPurpose       : 'attestationMethod',
      challenge          : 'c1'
    });
    const secured = () => diProof.addProof({ id: 'urn:uuid:1', a: 1 }, options());
    const text = (proof: Record<string, unknown>) => JSON.stringify({ ...secured(), proof: { ...secured().proof, ...proof } });

    it('returns the document and the media type if the proof verifies (step 9)', () => {
      const result = diProof.verifyProof(JSON.stringify(secured()), 'attestationMethod', 'application/json', undefined, 'c1');
      expect(result).to.deep.equal({
        verified         : true,
        verifiedDocument : { id: 'urn:uuid:1', a: 1 },
        mediaType        : 'application/json',
        warnings         : [],
        errors           : []
      });
      expect(diProof.verifyProof(JSON.stringify(secured())).mediaType).to.be.null;
    });

    it('returns verified false with no error for a signature that does not verify', () => {
      const result = diProof.verifyProof(JSON.stringify({ ...secured(), a: 2 }), 'attestationMethod', 'application/json');
      expect(result).to.deep.equal({ verified: false, verifiedDocument: null, mediaType: null, warnings: [], errors: [] });
    });

    it('throws PARSING_ERROR for text that is not JSON (step 1)', () => {
      for (const document of ['{', '', 'undefined']) {
        expect(() => diProof.verifyProof(document)).to.throw(DataIntegrityProofError, 'Invalid document: the text is not JSON: ')
          .with.property('type', 'PARSING_ERROR');
      }
    });

    it('returns PARSING_ERROR for a document or a proof that is not a map (step 2)', () => {
      const detail = 'Invalid secured document: the document and its proof must be JSON objects.';
      for (const document of ['null', '[]', '1', '"a"', '{}', '{"proof":null}', '{"proof":[]}', '{"proof":"z"}']) {
        expectFailure(diProof.verifyProof(document), 'PARSING_ERROR', detail);
      }
    });

    it('returns PROOF_VERIFICATION_ERROR for a proof with no type, verificationMethod, or proofPurpose (step 4)', () => {
      const detail = 'Invalid proof: missing proof.type, proof.verificationMethod and/or proof.proofPurpose';
      for (const member of ['type', 'verificationMethod', 'proofPurpose']) {
        expectFailure(diProof.verifyProof(text({ [member]: undefined })), 'PROOF_VERIFICATION_ERROR', detail);
      }
    });

    it('returns PROOF_VERIFICATION_ERROR for a proof with a previousProof', () => {
      const detail = 'Invalid proof: "previousProof" needs the verification of a proof chain (VC Data Integrity, '
        + 'Verify Proof Sets and Chains), which this suite does not do.';
      expectFailure(diProof.verifyProof(text({ previousProof: 'urn:uuid:p' })), 'PROOF_VERIFICATION_ERROR', detail);
      expectFailure(diProof.verifyProof(text({ previousProof: null })), 'PROOF_VERIFICATION_ERROR', detail);
    });

    it('returns PROOF_VERIFICATION_ERROR for an expected purpose that does not match (step 5)', () => {
      const detail = 'Proof purpose mismatch: proof.proofPurpose !== expectedPurpose';
      expectFailure(diProof.verifyProof(JSON.stringify(secured()), 'authentication'), 'PROOF_VERIFICATION_ERROR', detail);
      expectFailure(diProof.verifyProof(JSON.stringify(secured()), ''), 'PROOF_VERIFICATION_ERROR', detail);
    });

    it('returns INVALID_CHALLENGE_ERROR for an expected challenge that does not match (step 7)', () => {
      const detail = 'Challenge mismatch: proof.challenge !== expectedChallenge';
      const document = JSON.stringify(secured());
      expectFailure(diProof.verifyProof(document, undefined, undefined, undefined, 'c2'), 'INVALID_CHALLENGE_ERROR', detail);
      expectFailure(diProof.verifyProof(document, undefined, undefined, undefined, ''), 'INVALID_CHALLENGE_ERROR', detail);
      expect(diProof.verifyProof(document, undefined, undefined, undefined, 'c1').verified).to.be.true;
    });

    it('throws the cryptosuite error of step 8', () => {
      expect(() => diProof.verifyProof(text({ proofValue: 'z0OIl' })))
        .to.throw(CryptosuiteError, 'Invalid proofValue').with.property('type', 'PROOF_VERIFICATION_ERROR');
      expect(() => diProof.verifyProof(text({ id: 'not a url' })))
        .to.throw(CryptosuiteError, '"id"');
    });
  });
});
