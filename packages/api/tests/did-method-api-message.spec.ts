import { expect } from 'chai';
import { canonicalize } from '@did-btcr2/common';
import { BIP340Cryptosuite, BIP340DataIntegrityProof, SchnorrMultikey } from '@did-btcr2/cryptosuite';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import type { Signer } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';
import { createApi, MethodError } from '../src/index.js';
import type { Btcr2DidDocument, MessageReport, PatchOperation, SignedMessage } from '../src/index.js';

/** A KEY DID, its initial document as a plain object, its key pair, and its signer. */
function fixture() {
  const api = createApi();
  const keyPair = SchnorrKeyPair.generate();
  const did = api.btcr2.createDeterministic(keyPair.publicKey.compressed);
  const document = JSON.parse(JSON.stringify(api.btcr2.getInitialDocument(did))) as Btcr2DidDocument;
  const signer = new LocalSigner(keyPair.secretKey.bytes);
  return { api, did, document, keyPair, signer };
}

/** A signer that records each call and then signs with `inner`. */
function spySigner(inner: Signer) {
  const calls: Array<{ data: Uint8Array; scheme: string }> = [];
  const signer: Signer = {
    publicKey : inner.publicKey,
    sign      : (data, scheme, opts) => {
      calls.push({ data: Uint8Array.from(data), scheme });
      return inner.sign(data, scheme, opts);
    },
  };
  return { signer, calls };
}

/** The bip340-jcs-2025 hash of a signed message, computed with no repo code but canonicalize. */
function messageHash(signed: SignedMessage): Uint8Array {
  const { proof, ...document } = signed;
  const { proofValue: _omitted, ...config } = proof;
  const encoder = new TextEncoder();
  const halves = new Uint8Array(64);
  halves.set(sha256(encoder.encode(canonicalize(config))), 0);
  halves.set(sha256(encoder.encode(canonicalize(document))), 32);
  return sha256(halves);
}

/** The name and the detail of the failed check of a report. */
function failure(report: MessageReport) {
  const failed = report.checks[report.checks.length - 1];
  return { name: failed.name, ok: failed.ok, detail: failed.detail };
}

/** The multibase of a new key that the fixture DID does not hold. */
function otherKeyMultibase(api: ReturnType<typeof createApi>): string {
  const did = api.btcr2.createDeterministic(SchnorrKeyPair.generate().publicKey.compressed);
  return api.btcr2.getInitialDocument(did).verificationMethod[0].publicKeyMultibase!;
}

const MESSAGE = 'I control this DID. 2026-10-06 nonce 7f3a';

/**
 * DidMethodApi signMessage() and verifyMessage() (ADR 137)
 */
