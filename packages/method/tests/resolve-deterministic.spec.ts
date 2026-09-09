import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import type { BeaconService, BeaconSignal } from '../src/core/beacon/interfaces.js';
import type { NeedBeaconSignals } from '../src/core/resolver.js';
import data from './data/deterministic-data.js';

/**
 * Resolve Deterministic (k1) Test Cases
 */
describe('Resolve Deterministic (k1)', () => {
  it('should resolve each deterministic (k1) identifier to its correponding DID document',
    async () => {
      for(const {did} of data) {
        const resolver = DidBtcr2.resolve(did);

        // First resolve() should request beacon signals
        const state = resolver.resolve();
        expect(state.status).to.equal('action-required');
        if(state.status !== 'action-required') return;
        expect(state.needs[0]).to.have.property('kind', 'NeedBeaconSignals');

        // Provide empty signals (no on-chain updates for these test DIDs)
        const emptySignals = new Map<BeaconService, Array<BeaconSignal>>();
        resolver.provide(state.needs[0] as NeedBeaconSignals, emptySignals);

        // Second resolve() should complete with the deterministic document
        const final = resolver.resolve();
        expect(final.status).to.equal('resolved');
        if(final.status !== 'resolved') return;
        expect(final.result).to.have.property('didDocument');
        expect(final.result.didDocument).to.have.property('id', did);
      }
    });

  it('reports confirmations 0, deactivated false, and no updated field when no update applies',
    () => {
      const resolver = DidBtcr2.resolve(data[0].did);
      const state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      resolver.provide(state.needs[0] as NeedBeaconSignals, new Map<BeaconService, Array<BeaconSignal>>());
      const final = resolver.resolve();
      if(final.status !== 'resolved') throw new Error('expected resolved');
      // The specification requires versionId, confirmations, and deactivated; updated is
      // optional and only present once an update is applied.
      expect(final.result.metadata).to.deep.equal({ versionId: '1', confirmations: 0, deactivated: false });
    });
});
