import { canonicalHash, canonicalHashBytes, canonicalize, DidDocumentError, INVALID_DID, INVALID_DID_DOCUMENT, ResolveError } from '@did-btcr2/std';
import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import type { BeaconService, BeaconSignal } from '../src/core/beacon/interfaces.js';
import type { NeedBeaconSignals } from '../src/core/resolver.js';
import data from './data/external-data.js';

/**
 * Resolve External Test Cases
 */
describe('Resolve External', () => {
  it('should return a Resolver that starts in GenesisDocument phase without sidecar genesis doc',
    async () => {
      for(const {did} of data) {
        // Create resolver WITHOUT genesis document - should request it
        const resolver = DidBtcr2.resolve(did);
        const state = resolver.resolve();

        expect(state.status).to.equal('action-required');
        if(state.status !== 'action-required') return;
        expect(state.needs).to.have.lengthOf(1);
        expect(state.needs[0]).to.have.property('kind', 'NeedGenesisDocument');
        expect(state.needs[0]).to.have.property('genesisHash');
      }
    });

  it('should resolve each external identifier to its corresponding did document',
    async () => {
      for(const {did, genesisDocument} of data) {
        const resolver = DidBtcr2.resolve(did, { sidecar: { genesisDocument } });

        // First resolve() - genesis doc was in sidecar, validates hash and requests signals
        const state = resolver.resolve();
        expect(state.status).to.equal('action-required');
        if(state.status !== 'action-required') return;
        expect(state.needs[0]).to.have.property('kind', 'NeedBeaconSignals');

        // Provide empty signals (no on-chain updates for these test DIDs)
        const emptySignals = new Map<BeaconService, Array<BeaconSignal>>();
        resolver.provide(state.needs[0] as NeedBeaconSignals, emptySignals);

        // Second resolve() should complete
        const final = resolver.resolve();
        expect(final.status).to.equal('resolved');
        if(final.status !== 'resolved') return;
        expect(final.result).to.have.property('didDocument');
        expect(final.result.didDocument).to.have.property('id', did);
      }
    });

  it('rejects a genesis document whose hash is not the genesis bytes with INVALID_DID',
    () => {
      const { did, genesisDocument } = data[0];
      const wrongDocument = { ...genesisDocument, service: [] };
      const resolver = DidBtcr2.resolve(did, { sidecar: { genesisDocument: wrongDocument } });
      let caught: unknown;
      try {
        resolver.resolve();
      } catch (error: unknown) {
        caught = error;
      }
      // The specification raises INVALID_DID when the computed hash does not match genesis_bytes.
      expect(caught).to.be.instanceOf(ResolveError);
      expect(caught).to.have.property('type', INVALID_DID);
      expect((caught as Error).message).to.match(/Initial document mismatch/);
    });

  it('rejects a genesis document whose id is not the placeholder with INVALID_DID_DOCUMENT',
    () => {
      const { genesisDocument } = data[2]; // regtest
      const otherDid = data[0].did;
      // The first document names another DID only in its id. The second names it in each
      // place of the placeholder, as the initial document of that DID does.
      const documents = [
        { ...genesisDocument, id: otherDid },
        JSON.parse(JSON.stringify(genesisDocument).replaceAll('did:btcr2:_', otherDid)),
      ];
      for(const document of documents) {
        const did = DidBtcr2.create(canonicalHashBytes(document), { idType: 'EXTERNAL', version: 1, network: 'regtest' });
        const resolver = DidBtcr2.resolve(did, { sidecar: { genesisDocument: document } });
        let caught: unknown;
        try {
          resolver.resolve();
        } catch (error: unknown) {
          caught = error;
        }
        expect(caught).to.be.instanceOf(ResolveError);
        expect(caught).to.have.property('type', INVALID_DID_DOCUMENT);
        expect((caught as Error).message).to.match(/the id must be "did:btcr2:_"/);
      }
    });

  describe('genesis documents without optional members (ADR 148)', () => {
    // Spec "DID Document": "@context" and "id" are required. "verificationMethod" and
    // "service" are optional. Spec "If `genesis_bytes` is a SHA-256 Hash": current_document
    // is the genesis document with each placeholder replaced by the DID, and it must
    // conform to DID Core.
    const RELATIONSHIPS = ['authentication', 'assertionMethod', 'capabilityInvocation', 'capabilityDelegation'];

    /** A copy of the regtest genesis fixture with the change of `change`. */
    function changedGenesis(change: (document: Record<string, any>) => void): Record<string, any> {
      const document = JSON.parse(JSON.stringify(data[2].genesisDocument)) as Record<string, any>;
      change(document);
      return document;
    }

    /** The EXTERNAL regtest DID whose genesis bytes are the hash of `document`. */
    function didOf(document: object): string {
      return DidBtcr2.create(canonicalHashBytes(document), { idType: 'EXTERNAL', version: 1, network: 'regtest' });
    }

    /**
     * The current_document of Spec "If `genesis_bytes` is a SHA-256 Hash": JCS, replace each
     * placeholder with the DID, parse.
     */
    function currentDocument(document: object, did: string): Record<string, any> {
      return JSON.parse(canonicalize(document).replaceAll('did:btcr2:_', did));
    }

    it('refuses a genesis document without "@context" with INVALID_DID_DOCUMENT', () => {
      const genesisDocument = changedGenesis(document => { delete document['@context']; });
      const resolver = DidBtcr2.resolve(didOf(genesisDocument), { sidecar: { genesisDocument } });
      let caught: any;
      try {
        resolver.resolve();
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).to.be.instanceOf(DidDocumentError);
      expect(caught).to.have.property('type', INVALID_DID_DOCUMENT);
      expect(caught.message).to.equal('Invalid "@context"');
    });

    it('resolves a genesis document without service at version 1 with no beacon signal need', () => {
      const genesisDocument = changedGenesis(document => { delete document.service; });
      const did = didOf(genesisDocument);
      const resolver = DidBtcr2.resolve(did, { sidecar: { genesisDocument } });
      // The document has no beacon, so the resolver asks for no signals.
      const state = resolver.resolve();
      expect(state.status).to.equal('resolved');
      if(state.status !== 'resolved') return;
      const { didDocument, metadata } = state.result;
      expect(metadata.versionId).to.equal('1');
      expect(didDocument).to.not.have.own.property('service');
      expect(JSON.parse(JSON.stringify(didDocument))).to.deep.equal(currentDocument(genesisDocument, did));
      expect(canonicalHash(didDocument)).to.equal(canonicalHash(currentDocument(genesisDocument, did)));
    });

    it('resolves a genesis document without verificationMethod whose relationships embed the method', () => {
      const genesisDocument = changedGenesis(document => {
        const [method] = document.verificationMethod;
        for(const relationship of RELATIONSHIPS) {
          document[relationship] = [{ ...method }];
        }
        delete document.verificationMethod;
      });
      const did = didOf(genesisDocument);
      const resolver = DidBtcr2.resolve(did, { sidecar: { genesisDocument } });
      const state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0]).to.have.property('kind', 'NeedBeaconSignals');
      resolver.provide(state.needs[0] as NeedBeaconSignals, new Map<BeaconService, Array<BeaconSignal>>());
      const final = resolver.resolve();
      expect(final.status).to.equal('resolved');
      if(final.status !== 'resolved') return;
      expect(final.result.metadata.versionId).to.equal('1');
      expect(final.result.didDocument).to.not.have.own.property('verificationMethod');
      expect(final.result.didDocument.capabilityInvocation![0]).to.have.property('id', `${did}#key-0`);
      expect(JSON.parse(JSON.stringify(final.result.didDocument))).to.deep.equal(currentDocument(genesisDocument, did));
    });
  });
});
