import { canonicalHashBytes, INVALID_DID, INVALID_DID_DOCUMENT, ResolveError } from '@did-btcr2/common';
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
});