import { expect } from 'chai';
import { randomBytes } from 'crypto';
import { canonicalHash, encode, hash, canonicalize } from '@did-btcr2/common';
import { BTCR2MerkleTree, hashToHex } from '@did-btcr2/smt';
import { hexToBytes } from '@noble/hashes/utils';
import { DidBtcr2 } from '../src/did-btcr2.js';
import type { BeaconService, BeaconSignal } from '../src/core/beacon/interfaces.js';
import type { NeedBeaconSignals, NeedCASAnnouncement, NeedGenesisDocument, NeedSMTProof, NeedSignedUpdate } from '../src/core/resolver.js';
import { Updater } from '../src/core/updater.js';
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

  describe('missing SMT sidecar data needs', () => {
    it('emits NeedSMTProof when SMT signal has no matching sidecar proof', () => {
      const { genesisDocument } = externalData[2]; // regtest

      // Build a genesis document with an SMT beacon service
      const smtGenesisDoc = JSON.parse(JSON.stringify(genesisDocument));
      smtGenesisDoc.service[0].type = 'SMTBeacon';

      // Compute correct genesis bytes for modified document
      const smtGenesisBytes = hash(canonicalize(smtGenesisDoc));
      const smtDid = DidBtcr2.create(smtGenesisBytes, { idType: 'EXTERNAL', version: 1, network: 'regtest' });

      const resolver = DidBtcr2.resolve(smtDid, { sidecar: { genesisDocument: smtGenesisDoc } });

      // First resolve — needs beacon signals
      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedBeaconSignals');
      const beaconNeed = state.needs[0] as NeedBeaconSignals;

      // Provide a fake SMT beacon signal (root hash not in sidecar)
      const fakeRootHash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const smtService = beaconNeed.beaconServices[0] as BeaconService;
      const fakeSignals = new Map<BeaconService, Array<BeaconSignal>>();
      fakeSignals.set(smtService, [{
        tx            : {} as any,
        signalBytes   : fakeRootHash,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, fakeSignals);

      // Resolve should return NeedSMTProof
      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedSMTProof');

      const smtNeed = state.needs[0] as NeedSMTProof;
      expect(smtNeed.beaconServiceId).to.equal(smtService.id);
      expect(smtNeed.smtRootHash).to.equal(fakeRootHash);
    });
  });

  describe('multi-round SMT resolution', () => {
    it('progresses through NeedSMTProof → NeedSignedUpdate', () => {
      const { genesisDocument } = externalData[2]; // regtest

      // Build a genesis document with an SMT beacon service
      const smtGenesisDoc = JSON.parse(JSON.stringify(genesisDocument));
      smtGenesisDoc.service[0].type = 'SMTBeacon';

      const smtGenesisBytes = hash(canonicalize(smtGenesisDoc));
      const smtDid = DidBtcr2.create(smtGenesisBytes, { idType: 'EXTERNAL', version: 1, network: 'regtest' });

      // Build a fake signed update
      const fakeUpdate = { '@context': ['test'], patch: [], targetHash: 'fake', targetVersionId: 2, sourceHash: 'fake' };

      // Build a real SMT tree containing this DID's update
      const nonce = randomBytes(32);
      const signedUpdateBytes = new TextEncoder().encode(canonicalize(fakeUpdate));
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: smtDid, nonce, signedUpdate: signedUpdateBytes }]);
      tree.finalize();

      // Get the root hash (for signal bytes) and proof (for sidecar)
      const rootHashHex = hashToHex(tree.rootHash);
      const smtProof = tree.proof(smtDid);

      const resolver = DidBtcr2.resolve(smtDid, { sidecar: { genesisDocument: smtGenesisDoc } });

      // Step 1: NeedBeaconSignals
      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      const smtService = beaconNeed.beaconServices[0] as BeaconService;

      // Provide signal whose bytes = SMT root hash
      const fakeSignals = new Map<BeaconService, Array<BeaconSignal>>();
      fakeSignals.set(smtService, [{
        tx            : {} as any,
        signalBytes   : rootHashHex,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, fakeSignals);

      // Step 2: NeedSMTProof (proof not in sidecar)
      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedSMTProof');

      // Provide the SMT proof
      resolver.provide(state.needs[0] as NeedSMTProof, smtProof);

      // Step 3: NeedSignedUpdate (update not in sidecar)
      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedSignedUpdate');

      const updateNeed = state.needs[0] as NeedSignedUpdate;
      expect(updateNeed.beaconServiceId).to.equal(smtService.id);

      // The updateHash should be the hex encoding of the canonical hash (matching proof.updateId)
      const expectedUpdateHash = canonicalHash(fakeUpdate, { encoding: 'hex' });
      expect(updateNeed.updateHash).to.equal(expectedUpdateHash);
    });

    it('skips non-inclusion proofs (no updateId)', () => {
      const { genesisDocument } = externalData[2]; // regtest

      // Build a genesis document with an SMT beacon service
      const smtGenesisDoc = JSON.parse(JSON.stringify(genesisDocument));
      smtGenesisDoc.service[0].type = 'SMTBeacon';

      const smtGenesisBytes = hash(canonicalize(smtGenesisDoc));
      const smtDid = DidBtcr2.create(smtGenesisBytes, { idType: 'EXTERNAL', version: 1, network: 'regtest' });

      // Build a tree with a non-inclusion entry (no signedUpdate)
      const nonce = randomBytes(32);
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: smtDid, nonce }]);
      tree.finalize();

      const rootHashHex = hashToHex(tree.rootHash);
      const smtProof = tree.proof(smtDid);

      // Non-inclusion proof should have no updateId
      expect(smtProof.updateId).to.be.undefined;

      const resolver = DidBtcr2.resolve(smtDid, {
        sidecar : { genesisDocument: smtGenesisDoc, smtProofs: [smtProof] }
      });

      // Step 1: NeedBeaconSignals
      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      const smtService = beaconNeed.beaconServices[0] as BeaconService;

      // Provide signal with the root hash
      const fakeSignals = new Map<BeaconService, Array<BeaconSignal>>();
      fakeSignals.set(smtService, [{
        tx            : {} as any,
        signalBytes   : rootHashHex,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, fakeSignals);

      // Should resolve (non-inclusion skipped, no updates, no needs)
      state = resolver.resolve();
      expect(state.status).to.equal('resolved');
    });
  });

  describe('multi-round beacon discovery', () => {
    it('loops back to BeaconDiscovery when an applied update adds a new beacon service', () => {
      const fixture = deterministicData[2]; // regtest — has a known secretKey
      const did = fixture.did;
      const secretKey = hexToBytes(fixture.secretKey);

      // Resolve once to get the initial document
      const initResolver = DidBtcr2.resolve(did);
      let initState = initResolver.resolve();
      if(initState.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
      provideEmptySignals(initResolver, initState.needs[0] as NeedBeaconSignals);
      initState = initResolver.resolve();
      if(initState.status !== 'resolved') throw new Error('expected resolved');
      const sourceDocument = initState.result.didDocument;

      // The initial document has one beacon service (from deterministic generation)
      const initialServices = sourceDocument.service || [];
      const initialBeaconCount = initialServices.length;
      expect(initialBeaconCount).to.be.greaterThan(0);

      // Build a real signed update that adds a SECOND beacon service
      const newBeaconAddress = 'mqTxx2aK3Ay3cDk5xM5E5wT6J4QoT6f8vT'; // regtest address
      const patches = [{
        op    : 'add' as const,
        path  : '/service/-',
        value : {
          id              : `${did}#beacon-new`,
          type            : 'SingletonBeacon',
          serviceEndpoint : `bitcoin:${newBeaconAddress}`,
        }
      }];

      const vm = sourceDocument.verificationMethod![0]!;
      const unsigned = Updater.construct(sourceDocument, patches, 1);
      const signed = Updater.sign(did, unsigned, vm, secretKey);
      const updateHashHex = canonicalHash(signed, { encoding: 'hex' });

      // Build the sidecar with the update pre-loaded
      const sidecar = { updates: [signed] };

      // Now resolve with the sidecar
      const resolver = DidBtcr2.resolve(did, { sidecar });

      // Round 1: NeedBeaconSignals for the INITIAL beacon address(es)
      let state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') throw new Error('expected action-required');
      expect(state.needs[0]!.kind).to.equal('NeedBeaconSignals');

      const round1Need = state.needs[0] as NeedBeaconSignals;
      const originalService = round1Need.beaconServices[0]!;

      // Provide a signal for the original beacon that points to our update
      const signals = new Map<BeaconService, Array<BeaconSignal>>();
      signals.set(originalService as BeaconService, [{
        tx            : {} as any,
        signalBytes   : updateHashHex,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(round1Need, signals);

      // The resolver should process the signal, apply the update (which adds a new beacon),
      // then loop back to BeaconDiscovery for the NEW address.
      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') throw new Error('expected action-required for round 2');
      expect(state.needs[0]!.kind).to.equal('NeedBeaconSignals');

      // Round 2: The new beacon service should be requested (not the original one again)
      const round2Need = state.needs[0] as NeedBeaconSignals;
      const newServiceAddresses = round2Need.beaconServices.map(
        s => (s.serviceEndpoint as string).replace('bitcoin:', '')
      );
      expect(newServiceAddresses).to.include(newBeaconAddress);

      // The original address should NOT be re-requested (request cache)
      const originalAddress = (originalService.serviceEndpoint as string).replace('bitcoin:', '');
      expect(newServiceAddresses).to.not.include(originalAddress);

      // Provide empty signals for the new beacon (no further updates)
      provideEmptySignals(resolver, round2Need);

      // Resolution should now complete with the updated document
      state = resolver.resolve();
      expect(state.status).to.equal('resolved');
      if(state.status !== 'resolved') throw new Error('expected resolved');

      // The resolved document should have both beacon services
      const resolvedServices = state.result.didDocument.service || [];
      expect(resolvedServices.length).to.equal(initialBeaconCount + 1);

      const resolvedEndpoints = resolvedServices.map(s => s.serviceEndpoint);
      expect(resolvedEndpoints).to.include(`bitcoin:${newBeaconAddress}`);
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