describe('DidMethodApi message signatures', () => {
  describe('signMessage()', () => {
    for (const message of [ MESSAGE, '', 'line 1\nline 2\r\n', 'Grüße, 東京 😀', 'Hello "World"\n","proof":{}' ]) {
      it(`signs and verifies ${JSON.stringify(message)}`, () => {
        const { api, did, document, signer } = fixture();
        const signed = api.btcr2.signMessage(document, message, signer);

        expect(Object.keys(signed).sort()).to.deep.equal([ 'message', 'proof', 'type' ]);
        expect(Object.keys(signed.proof).sort())
          .to.deep.equal([ 'cryptosuite', 'proofPurpose', 'proofValue', 'type', 'verificationMethod' ]);
        expect(signed.type).to.equal('BTCR2Message');
        expect(signed.message).to.equal(message);
        expect(signed.proof).to.include({
          type               : 'DataIntegrityProof',
          cryptosuite        : 'bip340-jcs-2025',
          verificationMethod : `${did}#initialKey`,
          proofPurpose       : 'assertionMethod',
        });

        const report = api.btcr2.verifyMessage(document, signed);
        expect(report.verified).to.equal(true);
        expect(report.did).to.equal(did);
        expect(report.message).to.equal(message);
        expect(report.verificationMethod).to.equal(`${did}#initialKey`);
        expect(report.checks).to.deep.equal([
          { name: 'structure', ok: true },
          { name: 'signer', ok: true },
          { name: 'active', ok: true },
          { name: 'assertionMethod', ok: true },
          { name: 'signature', ok: true },
        ]);
      });
    }

    it('gives the signer only the 32-byte hash of the closed format, with the scheme bip340', () => {
      const { api, document, keyPair, signer } = fixture();
      const spy = spySigner(signer);
      const signed = api.btcr2.signMessage(document, MESSAGE, spy.signer);

      expect(spy.calls).to.have.length(1);
      expect(spy.calls[0].scheme).to.equal('bip340');
      expect(spy.calls[0].data).to.deep.equal(messageHash(signed));
      expect(signed.proof.proofValue[0]).to.equal('z');
      const signature = base58.decode(signed.proof.proofValue.slice(1));
      expect(schnorr.verify(signature, messageHash(signed), keyPair.publicKey.x)).to.equal(true);
    });

    it('does not change the document, the message, or the options', () => {
      const { api, document, signer } = fixture();
      const before = JSON.stringify(document);
      const options = { verificationMethodId: '#initialKey' };
      api.btcr2.signMessage(document, MESSAGE, signer, options);

      expect(JSON.stringify(document)).to.equal(before);
      expect(options).to.deep.equal({ verificationMethodId: '#initialKey' });
    });

    it('accepts a relative or an absolute verificationMethodId', () => {
      const { api, did, document, signer } = fixture();
      for (const verificationMethodId of [ '#initialKey', `${did}#initialKey` ]) {
        const signed = api.btcr2.signMessage(document, MESSAGE, signer, { verificationMethodId });
        expect(signed.proof.verificationMethod).to.equal(`${did}#initialKey`);
      }
    });

    it('refuses a key that is in no assertionMethod method', () => {
      const { api, document } = fixture();
      const other = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);
      expect(() => api.btcr2.signMessage(document, MESSAGE, other))
        .to.throw(MethodError, 'No assertionMethod method')
        .with.property('type', 'VERIFICATION_METHOD_ERROR');
    });

    it('refuses a key that is only in capabilityInvocation', () => {
      const { api, document, signer } = fixture();
      document.assertionMethod = [];
      expect(() => api.btcr2.signMessage(document, MESSAGE, signer))
        .to.throw(MethodError, 'No assertionMethod method')
        .with.property('type', 'VERIFICATION_METHOD_ERROR');
    });

    it('refuses two matching methods and names both, and verificationMethodId selects one', () => {
      const { api, did, document, signer } = fixture();
      document.verificationMethod.push({ ...document.verificationMethod[0], id: `${did}#second` });
      document.assertionMethod!.push(`${did}#second`);

      expect(() => api.btcr2.signMessage(document, MESSAGE, signer))
        .to.throw(MethodError, `${did}#initialKey, ${did}#second`)
        .with.property('type', 'VERIFICATION_METHOD_ERROR');
      const signed = api.btcr2.signMessage(document, MESSAGE, signer, { verificationMethodId: '#second' });
      expect(signed.proof.verificationMethod).to.equal(`${did}#second`);
      expect(api.btcr2.verifyMessage(document, signed).verified).to.equal(true);
    });

    it('refuses a verificationMethodId of another key, of another DID, or out of assertionMethod', () => {
      const { api, did, document, signer } = fixture();
      document.verificationMethod.push({ ...document.verificationMethod[0], id: `${did}#other`, publicKeyMultibase: otherKeyMultibase(api) });
      document.assertionMethod!.push(`${did}#other`);
      document.verificationMethod.push({ ...document.verificationMethod[0], id: `${did}#invokeOnly` });

      expect(() => api.btcr2.signMessage(document, MESSAGE, signer, { verificationMethodId: '#other' }))
        .to.throw(MethodError, 'does not publish the key of the signer');
      expect(() => api.btcr2.signMessage(document, MESSAGE, signer, { verificationMethodId: 'did:btcr2:k1other#initialKey' }))
        .to.throw(MethodError, 'is not a usable assertionMethod method');
      expect(() => api.btcr2.signMessage(document, MESSAGE, signer, { verificationMethodId: '#invokeOnly' }))
        .to.throw(MethodError, 'is not a usable assertionMethod method');
    });

    it('refuses a method whose controller is another DID', () => {
      const { api, document, signer } = fixture();
      document.verificationMethod[0].controller = 'did:btcr2:k1other';
      expect(() => api.btcr2.signMessage(document, MESSAGE, signer))
        .to.throw(MethodError, 'No assertionMethod method');
    });

    it('refuses before the signer call: a deactivated document, a lone surrogate, a non-string message', () => {
      const { api, document, signer } = fixture();
      const spy = spySigner(signer);

      expect(() => api.btcr2.signMessage({ ...document, deactivated: true }, MESSAGE, spy.signer))
        .to.throw(MethodError, 'is deactivated')
        .with.property('type', 'PROOF_GENERATION_ERROR');
      expect(() => api.btcr2.signMessage(document, 'a\ud800b', spy.signer))
        .to.throw(MethodError, 'no lone surrogate')
        .with.property('type', 'PROOF_GENERATION_ERROR');
      expect(() => api.btcr2.signMessage(document, 42 as never, spy.signer))
        .to.throw(MethodError, 'must be a string');
      expect(spy.calls).to.have.length(0);
    });

    it('refuses a result that fails its own verification', () => {
      const { api, document, signer } = fixture();
      const broken: Signer = { publicKey: signer.publicKey, sign: () => new Uint8Array(64) };
      expect(() => api.btcr2.signMessage(document, MESSAGE, broken))
        .to.throw(MethodError, 'fails its own verification (signature check)')
        .with.property('type', 'PROOF_GENERATION_ERROR');
    });

    it('refuses a document that is not an object', () => {
      const { api, signer } = fixture();
      expect(() => api.btcr2.signMessage(null as never, MESSAGE, signer)).to.throw('document must be an object');
    });
  });

  describe('message signatures and update proofs', () => {
    it('a message proof fails as a capabilityInvocation proof', () => {
      const { api, document, signer } = fixture();
      const signed = api.btcr2.signMessage(document, MESSAGE, signer);
      const method = { ...document.verificationMethod[0], id: signed.proof.verificationMethod };
      const multikey = SchnorrMultikey.fromVerificationMethod(method);
      const proof = new BIP340DataIntegrityProof(new BIP340Cryptosuite(multikey));

      expect(() => proof.verifyProof(canonicalize(signed), 'capabilityInvocation')).to.throw('Proof purpose mismatch');
      const relabeled = { ...signed, proof: { ...signed.proof, proofPurpose: 'capabilityInvocation' } };
      expect(proof.verifyProof(canonicalize(relabeled), 'capabilityInvocation').verified).to.equal(false);
    });

    it('the signature of a message does not verify on a signed update', () => {
      const { api, did, document, signer } = fixture();
      const signed = api.btcr2.signMessage(document, MESSAGE, signer);
      const patch: PatchOperation[] = [{ op: 'add', path: '/service/-', value: { id: '#x', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' } }];
      const method = api.btcr2.getSigningMethod(document);
      const update = api.btcr2.signUpdate(did, api.btcr2.constructUpdate({ document, versionId: 1 }, patch), method, signer);
      const spliced = { ...update, proof: { ...update.proof, proofValue: signed.proof.proofValue } };
      const suite = new BIP340Cryptosuite(SchnorrMultikey.fromVerificationMethod(method));

      expect(suite.verifyProof(structuredClone(update) as never).verified).to.equal(true);
      expect(suite.verifyProof(spliced as never).verified).to.equal(false);
    });

    it('a signed update is not a signed message', () => {
      const { api, did, document, signer } = fixture();
      const patch: PatchOperation[] = [{ op: 'add', path: '/service/-', value: { id: '#x', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' } }];
      const update = api.btcr2.signUpdate(did, api.btcr2.constructUpdate({ document, versionId: 1 }, patch), api.btcr2.getSigningMethod(document), signer);

      const report = api.btcr2.verifyMessage(document, JSON.parse(JSON.stringify(update)));
      expect(report.verified).to.equal(false);
      expect(failure(report).name).to.equal('structure');
    });
  });

  describe('verifyMessage()', () => {
    /** A valid signed message of the fixture DID, as a plain object. */
    function signedFixture() {
      const base = fixture();
      const signed = base.api.btcr2.signMessage(base.document, MESSAGE, base.signer);
      return { ...base, signed: JSON.parse(JSON.stringify(signed)) as Record<string, any> };
    }

    it('fails the structure check for each value outside the closed format', () => {
      const { api, document, signed } = signedFixture();
      const cases: Array<[ unknown, string ]> = [
        [ null, 'must be a JSON object' ],
        [ [ signed ], 'must be a JSON object' ],
        [ 42, 'must be a JSON object' ],
        [ { ...signed, extra: 1 }, 'exactly the members type, message, and proof' ],
        [ { message: signed.message, proof: signed.proof }, 'exactly the members type, message, and proof' ],
        [ { ...signed, type: 'Message' }, 'must be BTCR2Message' ],
        [ { ...signed, message: 7 }, 'well-formed Unicode text' ],
        [ { ...signed, message: 'a\udc00' }, 'well-formed Unicode text' ],
        [ { ...signed, proof: 'z1' }, 'The proof must be a JSON object' ],
        [ { ...signed, proof: { ...signed.proof, created: '2026-10-06T00:00:00Z' } }, 'exactly the members type, cryptosuite' ],
        [ { ...signed, proof: { ...signed.proof, challenge: 'abc' } }, 'exactly the members type, cryptosuite' ],
        [ { ...signed, proof: { ...signed.proof, '@context': 'https://w3id.org/security/data-integrity/v2' } }, 'exactly the members type, cryptosuite' ],
        [ { ...signed, proof: { ...signed.proof, capability: 'urn:zcap:root:x' } }, 'exactly the members type, cryptosuite' ],
        [ { ...signed, proof: { ...signed.proof, proofValue: undefined } }, 'exactly the members type, cryptosuite' ],
        [ { ...signed, proof: { ...signed.proof, proofValue: 7 } }, 'proofValue must be a string' ],
        [ { ...signed, proof: { ...signed.proof, type: 'Ed25519Signature2020' } }, 'proof type must be DataIntegrityProof' ],
        [ { ...signed, proof: { ...signed.proof, cryptosuite: 'bip340-rdfc-2025' } }, 'cryptosuite must be bip340-jcs-2025' ],
        [ { ...signed, proof: { ...signed.proof, proofPurpose: 'capabilityInvocation' } }, 'purpose must be assertionMethod' ],
        [ { ...signed, proof: { ...signed.proof, proofValue: 'z' } }, 'proofValue must be z and 64 to 88 base58btc' ],
        [ { ...signed, proof: { ...signed.proof, proofValue: 'not-base58' } }, 'proofValue must be z and 64 to 88 base58btc' ],
        [ { ...signed, proof: { ...signed.proof, proofValue: `u${signed.proof.proofValue.slice(1)}` } }, 'proofValue must be z and 64 to 88 base58btc' ],
        [ { ...signed, proof: { ...signed.proof, proofValue: `${signed.proof.proofValue}0` } }, 'proofValue must be z and 64 to 88 base58btc' ],
        [ { ...signed, proof: { ...signed.proof, proofValue: `z${'2'.repeat(89)}` } }, 'proofValue must be z and 64 to 88 base58btc' ],
        [ { ...signed, proof: { ...signed.proof, proofValue: `z${'2'.repeat(63)}` } }, 'proofValue must be z and 64 to 88 base58btc' ],
        // A character out of the base58btc alphabet, at a valid length.
        [ { ...signed, proof: { ...signed.proof, proofValue: `z${'0'.repeat(64)}` } }, 'proofValue must be z and 64 to 88 base58btc' ],
        // A long value with a valid tail: the pattern must match from the first character.
        [ { ...signed, proof: { ...signed.proof, proofValue: `z${'2'.repeat(100)}z${'2'.repeat(70)}` } }, 'proofValue must be z and 64 to 88 base58btc' ],
      ];
      for (const [ value, detail ] of cases) {
        const report = api.btcr2.verifyMessage(document, JSON.parse(JSON.stringify(value) ?? 'null'));
        expect(report.verified, JSON.stringify(value)).to.equal(false);
        expect(report.checks, JSON.stringify(value)).to.have.length(1);
        expect(failure(report).name).to.equal('structure');
        expect(failure(report).detail).to.include(detail);
        expect(report).to.not.have.property('message');
      }
    });

    it('fails the signer check for the document of another DID, or a relative method id', () => {
      const { api, signed } = signedFixture();
      const other = fixture();
      const report = api.btcr2.verifyMessage(other.document, signed);
      expect(failure(report)).to.include({ name: 'signer', ok: false });
      expect(report.verificationMethod).to.equal(signed.proof.verificationMethod);

      const { document } = signedFixture();
      const relative = { ...signed, proof: { ...signed.proof, verificationMethod: '#initialKey' } };
      expect(failure(api.btcr2.verifyMessage(document, relative)).name).to.equal('signer');
    });

    it('fails the active check for a deactivated document', () => {
      const { api, document, signed } = signedFixture();
      const report = api.btcr2.verifyMessage({ ...document, deactivated: true }, signed);
      expect(failure(report)).to.deep.equal({ name: 'active', ok: false, detail: `The DID document of ${document.id} is deactivated.` });
    });

    it('fails the assertionMethod check for a removed method, a wrong controller, a wrong type, and no key', () => {
      const { api, did, document, signed } = signedFixture();
      const cases: Array<[ Btcr2DidDocument, string ]> = [
        [ { ...document, assertionMethod: [] }, 'is not in the assertionMethod' ],
        [ { ...document, verificationMethod: [] }, 'has no verification method' ],
        [ { ...document, verificationMethod: [{ ...document.verificationMethod[0], controller: 'did:btcr2:k1other' }] }, 'The controller of the method' ],
        [ { ...document, verificationMethod: [{ ...document.verificationMethod[0], type: 'JsonWebKey' }] }, 'not Multikey' ],
        [ { ...document, verificationMethod: [{ id: `${did}#initialKey`, type: 'Multikey', controller: did } as never] }, 'no valid secp256k1 Multikey' ],
      ];
      for (const [ changed, detail ] of cases) {
        const report = api.btcr2.verifyMessage(changed, signed);
        expect(failure(report).name).to.equal('assertionMethod');
        expect(failure(report).detail).to.include(detail);
      }
    });

    it('accepts an embedded method in assertionMethod', () => {
      const { api, document, signed } = signedFixture();
      const embedded = { ...document, assertionMethod: [ document.verificationMethod[0] ] };
      expect(api.btcr2.verifyMessage(embedded, signed).verified).to.equal(true);
    });

    it('fails the signature check for a changed message or a bad proofValue, and never throws', () => {
      const { api, document, signed } = signedFixture();
      const changed = api.btcr2.verifyMessage(document, { ...signed, message: `${MESSAGE}!` });
      expect(failure(changed)).to.deep.equal({
        name   : 'signature',
        ok     : false,
        detail : 'The signature does not match the message and the key of the method.',
      });
      expect(changed).to.not.have.property('message');

      // 88 characters "z" decode to 65 bytes, so the decode passes and the length check of the cryptosuite throws.
      const badValue = api.btcr2.verifyMessage(document, { ...signed, proof: { ...signed.proof, proofValue: `z${'z'.repeat(88)}` } });
      expect(failure(badValue).name).to.equal('signature');
      expect(failure(badValue).detail).to.include('The proof does not verify');
    });

    it('refuses an oversized proofValue at the structure check, before the base58 decode', () => {
      const { api, document, signed } = signedFixture();
      // A decode of 1 000 000 characters takes minutes, so a missing bound times out the test.
      const report = api.btcr2.verifyMessage(document, { ...signed, proof: { ...signed.proof, proofValue: `z${'2'.repeat(1_000_000)}` } });
      expect(failure(report).name).to.equal('structure');
      expect(failure(report).detail).to.include('proofValue must be z and 64 to 88 base58btc');
    });

    it('passes the shortest proofValue of 64 bytes to the signature check', () => {
      const { api, document, signed } = signedFixture();
      // 64 zero bytes encode to 64 characters "1", the shortest base58btc value of 64 bytes.
      const zeros = api.btcr2.verifyMessage(document, { ...signed, proof: { ...signed.proof, proofValue: `z${'1'.repeat(64)}` } });
      expect(failure(zeros).name).to.equal('signature');
    });

    it('refuses a document that is not an object', () => {
      const { api, signed } = signedFixture();
      expect(() => api.btcr2.verifyMessage(undefined as never, signed)).to.throw('document must be an object');
    });
  });
});
