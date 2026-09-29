import { expect } from 'chai';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { createApi, MethodError, UpdateError } from '../src/index.js';
import type { PatchOperation, SourceState } from '../src/index.js';

/** A KEY DID, its initial document as the source of version 2, and its signer. */
function offlineFixture() {
  const api = createApi();
  const kp = SchnorrKeyPair.generate();
  const did = api.btcr2.createDeterministic(kp.publicKey.compressed);
  const source: SourceState = { document: api.btcr2.getInitialDocument(did), versionId: 1 };
  const verificationMethod = api.btcr2.getSigningMethod(source.document);
  const signer = new LocalSigner(kp.secretKey.bytes);
  return { api, did, source, verificationMethod, signer };
}

const ADD_SERVICE: PatchOperation[] = [{
  op    : 'add',
  path  : '/service/-',
  value : { id: '#linked', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' },
}];

/**
 * DidMethodApi offline update steps (ADR 132)
 */
describe('DidMethodApi offline update steps', () => {
  describe('constructUpdate()', () => {
    it('hashes the source and the target and targets versionId + 1', () => {
      const { api, source } = offlineFixture();
      const unsigned = api.btcr2.constructUpdate(source, ADD_SERVICE);

      expect(unsigned.patch).to.deep.equal(ADD_SERVICE);
      expect(unsigned.targetVersionId).to.equal(2);
      expect(unsigned.sourceHash).to.equal(api.btcr2.hashDocument(source.document));
      expect(unsigned.targetHash).to.equal(api.btcr2.hashDocument(api.btcr2.applyPatch(source.document, ADD_SERVICE)));
    });

    it('refuses a patch that changes the document id', () => {
      const { api, source } = offlineFixture();
      expect(() => api.btcr2.constructUpdate(source, [{ op: 'replace', path: '/id', value: 'did:btcr2:other' }]))
        .to.throw(UpdateError, 'must not change the DID document id');
    });

    it('refuses a source that is not an object', () => {
      const { api } = offlineFixture();
      expect(() => api.btcr2.constructUpdate(null as never, ADD_SERVICE)).to.throw('source must be an object');
    });
  });

  describe('signUpdate()', () => {
    it('adds a proof that invokes the root capability and that verifies', () => {
      const { api, did, source, verificationMethod, signer } = offlineFixture();
      const signed = api.btcr2.signUpdate(did, api.btcr2.constructUpdate(source, ADD_SERVICE), verificationMethod, signer);

      expect(signed.proof.capability).to.equal(api.btcr2.rootCapability(did).id);
      expect(signed.proof.verificationMethod).to.equal(verificationMethod.id);
      const suite = api.crypto.cryptosuite.create(api.crypto.multikey.fromVerificationMethod(verificationMethod));
      expect(api.crypto.cryptosuite.verifyProof(structuredClone(signed), suite).verified).to.equal(true);
    });

    it('refuses a signer whose key is not the key of the verification method', () => {
      const { api, did, source, verificationMethod } = offlineFixture();
      const other = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);
      expect(() => api.btcr2.signUpdate(did, api.btcr2.constructUpdate(source, ADD_SERVICE), verificationMethod, other))
        .to.throw(UpdateError, 'Signing key does not match');
    });

    it('refuses a verification method without publicKeyMultibase', () => {
      const { api, did, source, verificationMethod, signer } = offlineFixture();
      const { publicKeyMultibase: _omitted, ...withoutKey } = verificationMethod;
      expect(() => api.btcr2.signUpdate(did, api.btcr2.constructUpdate(source, ADD_SERVICE), withoutKey, signer))
        .to.throw(UpdateError, 'must have a publicKeyMultibase');
    });
  });

  describe('hashDocument()', () => {
    it('does not depend on the property order and gives base64url with no padding', () => {
      const { api } = offlineFixture();
      expect(api.btcr2.hashDocument({ b: 1, a: 2 })).to.equal(api.btcr2.hashDocument({ a: 2, b: 1 }));
      expect(api.btcr2.hashDocument({ a: 2, b: 1 })).to.match(/^[A-Za-z0-9_-]{43}$/);
    });

    it('refuses a value that is not an object', () => {
      const { api } = offlineFixture();
      expect(() => api.btcr2.hashDocument('text' as never)).to.throw('document must be an object');
    });
  });

  describe('applyPatch()', () => {
    it('returns a new document and does not change the source', () => {
      const { api } = offlineFixture();
      const source = { a: 1 };
      expect(api.btcr2.applyPatch(source, [{ op: 'add', path: '/b', value: 2 }])).to.deep.equal({ a: 1, b: 2 });
      expect(source).to.deep.equal({ a: 1 });
    });

    it('fails the whole patch at a failed test operation', () => {
      const { api } = offlineFixture();
      expect(() => api.btcr2.applyPatch({ a: 1 }, [
        { op: 'add', path: '/b', value: 2 },
        { op: 'test', path: '/a', value: 9 },
      ])).to.throw(MethodError);
    });
  });

  describe('rootCapability()', () => {
    it('gives the root capability of the DID', () => {
      const { api, did } = offlineFixture();
      expect(api.btcr2.rootCapability(did)).to.deep.equal({
        '@context'       : 'https://w3id.org/zcap/v1',
        id               : `urn:zcap:root:${encodeURIComponent(did)}`,
        controller       : did,
        invocationTarget : did,
      });
    });
  });
});
