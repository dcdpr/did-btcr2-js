import { expect } from 'chai';
import { INVALID_DID_UPDATE } from '@did-btcr2/common';
import { CompressedSecp256k1PublicKey, LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { createApi, DidMethodApi, MethodError, UpdateError } from '../src/index.js';
import type { Btcr2DidDocument, PatchOperation, SourceState, UnsignedBTCR2Update } from '../src/index.js';

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

/** A copy of the source document as a plain JSON object that a test can change. */
function plainDocument(source: SourceState): Btcr2DidDocument {
  return JSON.parse(JSON.stringify(source.document)) as Btcr2DidDocument;
}

/** The error that `fn` throws. */
function thrown(fn: () => unknown): any {
  try {
    fn();
  } catch (error) {
    return error;
  }
  expect.fail('expected an error');
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

    it('refuses a versionId that is not an integer of 1 or more', () => {
      const { api, source } = offlineFixture();
      // The versionId of didDocumentMetadata is the string '1'. Without the check, the target is '11'.
      for (const versionId of [ '1', 0, undefined ]) {
        const error = thrown(() => api.btcr2.constructUpdate({ ...source, versionId: versionId as number }, ADD_SERVICE));
        expect(error, String(versionId)).to.be.instanceOf(UpdateError);
        expect(error.message).to.equal('Invalid sourceVersionId: expected an integer of 1 or more.');
        expect(error.type).to.equal(INVALID_DID_UPDATE);
        expect(error.data).to.deep.equal({ sourceVersionId: versionId });
      }
    });
  });

  describe('signUpdate()', () => {
    it('adds a proof that invokes the root capability and that verifies', () => {
      const { api, did, source, verificationMethod, signer } = offlineFixture();
      const signed = api.btcr2.signUpdate(source, api.btcr2.constructUpdate(source, ADD_SERVICE), verificationMethod.id, signer);

      expect(signed.proof.capability).to.equal(api.btcr2.rootCapability(did).id);
      expect(signed.proof.verificationMethod).to.equal(verificationMethod.id);
      const suite = api.crypto.cryptosuite.create(api.crypto.multikey.fromVerificationMethod(verificationMethod));
      expect(api.crypto.cryptosuite.verifyProof(structuredClone(signed), suite).verified).to.equal(true);
    });

    it('names the method by its absolute id if the caller gives a relative id', () => {
      const { api, did, source, signer } = offlineFixture();
      const signed = api.btcr2.signUpdate(source, api.btcr2.constructUpdate(source, ADD_SERVICE), '#initialKey', signer);
      expect(signed.proof.verificationMethod).to.equal(`${did}#initialKey`);
    });

    it('refuses a signer whose key is not the key of the verification method', () => {
      const { api, did, source, verificationMethod } = offlineFixture();
      const other = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);
      const error = thrown(() => api.btcr2.signUpdate(source, api.btcr2.constructUpdate(source, ADD_SERVICE), verificationMethod.id, other));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal(
        `Signing key does not match verification method "${did}#initialKey": the signer's public `
        + 'key differs from the method\'s published publicKeyMultibase.'
      );
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({
        verificationMethodId : `${did}#initialKey`,
        expected             : verificationMethod.publicKeyMultibase,
        actual               : new CompressedSecp256k1PublicKey(other.publicKey).multibase.encoded,
      });
    });

    it('refuses a source that is not an object', () => {
      const { api, source, signer } = offlineFixture();
      const unsigned = api.btcr2.constructUpdate(source, ADD_SERVICE);
      const error = thrown(() => api.btcr2.signUpdate(null as never, unsigned, '#initialKey', signer));
      expect(error.constructor).to.equal(Error);
      expect(error.message).to.equal('source must be an object.');
    });

    it('refuses an update whose targetVersionId is not source.versionId + 1', () => {
      const { api, source, signer } = offlineFixture();
      // An update of version 2 that the caller signs against a resolution of version 3.
      const unsigned = api.btcr2.constructUpdate(source, ADD_SERVICE);
      const error = thrown(() => api.btcr2.signUpdate({ ...source, versionId: 3 }, unsigned, '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal(
        'Invalid update: targetVersionId is 2, but the source has versionId 3. Construct the update from this source.'
      );
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({ targetVersionId: 2, sourceVersionId: 3 });
    });

    it('refuses an update whose targetVersionId skips a version of the source', () => {
      const { api, source, signer } = offlineFixture();
      // Updater.sign accepts each targetVersionId of 2 or more, so only the api refuses this update.
      const unsigned = { ...api.btcr2.constructUpdate(source, ADD_SERVICE), targetVersionId: 3 };
      const error = thrown(() => api.btcr2.signUpdate(source, unsigned, '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal(
        'Invalid update: targetVersionId is 3, but the source has versionId 1. Construct the update from this source.'
      );
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({ targetVersionId: 3, sourceVersionId: 1 });
    });

    it('refuses a source versionId that is not an integer of 1 or more', () => {
      const { api, source, signer } = offlineFixture();
      const unsigned = api.btcr2.constructUpdate(source, ADD_SERVICE);
      for (const versionId of [ '1', 0 ]) {
        const error = thrown(() => api.btcr2.signUpdate({ ...source, versionId: versionId as number }, unsigned, '#initialKey', signer));
        expect(error, String(versionId)).to.be.instanceOf(UpdateError);
        expect(error.message).to.equal('Invalid sourceVersionId: expected an integer of 1 or more.');
        expect(error.type).to.equal(INVALID_DID_UPDATE);
        expect(error.data).to.deep.equal({ sourceVersionId: versionId });
      }
    });

    it('lets the Updater refuse a targetVersionId that is not an integer', () => {
      const { api, source, signer } = offlineFixture();
      const unsigned = { ...api.btcr2.constructUpdate(source, ADD_SERVICE), targetVersionId: '2' as never };
      const error = thrown(() => api.btcr2.signUpdate(source, unsigned, '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal('Invalid unsignedUpdate: targetVersionId must be an integer of 2 or more.');
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({ field: 'targetVersionId', actual: '2' });
    });

    it('lets the Updater refuse an unsigned update that is not an object', () => {
      const { api, source, signer } = offlineFixture();
      const error = thrown(() => api.btcr2.signUpdate(source, null as never, '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal('Invalid unsignedUpdate: expected an object.');
      expect(error.data).to.deep.equal({ unsignedUpdate: null });
    });

    it('refuses an unsigned update of another source document', () => {
      const { api, source, signer } = offlineFixture();
      const other = offlineFixture();
      const unsigned = other.api.btcr2.constructUpdate(other.source, ADD_SERVICE);
      const error = thrown(() => api.btcr2.signUpdate(source, unsigned, '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal('Invalid unsignedUpdate: sourceHash is not the hash of sourceDocument.');
      expect(error.data).to.deep.equal({
        field    : 'sourceHash',
        expected : api.btcr2.hashDocument(source.document),
        actual   : unsigned.sourceHash,
      });
    });

    it('refuses a verification method without publicKeyMultibase', () => {
      const { api, did, source, signer } = offlineFixture();
      const document = plainDocument(source);
      delete document.verificationMethod[0]!.publicKeyMultibase;
      const changed: SourceState = { document, versionId: 1 };
      const error = thrown(() => api.btcr2.signUpdate(changed, api.btcr2.constructUpdate(changed, ADD_SERVICE), '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal(
        'Invalid update: verificationMethod.publicKeyMultibase must encode a secp256k1 public key as a BIP340 Multikey'
      );
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({
        verificationMethodId : `${did}#initialKey`,
        field                : 'publicKeyMultibase',
        actual               : undefined,
      });
    });

    it('refuses a method that capabilityInvocation does not name', () => {
      const { api, did, source, signer } = offlineFixture();
      const document = plainDocument(source);
      // The method has the key of the signer, but only the authentication relationship.
      document.verificationMethod.push({ ...document.verificationMethod[0]!, id: `${did}#key-1` });
      document.authentication!.push(`${did}#key-1`);
      const changed: SourceState = { document, versionId: 1 };
      const error = thrown(() => api.btcr2.signUpdate(changed, api.btcr2.constructUpdate(changed, ADD_SERVICE), '#key-1', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal('Invalid verificationMethodId: not authorized for capabilityInvocation');
      expect(error.data).to.deep.equal({ verificationMethodId: `${did}#key-1`, capabilityInvocation: [ `${did}#initialKey` ] });
    });

    for(const [ field, value ] of [ [ 'type', 'JsonWebKey2020' ], [ 'controller', 'did:example:other' ] ] as const) {
      it(`refuses a capabilityInvocation method whose ${field} is ${value}`, () => {
        const { api, did, source, signer } = offlineFixture();
        const document = plainDocument(source);
        // #initialKey can still sign, so the refusal is about #key-1 only.
        document.verificationMethod.push({ ...document.verificationMethod[0]!, id: `${did}#key-1`, [field]: value });
        document.capabilityInvocation!.push(`${did}#key-1`);
        const changed: SourceState = { document, versionId: 1 };
        const error = thrown(() => api.btcr2.signUpdate(changed, api.btcr2.constructUpdate(changed, ADD_SERVICE), '#key-1', signer));
        expect(error).to.be.instanceOf(UpdateError);
        expect(error.message).to.equal(field === 'type'
          ? 'Invalid update: verificationMethod.type must equal "Multikey"'
          : `Invalid update: verificationMethod.controller must equal "${did}"`);
        expect(error.data).to.deep.equal({ verificationMethodId: `${did}#key-1`, field, actual: value });
      });
    }
  });

  describe('signUpdate() refuses an update that leaves no method that can sign', () => {
    const RETYPE: PatchOperation[] = [{ op: 'replace', path: '/verificationMethod/0/type', value: 'MultiKey' }];
    const REMOVE: PatchOperation[] = [{ op: 'remove', path: '/capabilityInvocation' }];

    /** The message of the refusal for `did`. */
    const lockOut = (did: string): string =>
      'Invalid update: after this update, the DID document has no capabilityInvocation method that can sign '
      + `an update. Nobody can update or deactivate ${did} again.`;

    it('refuses an update that changes the type of the only signing method', () => {
      const { api, did, source, signer } = offlineFixture();
      const error = thrown(() => api.btcr2.signUpdate(source, api.btcr2.constructUpdate(source, RETYPE), '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal(lockOut(did));
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({
        did,
        methods : [{
          verificationMethodId : `${did}#initialKey`,
          reason               : 'Invalid update: verificationMethod.type must equal "Multikey"',
        }],
      });
    });

    it('refuses an update that removes capabilityInvocation', () => {
      const { api, did, source, signer } = offlineFixture();
      const error = thrown(() => api.btcr2.signUpdate(source, api.btcr2.constructUpdate(source, REMOVE), '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal(lockOut(did));
      expect(error.data).to.deep.equal({ did, methods: [] });
    });

    it('refuses an update that removes capabilityInvocation and sets deactivated to the string "true"', () => {
      const { api, did, source, signer } = offlineFixture();
      // Only deactivated === true deactivates the DID.
      const patch: PatchOperation[] = [ ...REMOVE, { op: 'add', path: '/deactivated', value: 'true' } ];
      const error = thrown(() => api.btcr2.signUpdate(source, api.btcr2.constructUpdate(source, patch), '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal(lockOut(did));
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({ did, methods: [] });
    });

    it('lets the Updater refuse an update of another source document, also if its patch removes capabilityInvocation', () => {
      const { api, source, signer } = offlineFixture();
      const other = offlineFixture();
      const unsigned = other.api.btcr2.constructUpdate(other.source, REMOVE);
      const error = thrown(() => api.btcr2.signUpdate(source, unsigned, '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal('Invalid unsignedUpdate: sourceHash is not the hash of sourceDocument.');
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({
        field    : 'sourceHash',
        expected : api.btcr2.hashDocument(source.document),
        actual   : unsigned.sourceHash,
      });
    });

    it('lets the Updater refuse an update of another document that gives the same target document', () => {
      const { api, source, signer } = offlineFixture();
      // The patch overwrites the only difference of the two documents, so only the source hashes differ.
      const patch: PatchOperation[] = [{ op: 'add', path: '/alsoKnownAs', value: [ 'https://example.com/new' ] }, ...REMOVE];
      const older: SourceState = { document: { ...plainDocument(source), alsoKnownAs: [ 'https://example.com/old' ] }, versionId: 1 };
      const unsigned = api.btcr2.constructUpdate(older, patch);
      expect(unsigned.targetHash).to.equal(api.btcr2.constructUpdate(source, patch).targetHash);
      const error = thrown(() => api.btcr2.signUpdate(source, unsigned, '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal('Invalid unsignedUpdate: sourceHash is not the hash of sourceDocument.');
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({
        field    : 'sourceHash',
        expected : api.btcr2.hashDocument(source.document),
        actual   : unsigned.sourceHash,
      });
    });

    it('lets the Updater refuse a wrong targetHash, also if the patch removes capabilityInvocation', () => {
      const { api, source, signer } = offlineFixture();
      const valid = api.btcr2.constructUpdate(source, REMOVE);
      const unsigned = { ...valid, targetHash: valid.sourceHash };
      const error = thrown(() => api.btcr2.signUpdate(source, unsigned, '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal('Invalid unsignedUpdate: targetHash is not the hash of the document that the patch gives.');
      expect(error.type).to.equal(INVALID_DID_UPDATE);
      expect(error.data).to.deep.equal({ field: 'targetHash', expected: valid.targetHash, actual: valid.sourceHash });
    });

    it('lets the Updater name its own cause first, also if the patch removes capabilityInvocation', () => {
      const { api, did, source, signer } = offlineFixture();
      const valid = api.btcr2.constructUpdate(source, REMOVE);
      const cases: Array<{ unsigned: UnsignedBTCR2Update; methodId: string; message: string }> = [
        {
          unsigned : { ...valid, '@context': [ 'https://example.com/context' ] },
          methodId : '#initialKey',
          message  : 'Invalid unsignedUpdate: @context must be the BTCR2 update context.',
        },
        {
          unsigned : { ...valid, proof: {} } as UnsignedBTCR2Update,
          methodId : '#initialKey',
          message  : 'Invalid unsignedUpdate: an unsigned update must not have a proof.',
        },
        {
          unsigned : valid,
          methodId : '#nope',
          message  : 'Invalid verificationMethodId: not authorized for capabilityInvocation',
        },
      ];
      for(const { unsigned, methodId, message } of cases) {
        const error = thrown(() => api.btcr2.signUpdate(source, unsigned, methodId, signer));
        expect(error, message).to.be.instanceOf(UpdateError);
        expect(error.message).to.equal(message);
        expect(error.type).to.equal(INVALID_DID_UPDATE);
      }
      // The same update with a valid method id gets the refusal of the guard.
      expect(thrown(() => api.btcr2.signUpdate(source, valid, '#initialKey', signer)).message).to.equal(lockOut(did));
    });

    for(const [ name, patch ] of [ [ 'changes the type', RETYPE ], [ 'removes capabilityInvocation', REMOVE ] ] as const) {
      it(`signs an update that ${name} and also deactivates the DID`, () => {
        const { api, source, signer } = offlineFixture();
        const deactivation = [ ...patch, { ...DidMethodApi.DEACTIVATION_PATCH } ];
        const signed = api.btcr2.signUpdate(source, api.btcr2.constructUpdate(source, deactivation), '#initialKey', signer);
        expect(signed.patch).to.deep.equal(deactivation);
      });
    }

    it('signs an update after which one of two capabilityInvocation methods can sign', () => {
      const { api, did, source, signer } = offlineFixture();
      const document = plainDocument(source);
      const other = api.btcr2.getInitialDocument(api.btcr2.createDeterministic(SchnorrKeyPair.generate().publicKey.compressed));
      document.verificationMethod.push({ ...document.verificationMethod[0]!, id: `${did}#key-2`, publicKeyMultibase: other.verificationMethod[0]!.publicKeyMultibase });
      document.capabilityInvocation!.push(`${did}#key-2`);
      const changed: SourceState = { document, versionId: 1 };
      // #initialKey signs this update. After it, only #key-2 can sign.
      const signed = api.btcr2.signUpdate(changed, api.btcr2.constructUpdate(changed, RETYPE), '#initialKey', signer);
      expect(signed.proof.verificationMethod).to.equal(`${did}#initialKey`);
    });

    it('signs an update that moves the signing method into an embedded entry', () => {
      const { api, did, source, signer } = offlineFixture();
      const embedded = { ...plainDocument(source).verificationMethod[0]!, id: `${did}#embedded` };
      const patch: PatchOperation[] = [{ op: 'replace', path: '/capabilityInvocation', value: [ embedded ] }];
      const signed = api.btcr2.signUpdate(source, api.btcr2.constructUpdate(source, patch), '#initialKey', signer);
      expect(signed.patch).to.deep.equal(patch);
    });

    it('lets the Updater refuse a patch that does not give a valid DID document', () => {
      const { api, did, source, signer } = offlineFixture();
      // The new id leaves no method of the DID, but the Updater refuses the patch first.
      const otherDid = api.btcr2.createDeterministic(SchnorrKeyPair.generate().publicKey.compressed);
      const unsigned = {
        ...api.btcr2.constructUpdate(source, ADD_SERVICE),
        patch : [{ op: 'replace', path: '/id', value: otherDid }] as PatchOperation[],
      };
      const error = thrown(() => api.btcr2.signUpdate(source, unsigned, '#initialKey', signer));
      expect(error).to.be.instanceOf(UpdateError);
      expect(error.message).to.equal(
        'Invalid unsignedUpdate: the patch does not give a valid DID document from sourceDocument: '
        + `Patches must not change the DID document id (source "${did}" to target "${otherDid}").`
      );
      expect(error.data.field).to.equal('patch');
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
