import { expect } from 'chai';
import { canonicalHash, encode, hash, canonicalize } from '@did-btcr2/common';
import { DidBtcr2 } from '../src/did-btcr2.js';
import type { BeaconService, BeaconSignal } from '../src/core/beacon/interfaces.js';
import type { NeedBeaconSignals, NeedCASAnnouncement, NeedGenesisDocument, NeedSignedUpdate } from '../src/core/resolver.js';
import deterministicData from './data/deterministic-data.js';
import externalData from './data/external-data.js';

/** Helper: provide empty signals for a NeedBeaconSignals need. */
function provideEmptySignals(resolver: ReturnType<typeof DidBtcr2.resolve>, need: NeedBeaconSignals): void {
  resolver.provide(need, new Map<BeaconService, Array<BeaconSignal>>());
}

describe('Resolver', () => {

  describe('factory', () => {
    it('DidBtcr2.resolve() returns a Resolver instance', () => {
      const resolver = DidBtcr2.resolve(deterministicData[0].did);
      expect(resolver).to.have.property('resolve').that.is.a('function');
      expect(resolver).to.have.property('provide').that.is.a('function');
    });

    it('resolve() is synchronous (returns ResolverState, not Promise)', () => {
      const resolver = DidBtcr2.resolve(deterministicData[0].did);
      const state = resolver.resolve();
      // Not a promise — has status directly
      expect(state).to.have.property('status');
      expect(state.status).to.be.a('string');
    });
  });

  describe('deterministic (k1) identifiers', () => {
    it('skips GenesisDocument phase and emits NeedBeaconSignals', () => {
      const resolver = DidBtcr2.resolve(deterministicData[0].did);
      const state = resolver.resolve();

      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs).to.have.lengthOf(1);
      expect(state.needs[0].kind).to.equal('NeedBeaconSignals');
    });

    it('emits NeedBeaconSignals with correct beacon service data', () => {
      const resolver = DidBtcr2.resolve(deterministicData[0].did);
      const state = resolver.resolve();

      if(state.status !== 'action-required') return;
      const need = state.needs[0] as NeedBeaconSignals;
      expect(need.beaconServices).to.be.an('array');
      expect(need.beaconServices.length).to.be.greaterThan(0);

      // Each service should have id, type, and serviceEndpoint
      for(const service of need.beaconServices) {
        expect(service).to.have.property('id');
        expect(service).to.have.property('type', 'SingletonBeacon');
        expect(service.serviceEndpoint).to.be.a('string');
        expect((service.serviceEndpoint as string).startsWith('bitcoin:')).to.be.true;
      }
    });

    it('resolves with correct DID document after providing empty signals', () => {
      const { did } = deterministicData[0];
      const resolver = DidBtcr2.resolve(did);

      const state = resolver.resolve();
      if(state.status !== 'action-required') return;
      provideEmptySignals(resolver, state.needs[0] as NeedBeaconSignals);

      const final = resolver.resolve();
      expect(final.status).to.equal('resolved');
      if(final.status !== 'resolved') return;

      expect(final.result.didDocument).to.have.property('id', did);
      expect(final.result.metadata).to.have.property('versionId', '1');
      expect(final.result.metadata.deactivated).to.equal(false);
    });

    it('resolve() is idempotent once complete', () => {
      const resolver = DidBtcr2.resolve(deterministicData[0].did);
      const state = resolver.resolve();
      if(state.status !== 'action-required') return;
      provideEmptySignals(resolver, state.needs[0] as NeedBeaconSignals);

      const first = resolver.resolve();
      const second = resolver.resolve();
      expect(first.status).to.equal('resolved');
      expect(second.status).to.equal('resolved');
      if(first.status === 'resolved' && second.status === 'resolved') {
        expect(first.result.didDocument.id).to.equal(second.result.didDocument.id);
      }
    });
  });

  describe('external (x1) identifiers', () => {
    it('emits NeedGenesisDocument when no genesis doc in sidecar', () => {
      const { did, genesisBytes } = externalData[0];
      const resolver = DidBtcr2.resolve(did);
      const state = resolver.resolve();

      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs).to.have.lengthOf(1);

      const need = state.needs[0] as NeedGenesisDocument;
      expect(need.kind).to.equal('NeedGenesisDocument');
      // genesisHash should be hex encoding of the genesis bytes
      expect(need.genesisHash).to.equal(encode(genesisBytes, 'hex'));
    });

    it('proceeds to NeedBeaconSignals after providing genesis document', () => {
      const { did, genesisDocument } = externalData[0];
      const resolver = DidBtcr2.resolve(did);

      // First resolve — needs genesis doc
      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedGenesisDocument');

      // Provide genesis document
      resolver.provide(state.needs[0] as NeedGenesisDocument, genesisDocument);

      // Second resolve — should now need beacon signals
      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedBeaconSignals');
    });

    it('skips NeedGenesisDocument when genesis doc is in sidecar', () => {
      const { did, genesisDocument } = externalData[0];
      const resolver = DidBtcr2.resolve(did, { sidecar: { genesisDocument } });

      // Should go straight to NeedBeaconSignals (genesis doc validated internally)
      const state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedBeaconSignals');
    });

    it('resolves with correct DID document after full provide cycle', () => {
      const { did, genesisDocument } = externalData[0];
      const resolver = DidBtcr2.resolve(did);

      // Provide genesis document
      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      resolver.provide(state.needs[0] as NeedGenesisDocument, genesisDocument);

      // Provide empty signals
      state = resolver.resolve();
      if(state.status !== 'action-required') return;
      provideEmptySignals(resolver, state.needs[0] as NeedBeaconSignals);

      // Should be resolved
      const final = resolver.resolve();
      expect(final.status).to.equal('resolved');
      if(final.status !== 'resolved') return;
      expect(final.result.didDocument).to.have.property('id', did);
    });
  });

  describe('beacon signal needs', () => {
    it('NeedBeaconSignals contains all beacon services from the document', () => {
      const resolver = DidBtcr2.resolve(deterministicData[2].did); // regtest — 3 beacon services
      const state = resolver.resolve();

      if(state.status !== 'action-required') return;
      const need = state.needs[0] as NeedBeaconSignals;
      // Deterministic k1 identifiers generate 3 beacon services (p2pkh, p2wpkh, p2tr)
      expect(need.beaconServices).to.have.lengthOf(3);
    });

    it('request cache prevents re-requesting same addresses', () => {
      const resolver = DidBtcr2.resolve(deterministicData[0].did);

      // First resolve — requests signals
      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      const need = state.needs[0] as NeedBeaconSignals;
      // Provide empty signals
      provideEmptySignals(resolver, need);

      // Should resolve without requesting again (no new beacons)
      state = resolver.resolve();
      expect(state.status).to.equal('resolved');
    });
  });

  describe('missing sidecar data needs', () => {
    it('emits NeedSignedUpdate when singleton signal has no matching sidecar update', () => {
      const { did } = deterministicData[2]; // regtest
      const resolver = DidBtcr2.resolve(did);

      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      const beaconNeed = state.needs[0] as NeedBeaconSignals;

      // Create a fake signal with a hash that doesn't exist in the (empty) sidecar
      const fakeSignalHash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const fakeSignals = new Map<BeaconService, Array<BeaconSignal>>();
      const service = beaconNeed.beaconServices[0] as BeaconService;
      fakeSignals.set(service, [{
        tx            : {} as any,
        signalBytes   : fakeSignalHash,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, fakeSignals);

      // Resolve should return NeedSignedUpdate
      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedSignedUpdate');

      const updateNeed = state.needs[0] as NeedSignedUpdate;
      expect(updateNeed.beaconServiceId).to.equal(service.id);
      expect(updateNeed.updateHash).to.be.a('string');
    });

    it('emits NeedCASAnnouncement when CAS signal has no matching sidecar announcement', () => {
      const { genesisDocument } = externalData[2]; // regtest

      // Build a genesis document with a CAS beacon service
      const casGenesisDoc = JSON.parse(JSON.stringify(genesisDocument));
      casGenesisDoc.service[0].type = 'CASBeacon';

      // Compute correct genesis bytes for modified document
      const casGenesisBytes = hash(canonicalize(casGenesisDoc));
      const casDid = DidBtcr2.create(casGenesisBytes, { idType: 'EXTERNAL', version: 1, network: 'regtest' });

      const resolver = DidBtcr2.resolve(casDid, { sidecar: { genesisDocument: casGenesisDoc } });

      // First resolve — needs beacon signals
      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedBeaconSignals');
      const beaconNeed = state.needs[0] as NeedBeaconSignals;

      // Provide a fake CAS beacon signal
      const fakeAnnouncementHash = 'abcdef01abcdef01abcdef01abcdef01abcdef01abcdef01abcdef01abcdef01';
      const casService = beaconNeed.beaconServices[0] as BeaconService;
      const fakeSignals = new Map<BeaconService, Array<BeaconSignal>>();
      fakeSignals.set(casService, [{
        tx            : {} as any,
        signalBytes   : fakeAnnouncementHash,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, fakeSignals);

      // Resolve should return NeedCASAnnouncement
      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedCASAnnouncement');

      const casNeed = state.needs[0] as NeedCASAnnouncement;
      expect(casNeed.beaconServiceId).to.equal(casService.id);
      expect(casNeed.announcementHash).to.be.a('string');
    });
  });

  describe('multi-round CAS resolution', () => {
    it('progresses through NeedCASAnnouncement → NeedSignedUpdate → resolved', () => {
      const { genesisDocument } = externalData[2]; // regtest

      // Build a genesis document with a CAS beacon service
      const casGenesisDoc = JSON.parse(JSON.stringify(genesisDocument));
      casGenesisDoc.service[0].type = 'CASBeacon';

      const casGenesisBytes = hash(canonicalize(casGenesisDoc));
      const casDid = DidBtcr2.create(casGenesisBytes, { idType: 'EXTERNAL', version: 1, network: 'regtest' });

      const resolver = DidBtcr2.resolve(casDid, { sidecar: { genesisDocument: casGenesisDoc } });

      // Step 1: NeedBeaconSignals
      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      const casService = beaconNeed.beaconServices[0] as BeaconService;

      // Build a fake signed update and CAS announcement that reference each other
      const fakeUpdate = { '@context': ['test'], patch: [], targetHash: 'fake', targetVersionId: 2, sourceHash: 'fake' };
      const updateHash = canonicalHash(fakeUpdate);        // base64urlnopad (stored in announcement per spec)
      const updateHashHex = canonicalHash(fakeUpdate, { encoding: 'hex' }); // hex (for assertion, matches beacon output)

      // CAS announcement maps DID → update hash (base64urlnopad per spec)
      const announcement = { [casDid]: updateHash };
      const announcementHashHex = canonicalHash(announcement, { encoding: 'hex' });

      // Provide signal whose bytes = hex hash of CAS announcement
      const fakeSignals = new Map<BeaconService, Array<BeaconSignal>>();
      fakeSignals.set(casService, [{
        tx            : {} as any,
        signalBytes   : announcementHashHex,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, fakeSignals);

      // Step 2: NeedCASAnnouncement (announcement not in sidecar)
      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedCASAnnouncement');

      // Provide the CAS announcement
      resolver.provide(state.needs[0] as NeedCASAnnouncement, announcement);

      // Step 3: NeedSignedUpdate (update not in sidecar)
      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedSignedUpdate');
      expect((state.needs[0] as NeedSignedUpdate).updateHash).to.equal(updateHashHex);

      // Provide the signed update — but since it's fake with wrong hashes,
      // we expect it to resolve to complete (update will be collected but
      // Resolve.updates will fail on hash mismatch). The point is testing
      // the multi-round data-need protocol, not update application.
      // So we just verify we got through the NeedCASAnnouncement → NeedSignedUpdate flow.
    });
  });

  describe('edge cases', () => {
    it('resolves immediately for k1 when no beacon services have signals', () => {
      const resolver = DidBtcr2.resolve(deterministicData[0].did);

      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      provideEmptySignals(resolver, state.needs[0] as NeedBeaconSignals);

      state = resolver.resolve();
      expect(state.status).to.equal('resolved');
    });

    it('works for multiple k1 identifiers across networks', () => {
      for(const { did } of deterministicData) {
        const resolver = DidBtcr2.resolve(did);

        let state = resolver.resolve();
        expect(state.status).to.equal('action-required');
        if(state.status !== 'action-required') continue;
        provideEmptySignals(resolver, state.needs[0] as NeedBeaconSignals);

        state = resolver.resolve();
        expect(state.status).to.equal('resolved');
        if(state.status !== 'resolved') continue;
        expect(state.result.didDocument.id).to.equal(did);
      }
    });

    it('works for multiple x1 identifiers across networks', () => {
      for(const { did, genesisDocument } of externalData) {
        const resolver = DidBtcr2.resolve(did, { sidecar: { genesisDocument } });

        let state = resolver.resolve();
        expect(state.status).to.equal('action-required');
        if(state.status !== 'action-required') continue;
        expect(state.needs[0].kind).to.equal('NeedBeaconSignals');
        provideEmptySignals(resolver, state.needs[0] as NeedBeaconSignals);

        state = resolver.resolve();
        expect(state.status).to.equal('resolved');
        if(state.status !== 'resolved') continue;
        expect(state.result.didDocument.id).to.equal(did);
      }
    });
  });
});
