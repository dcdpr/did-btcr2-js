import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { BeaconService, BeaconSignal } from '../src/core/beacon/interfaces.js';
import { NeedBeaconSignals } from '../src/core/resolver.js';
import data from './data/external-data.js';

/**
 * Resolve External Test Cases
 */
describe('Resolve External', () => {
  it('should return a Resolver that starts in GenesisDocument phase without sidecar genesis doc',
    async () => {
      for(const {did} of data) {
        // Create resolver WITHOUT genesis document — should request it
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

        // First resolve() — genesis doc was in sidecar, validates hash and requests signals
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
});