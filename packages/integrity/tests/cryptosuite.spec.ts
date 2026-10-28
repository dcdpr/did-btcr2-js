import { CryptosuiteError } from '@did-btcr2/std';
import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keys';
import { expect } from 'chai';
import { base58btc } from 'multiformats/bases/base58';
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

  /**
   * RFC 8785 section 3.2.2.2: data with no JCS form (a lone surrogate, NaN) stops JCS "with an
   * appropriate error". VC Data Integrity section 3: the verifyProof of a suite "produces a
   * cryptosuite verification result or an error". The suite raises a CryptosuiteError; it does
   * not sign the data, and it does not return `verified: false` for it.
   */
  describe('No JCS form', () => {
    const freshConfig = (overrides: Record<string, unknown> = {}): DataIntegrityProofOptions => ({
      type               : 'DataIntegrityProof',
      cryptosuite        : 'bip340-jcs-2025',
      verificationMethod : `${controller}${id}`,
      proofPurpose       : 'attestationMethod',
      ...overrides
    } as DataIntegrityProofOptions);

    const errorFrom = (fn: () => unknown): any => {
      try {
        fn();
      } catch (error) {
        return error;
      }
      throw new Error('expected the call to throw');
    };

    const expectWrapped = (error: any, type: string, causeType: string, prefix: string) => {
      expect(error).to.be.an.instanceOf(CryptosuiteError);
      expect(error.type).to.equal(type);
      expect(error.message.startsWith(`${prefix}: Cannot canonicalize`)).to.equal(true, error.message);
      expect(error.data.cause.type).to.equal(causeType);
      expect(error.message).to.equal(`${prefix}: ${error.data.cause.message}`);
    };

    it('createProof refuses a document with a lone surrogate', () => {
      expectWrapped(
        errorFrom(() => cryptosuite.createProof({ a: '\ud800' }, freshConfig())),
        'PROOF_TRANSFORMATION_ERROR', 'LONE_SURROGATE', 'Invalid document'
      );
    });

    it('createProof refuses a document with NaN', () => {
      expectWrapped(
        errorFrom(() => cryptosuite.createProof({ a: NaN }, freshConfig())),
        'PROOF_TRANSFORMATION_ERROR', 'NON_FINITE_NUMBER', 'Invalid document'
      );
    });

    it('createProof checks the document @context with the proof options first', () => {
      const error = errorFrom(() => cryptosuite.createProof({ '@context': [ '\ud800' ], a: '\udc00' }, freshConfig()));
      expectWrapped(error, 'PROOF_GENERATION_ERROR', 'LONE_SURROGATE', 'Invalid config');
      expect(error.message).to.include('/@context/0');
    });

    it('createProof refuses proof options with a lone surrogate', () => {
      expectWrapped(
        errorFrom(() => cryptosuite.createProof({ a: 1 }, freshConfig({ domain: '\udc00' }))),
        'PROOF_GENERATION_ERROR', 'LONE_SURROGATE', 'Invalid config'
      );
    });

    it('verifyProof gives an error, not verified false, for a document with a lone surrogate', () => {
      // U+FFFD is the character that a UTF-8 encoder writes for a lone surrogate.
      const proof = cryptosuite.createProof({ a: '\ufffd' }, freshConfig());
      expectWrapped(
        errorFrom(() => cryptosuite.verifyProof({ a: '\ud800', proof })),
        'PROOF_TRANSFORMATION_ERROR', 'LONE_SURROGATE', 'Invalid document'
      );
    });

    it('verifyProof gives an error for proof options with a lone surrogate', () => {
      const proof = cryptosuite.createProof({ a: 1 }, freshConfig({ domain: 'example.com' }));
      expectWrapped(
        errorFrom(() => cryptosuite.verifyProof({ a: 1, proof: { ...proof, domain: '\udc00' } })),
        'PROOF_GENERATION_ERROR', 'LONE_SURROGATE', 'Invalid config'
      );
    });

    it('the Data Integrity verifyProof gives the error for a \\ud800 escape in the text', () => {
      const diProof = cryptosuite.toDataIntegrityProof();
      const signed = JSON.stringify(diProof.addProof({ a: 'x' }, freshConfig()));
      const text = signed.replace('"a":"x"', '"a":"\\ud800"');
      expect(text).to.include('\\ud800');
      expectWrapped(
        errorFrom(() => diProof.verifyProof(text, 'attestationMethod')),
        'PROOF_TRANSFORMATION_ERROR', 'LONE_SURROGATE', 'Invalid document'
      );
    });

    it('an error of a toJSON method passes through unchanged', () => {
      const inner = new Error('toJSON failed');
      const error = errorFrom(() => cryptosuite.transformDocument(
        { a: { toJSON: () => { throw inner; } } }, freshConfig()
      ));
      expect(error).to.equal(inner);
    });
  });

  describe('Proof algorithms', () => {
    const options = (overrides: Record<string, unknown> = {}): DataIntegrityProofOptions => ({
      type               : 'DataIntegrityProof',
      cryptosuite        : 'bip340-jcs-2025',
      verificationMethod : `${controller}${id}`,
      proofPurpose       : 'attestationMethod',
      ...overrides
    } as DataIntegrityProofOptions);

    const expectError = (fn: () => unknown, type: string, message: string): any => {
      let error: any;
      try {
        fn();
      } catch (caught) {
        error = caught;
      }
      expect(error, 'expected the call to throw').to.be.an.instanceOf(CryptosuiteError);
      expect(error.type).to.equal(type);
      expect(error.message).to.equal(message);
      return error;
    };

    const signed = (document: Record<string, unknown> = { a: 1 }, extra: Record<string, unknown> = {}): any =>
      ({ ...document, proof: cryptosuite.createProof(document, options(extra)) });

    // Sign with the step methods: a proof that createProof refuses to make.
    const rawSign = (document: Record<string, unknown>, proofOptions: Record<string, unknown>): any => {
      const config = proofOptions as DataIntegrityProofOptions;
      const hash = cryptosuite.generateHash(
        cryptosuite.proofConfiguration(config), cryptosuite.transformDocument(document, config)
      );
      const proofValue = base58btc.encode(cryptosuite.proofSerialization(hash, config));
      return { ...document, proof: { ...proofOptions, proofValue } };
    };

    describe('createProof', () => {
      it('does not change the proof options', () => {
        const config = options();
        const before = JSON.stringify(config);
        cryptosuite.createProof({ '@context': ['x:a'], a: 1 }, config);
        expect(JSON.stringify(config)).to.equal(before);
      });

      it('sets the proof @context to a copy of the document @context', () => {
        const document = { '@context': ['x:a', 'x:b'], a: 1 };
        const proof = cryptosuite.createProof(document, options({ '@context': ['x:other'] }));
        expect(proof['@context']).to.deep.equal(['x:a', 'x:b']);
        expect(proof['@context']).to.not.equal(document['@context']);
      });

      it('refuses an options @context for a document with no @context', () => {
        const error = expectError(
          () => cryptosuite.createProof({ a: 1 }, options({ '@context': ['x:b'] })),
          'PROOF_GENERATION_ERROR', 'Invalid proof options: "@context" needs a document @context that starts with it.'
        );
        expect(error.data).to.deep.equal({ '@context': ['x:b'] });
      });

      it('refuses proof options with a proofValue: the proof can never verify', () => {
        const proofValue = signed().proof.proofValue;
        for(const value of [proofValue, '', null]) {
          const error = expectError(
            () => cryptosuite.createProof({ a: 1 }, options({ proofValue: value })),
            'PROOF_GENERATION_ERROR', 'Invalid proof options: "proofValue" must not be present: Create Proof adds the proofValue.'
          );
          expect(error.data).to.deep.equal({ proofValue: value });
        }
        // Add Proof gives the error of the cryptosuite.
        expectError(
          () => cryptosuite.toDataIntegrityProof().addProof({ a: 1 }, options({ proofValue })),
          'PROOF_GENERATION_ERROR', 'Invalid proof options: "proofValue" must not be present: Create Proof adds the proofValue.'
        );
        // The proof from such options does not verify: Verify Proof removes the proofValue.
        const document = rawSign({ a: 1 }, { ...options(), proofValue });
        expect(cryptosuite.verifyProof(document).verified).to.equal(false);
        // An undefined proofValue is an absent member.
        const proof = cryptosuite.createProof({ a: 1 }, options({ proofValue: undefined }));
        expect(cryptosuite.verifyProof({ a: 1, proof }).verified).to.equal(true);
      });

      it('makes a proof that verifies for a string @context', () => {
        const document = { '@context': 'x:a', a: 1 };
        const proof = cryptosuite.createProof(document, options());
        expect(proof['@context']).to.equal('x:a');
        expect(cryptosuite.verifyProof({ ...document, proof })).to.deep.equal({ verified: true, verifiedDocument: document });
        expect(cryptosuite.verifyProof({ ...document, '@context': ['x:a', 'x:b'], proof })).to.deep.equal({
          verified         : true,
          verifiedDocument : document
        });
        expect(cryptosuite.verifyProof({ ...document, '@context': 'x:b', proof }).verified).to.equal(false);
      });

      it('refuses a document that is not a map', () => {
        for(const document of [null, [1], 'a']) {
          expectError(
            () => cryptosuite.createProof(document as any, options()),
            'PROOF_GENERATION_ERROR', 'Invalid document: the document must be a JSON object.'
          );
        }
      });

      const refused: Array<[string, unknown, string]> = [
        ['type', 5, 'a string'],
        ['cryptosuite', undefined, 'a string'],
        ['verificationMethod', 5, 'a string'],
        ['proofPurpose', undefined, 'a string'],
        ['id', 'not a url', 'a valid URL string'],
        ['id', 42, 'a valid URL string'],
        ['created', '2026-01-01T00:00:00', 'an XML Schema dateTimeStamp'],
        ['created', '', 'an XML Schema dateTimeStamp'],
        ['expires', 'soon', 'an XML Schema dateTimeStamp'],
        ['domain', 5, 'a string or an array of strings with no repeated string'],
        ['domain', ['a', 5], 'a string or an array of strings with no repeated string'],
        ['domain', ['a.example', 'a.example'], 'a string or an array of strings with no repeated string'],
        ['challenge', 5, 'a string'],
        ['nonce', 7, 'a string'],
        ['previousProof', 5, 'a string or an array of strings'],
      ];
      for(const [member, value, rule] of refused) {
        it(`refuses the proof option ${member} ${JSON.stringify(value)}`, () => {
          const error = expectError(
            () => cryptosuite.createProof({ a: 1 }, options({ [member]: value })),
            'PROOF_GENERATION_ERROR', `Invalid proof options: "${member}" must be ${rule}.`
          );
          expect(error.data).to.deep.equal({ [member]: value });
        });
      }

      it('makes a proof that verifies for a relative id, a urn id, a previousProof, and each optional member', () => {
        for(const extra of [
          { id: '#proof-1' },
          { id: 'proof-1' },
          { id: 'urn:uuid:6a1676b8-b51f-11ed-937b-d76685a20ff5' },
          { previousProof: 'urn:uuid:1' },
          { previousProof: ['urn:uuid:1', 'urn:uuid:2'] },
          { nonce: 'n', challenge: 'c', domain: 'example.com', created: '2026-01-01T00:00:00Z', expires: '2027-01-01T00:00:00-05:00' },
        ]) {
          const document = { a: 1 };
          const proof = cryptosuite.createProof(document, options(extra));
          expect(cryptosuite.verifyProof({ ...document, proof }).verified, JSON.stringify(extra)).to.equal(true);
        }
      });

      it('refuses a signer that does not give 64 bytes', () => {
        const signer = { publicKey: keyPair.publicKey.compressed, sign: () => new Uint8Array(63) };
        const suite = new BIP340Cryptosuite(SchnorrMultikey.fromSigner(id, controller, signer as any));
        expectError(
          () => suite.createProof({ a: 1 }, options()),
          'PROOF_GENERATION_ERROR', 'Invalid signature: the signer returned 63 bytes; a BIP340 signature has 64 bytes.'
        );
      });
    });

    describe('verifyProof', () => {
      it('gives the unsecured document as verifiedDocument', () => {
        expect(cryptosuite.verifyProof(signed())).to.deep.equal({ verified: true, verifiedDocument: { a: 1 } });
      });

      it('gives verifiedDocument null for a signature that does not verify', () => {
        expect(cryptosuite.verifyProof({ ...signed(), a: 2 })).to.deep.equal({ verified: false, verifiedDocument: null });
      });

      it('does not change the secured document', () => {
        const document = signed({ '@context': ['x:a'], a: 1 });
        document['@context'] = ['x:a', 'x:b'];
        const before = JSON.stringify(document);
        cryptosuite.verifyProof(document);
        expect(JSON.stringify(document)).to.equal(before);
      });

      it('throws PARSING_ERROR for a document or a proof that is not a map', () => {
        for(const document of [null, [1], { a: 1 }, { a: 1, proof: 'x' }, { a: 1, proof: [1] }]) {
          expectError(
            () => cryptosuite.verifyProof(document as any),
            'PARSING_ERROR', 'Invalid secured document: the document and its proof must be JSON objects.'
          );
        }
      });

      const refused: Array<[string, unknown, string]> = [
        ['verificationMethod', undefined, 'a string'],
        ['id', 'not a url', 'a valid URL string'],
        ['expires', 'soon', 'an XML Schema dateTime'],
        ['domain', 5, 'a string or an array of strings'],
        ['challenge', 5, 'a string'],
        ['nonce', 7, 'a string'],
        ['previousProof', 5, 'a string or an array of strings'],
      ];
      for(const [member, value, rule] of refused) {
        it(`throws PROOF_VERIFICATION_ERROR for the proof member ${member} ${JSON.stringify(value)}`, () => {
          const document = signed();
          document.proof[member] = value;
          const error = expectError(
            () => cryptosuite.verifyProof(document),
            'PROOF_VERIFICATION_ERROR', `Invalid proof: "${member}" must be ${rule}.`
          );
          expect(error.data).to.deep.equal({ [member]: value });
        });
      }

      it('verifies a proof whose domain array has a repeated string (a set on read)', () => {
        const document = rawSign({ a: 1 }, { ...options(), domain: ['a.example', 'a.example'] });
        expect(cryptosuite.verifyProof(document).verified).to.equal(true);
        const diProof = cryptosuite.toDataIntegrityProof();
        for(const expectedDomain of ['a.example', ['a.example'], ['a.example', 'a.example']]) {
          const result = diProof.verifyProof(JSON.stringify(document), 'attestationMethod', undefined, expectedDomain);
          expect(result.verified, JSON.stringify(expectedDomain)).to.equal(true);
        }
        const other = diProof.verifyProof(JSON.stringify(document), 'attestationMethod', undefined, ['a.example', 'b.example']);
        expect(other.errors[0]?.detail).to.equal('Domain mismatch: expectedDomain and proof.domain do not match');
      });

      it('accepts an expires and a created with no offset (a verifier MAY read them as UTC)', () => {
        const document = rawSign({ a: 1 }, { ...options(), created: '2026-01-01T00:00:00', expires: '2027-01-01T00:00:00' });
        expect(cryptosuite.verifyProof(document).verified).to.equal(true);
      });

      it('throws PROOF_GENERATION_ERROR from Proof Configuration for a created that is not a dateTime', () => {
        for(const created of ['', 5, 'soon']) {
          const document = signed();
          document.proof.created = created;
          const error = expectError(
            () => cryptosuite.verifyProof(document),
            'PROOF_GENERATION_ERROR', 'Invalid config: "created" must be a valid XMLSchema DateTime string'
          );
          expect(error.data).to.deep.equal({ created });
        }
      });

      it('throws PROOF_VERIFICATION_ERROR for a proofValue that is not the canonical base58btc text of 64 bytes', () => {
        const document = signed();
        const text = document.proof.proofValue;
        for(const proofValue of [`zĀ${text.slice(1)}`, `u${text.slice(1)}`, base58btc.encode(new Uint8Array(63)), 5, undefined]) {
          expectError(
            () => cryptosuite.verifyProof({ ...document, proof: { ...document.proof, proofValue } }),
            'PROOF_VERIFICATION_ERROR',
            'Invalid proofValue: not the base58btc Multibase encoding of a 64-byte BIP340 signature.'
          );
        }
      });

      it('verifies a document whose @context extends the proof @context, and gives the proof @context', () => {
        const document = signed({ '@context': ['x:a'], a: 1 });
        document['@context'] = ['x:a', 'x:b'];
        expect(cryptosuite.verifyProof(document)).to.deep.equal({
          verified         : true,
          verifiedDocument : { '@context': ['x:a'], a: 1 }
        });
      });

      it('gives verified false, with no error, if the document does not start with the proof @context', () => {
        const document = signed({ '@context': ['x:a'], a: 1 });
        for(const context of [['x:b', 'x:a'], 'x:b', undefined]) {
          expect(cryptosuite.verifyProof({ ...document, '@context': context }))
            .to.deep.equal({ verified: false, verifiedDocument: null });
        }
        // Step 4 skips to the last step, so the type check does not run.
        expect(cryptosuite.verifyProof({ ...document, '@context': ['x:b'], proof: { ...document.proof, type: 'Other' } }))
          .to.deep.equal({ verified: false, verifiedDocument: null });
      });
    });

    it('transformDocument gives a CryptosuiteError for another type or cryptosuite', () => {
      expectError(
        () => cryptosuite.transformDocument({ a: 1 }, options({ type: 'Other' })),
        'PROOF_VERIFICATION_ERROR', 'Type mismatch: config.type !== this.type'
      );
      expectError(
        () => cryptosuite.transformDocument({ a: 1 }, options({ cryptosuite: 'other' })),
        'PROOF_VERIFICATION_ERROR', 'Cryptosuite mismatch: config.cryptosuite !== this.cryptosuite'
      );
    });

    it('the Data Integrity verifyProof gives the mediaType only for a proof that verifies', () => {
      const diProof = cryptosuite.toDataIntegrityProof();
      const document = signed();
      expect(diProof.verifyProof(JSON.stringify(document), 'attestationMethod', 'application/json')).to.deep.equal({
        verified         : true,
        verifiedDocument : { a: 1 },
        mediaType        : 'application/json',
        warnings         : [],
        errors           : []
      });
      expect(diProof.verifyProof(JSON.stringify({ ...document, a: 2 }), 'attestationMethod', 'application/json')).to.deep.equal({
        verified         : false,
        verifiedDocument : null,
        mediaType        : null,
        warnings         : [],
        errors           : []
      });
      expect(diProof.verifyProof(JSON.stringify(document), 'attestationMethod').mediaType).to.equal(null);
    });
  });
});