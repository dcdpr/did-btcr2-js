import { expect } from 'chai';
import { randomBytes } from 'crypto';
import { canonicalHash, encode, hash, canonicalize, INTERNAL_ERROR, INVALID_DID_UPDATE, JSONPatch, LATE_PUBLISHING_ERROR } from '@did-btcr2/common';
import type { PatchOperation } from '@did-btcr2/common';
import { getNetwork } from '@did-btcr2/bitcoin';
import { LocalSigner } from '@did-btcr2/keypair';
import { BTCR2MerkleTree, hashToHex } from '@did-btcr2/smt';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils';
import { p2wpkh } from '@scure/btc-signer';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { BeaconUtils } from '../src/core/beacon/utils.js';
import type { BeaconService, BeaconSignal } from '../src/core/beacon/interfaces.js';
import type { DidDocument } from '../src/utils/did-document.js';
import type { SignedBTCR2Update } from '../src/core/btcr2-update.js';
import { Resolver } from '../src/core/resolver.js';
import type { DidResolutionResponse, NeedBeaconSignals, NeedCASAnnouncement, NeedGenesisDocument, NeedSMTProof, NeedSignedUpdate } from '../src/core/resolver.js';
import { Updater } from '../src/core/updater.js';
import deterministicData from './data/deterministic-data.js';
import externalData from './data/external-data.js';

/** Helper: provide empty signals for a NeedBeaconSignals need. */
function provideEmptySignals(resolver: ReturnType<typeof DidBtcr2.resolve>, need: NeedBeaconSignals): void {
  resolver.provide(need, new Map<BeaconService, Array<BeaconSignal>>());
}

/** Helper: resolve a deterministic (k1) DID with empty signals to obtain its source document. */
function resolveDeterministic(did: string): DidDocument {
  const resolver = DidBtcr2.resolve(did);
  let state = resolver.resolve();
  if(state.status !== 'action-required') throw new Error('expected action-required');
  provideEmptySignals(resolver, state.needs[0] as NeedBeaconSignals);
  state = resolver.resolve();
  if(state.status !== 'resolved') throw new Error('expected resolved');
  return state.result.didDocument;
}

/**
 * Build a chain of `numHops` signed updates that each add a new SingletonBeacon
 * service, wired so the beacon added by one hop carries the update for the next.
 *
 * This is a genuine linear history: hop i is a v(i+1)-to-v(i+2) update whose
 * sourceHash chains to the running document. Hop 0 (v1-to-v2) is announced on the
 * genesis beacon, the beacon it adds carries hop 1 (v2-to-v3), and so on. Each new
 * version is only discoverable a round later, on a beacon the previous update added,
 * so resolving past v2 requires the version counter to persist across discovery
 * rounds rather than reset each pass.
 *
 * Returns the signed updates (for the sidecar) plus a map from beacon address to
 * the hex update hash to deliver on the beacon at that address; the terminal
 * beacon has no entry.
 */
function buildDiscoveryChain(
  did: string,
  sourceDocument: DidDocument,
  secretKey: string,
  numHops: number
): { updates: Array<SignedBTCR2Update>; signalByAddress: Map<string, string> } {
  const vm = sourceDocument.verificationMethod![0]!;
  const signer = new LocalSigner(hexToBytes(secretKey));
  const network = getNetwork('regtest');
  const updates: Array<SignedBTCR2Update> = [];
  const signalByAddress = new Map<string, string>();

  // The first genesis beacon delivers the first update.
  let prevAddress = BeaconUtils.parseBitcoinAddress(
    BeaconUtils.getBeaconServices(sourceDocument)[0]!.serviceEndpoint as string
  );
  let currentDoc: DidDocument = sourceDocument;

  for(let i = 0; i < numHops; i++) {
    // Distinct, valid regtest P2WPKH address for the new beacon.
    const secret = new Uint8Array(32);
    secret[31] = i + 1;
    const address = p2wpkh(secp256k1.getPublicKey(secret, true), network).address!;

    const patches = [{
      op    : 'add' as const,
      path  : '/service/-',
      value : { id: `${did}#beacon-${i}`, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${address}` }
    }];

    const unsigned = Updater.construct(currentDoc, patches, i + 1);
    const signed = Updater.sign(did, unsigned, vm, signer);
    updates.push(signed);

    // The beacon discovered in the previous round points at this update.
    signalByAddress.set(prevAddress, canonicalHash(signed, { encoding: 'hex' }));

    currentDoc = JSONPatch.apply(currentDoc, patches) as DidDocument;
    prevAddress = address;
  }

  return { updates, signalByAddress };
}

/**
 * Drive a resolver through a beacon-discovery chain, delivering on each beacon the
 * update hash recorded for its address (empty signals otherwise). Returns the
 * resolved document, or propagates whatever the resolver throws.
 */
function driveDiscoveryChain(
  did: string,
  updates: Array<SignedBTCR2Update>,
  signalByAddress: Map<string, string>,
  options?: { maxDiscoveryRounds?: number }
): DidResolutionResponse {
  const resolver = DidBtcr2.resolve(did, { sidecar: { updates }, ...options });
  let height = 100;
  let state = resolver.resolve();
  while(state.status === 'action-required') {
    const need = state.needs[0];
    if(need.kind !== 'NeedBeaconSignals') throw new Error(`unexpected need: ${need.kind}`);
    const signals = new Map<BeaconService, Array<BeaconSignal>>();
    for(const service of need.beaconServices) {
      const address = BeaconUtils.parseBitcoinAddress(service.serviceEndpoint as string);
      const updateHashHex = signalByAddress.get(address);
      signals.set(service, updateHashHex
        ? [{ tx: {} as any, signalBytes: updateHashHex, blockMetadata: { height: height++, time: 1700000000, confirmations: 6 } }]
        : []
      );
    }
    resolver.provide(need, signals);
    state = resolver.resolve();
  }
  if(state.status !== 'resolved') throw new Error('expected resolved');
  return state.result;
}

/**
 * A benign, non-beacon mutation that keeps the document valid: append an existing key reference
 * to assertionMethod (duplicate string refs are allowed by isValidVerificationRelationships).
 * Used to build version hops that do NOT add a beacon, so the whole chain stays in one round.
 */
function benignPatch(did: string): PatchOperation[] {
  return [{ op: 'add' as const, path: '/assertionMethod/-', value: `${did}#initialKey` }];
}

/**
 * Build a linear chain of signed updates (v2, v3, ...) from `sourceDocument`, applying
 * `patchesPerHop[i]` at hop i with correctly chained sourceHashes. With no beacon-adding
 * patches, every update is discoverable in a single discovery round on the genesis beacon.
 */
function buildUpdateChain(
  did: string,
  sourceDocument: DidDocument,
  secretKey: string,
  patchesPerHop: Array<PatchOperation[]>
): Array<SignedBTCR2Update> {
  const vm = sourceDocument.verificationMethod![0]!;
  const signer = new LocalSigner(hexToBytes(secretKey));
  const signed: Array<SignedBTCR2Update> = [];
  let currentDoc: DidDocument = sourceDocument;
  patchesPerHop.forEach((patches, i) => {
    const unsigned = Updater.construct(currentDoc, patches, i + 1);
    signed.push(Updater.sign(did, unsigned, vm, signer));
    currentDoc = JSONPatch.apply(currentDoc, patches) as DidDocument;
  });
  return signed;
}

/**
 * Drive a resolver delivering every update as a signal on the single genesis beacon in one
 * discovery round (the updates add no beacons). Optional versionId/versionTime limits and
 * per-update block times exercise the early-return branches inside Resolver.updates().
 */
function driveSingleBeacon(
  did: string,
  updates: Array<SignedBTCR2Update>,
  options?: { versionId?: string; versionTime?: string; times?: Array<number> }
): ReturnType<typeof driveDiscoveryChain> {
  const resolver = DidBtcr2.resolve(did, {
    sidecar : { updates },
    ...(options?.versionId ? { versionId: options.versionId } : {}),
    ...(options?.versionTime ? { versionTime: options.versionTime } : {})
  });
  let state = resolver.resolve();
  if(state.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
  const need = state.needs[0] as NeedBeaconSignals;
  const genesis = need.beaconServices[0] as BeaconService;
  const signals = new Map<BeaconService, Array<BeaconSignal>>();
  signals.set(genesis, updates.map((update, i) => ({
    tx            : {} as any,
    signalBytes   : canonicalHash(update, { encoding: 'hex' }),
    blockMetadata : { height: 100 + i, time: options?.times?.[i] ?? (1700000000 + i), confirmations: 6 }
  })));
  resolver.provide(need, signals);
  state = resolver.resolve();
  if(state.status !== 'resolved') throw new Error('expected resolved');
  return state.result;
}

/**
 * Drive resolution delivering an explicit, ordered list of signals on the single
 * genesis beacon in one round. `signalUpdates` may repeat an update to model a
 * duplicate re-announcement (SingletonBeacon.processSignals does not dedup, so each
 * signal becomes its own update tuple). Every update the resolver may need is placed
 * in the sidecar. Per-signal block metadata lets a duplicate carry a later time and a
 * different confirmation depth than the apply it duplicates. Returns the resolved
 * response or propagates whatever the resolver throws.
 */
function driveSignalSequence(
  did: string,
  sidecarUpdates: Array<SignedBTCR2Update>,
  signalUpdates: Array<SignedBTCR2Update>,
  blocks?: Array<{ height?: number; time?: number; confirmations?: number }>,
  versionTime?: string
): DidResolutionResponse {
  const resolver = DidBtcr2.resolve(did, {
    sidecar : { updates: sidecarUpdates },
    ...(versionTime ? { versionTime } : {})
  });
  let state = resolver.resolve();
  if(state.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
  const need = state.needs[0] as NeedBeaconSignals;
  const genesis = need.beaconServices[0] as BeaconService;
  const signals = new Map<BeaconService, Array<BeaconSignal>>();
  signals.set(genesis, signalUpdates.map((update, i) => ({
    tx            : {} as any,
    signalBytes   : canonicalHash(update, { encoding: 'hex' }),
    blockMetadata : {
      height        : blocks?.[i]?.height ?? (100 + i),
      time          : blocks?.[i]?.time ?? (1700000000 + i),
      confirmations : blocks?.[i]?.confirmations ?? 6
    }
  })));
  resolver.provide(need, signals);
  state = resolver.resolve();
  if(state.status !== 'resolved') throw new Error('expected resolved');
  return state.result;
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
      // Not a promise - has status directly
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

      // First resolve - needs genesis doc
      let state = resolver.resolve();
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedGenesisDocument');

      // Provide genesis document
      resolver.provide(state.needs[0] as NeedGenesisDocument, genesisDocument);

      // Second resolve - should now need beacon signals
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
      const resolver = DidBtcr2.resolve(deterministicData[2].did); // regtest - 3 beacon services
      const state = resolver.resolve();

      if(state.status !== 'action-required') return;
      const need = state.needs[0] as NeedBeaconSignals;
      // Deterministic k1 identifiers generate 3 beacon services (p2pkh, p2wpkh, p2tr)
      expect(need.beaconServices).to.have.lengthOf(3);
    });

    it('request cache prevents re-requesting same addresses', () => {
      const resolver = DidBtcr2.resolve(deterministicData[0].did);

      // First resolve - requests signals
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

      // First resolve - needs beacon signals
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
    it('progresses through NeedCASAnnouncement -> NeedSignedUpdate -> resolved', () => {
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

      // CAS announcement maps DID to update hash (base64urlnopad per spec)
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

      // Provide the signed update - but since it's fake with wrong hashes,
      // we expect it to resolve to complete (update will be collected but
      // Resolve.updates will fail on hash mismatch). The point is testing
      // the multi-round data-need protocol, not update application.
      // So we just verify we got through the NeedCASAnnouncement to NeedSignedUpdate flow.
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

      // First resolve - needs beacon signals
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
    it('progresses through NeedSMTProof -> NeedSignedUpdate', () => {
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
      const fixture = deterministicData[2]; // regtest - has a known secretKey
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
      const signed = Updater.sign(did, unsigned, vm, new LocalSigner(secretKey));
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

  describe('cross-round version continuity (regression)', () => {
    it('resolves a linear history whose later versions live on beacons added by earlier updates', () => {
      const fixture = deterministicData[2]; // regtest - has a known secretKey
      const sourceDocument = resolveDeterministic(fixture.did);
      const hops = 3;
      const { updates, signalByAddress } = buildDiscoveryChain(fixture.did, sourceDocument, fixture.secretKey, hops);

      // Genesis is v1. Hop 0 (v1->v2) is announced on the genesis beacon, hop 1
      // (v2->v3) on the beacon hop 0 added, hop 2 (v3->v4) on the beacon hop 1 added.
      // Each version is only discoverable a round later, so resolving past v2 requires
      // the version counter to persist across discovery rounds. Previously the resolver
      // reset that counter every round and rejected hop 1 at round two as late publishing.
      const resolved = driveDiscoveryChain(fixture.did, updates, signalByAddress);
      expect(resolved.metadata.versionId).to.equal(`${hops + 1}`);
      expect(resolved.didDocument.service.length).to.equal(sourceDocument.service.length + hops);
    });
  });

  describe('update-processing limits (versionId / versionTime / deactivated)', () => {
    const fixture = deterministicData[2]; // regtest - has a known secretKey

    it('stops at the requested versionId and ignores later updates', () => {
      const source = resolveDeterministic(fixture.did);
      // v2, v3, v4 - three benign hops, all delivered on the genesis beacon in one round.
      const updates = buildUpdateChain(fixture.did, source, fixture.secretKey, [
        benignPatch(fixture.did), benignPatch(fixture.did), benignPatch(fixture.did)
      ]);
      const { metadata, didDocument } = driveSingleBeacon(fixture.did, updates, { versionId: '3' });
      // The loop applies v2 then v3; once currentVersionId reaches 3 it returns, never applying v4.
      expect(metadata.versionId).to.equal('3');
      expect(didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 2);
    });

    it('stops before an update dated after versionTime', () => {
      const source = resolveDeterministic(fixture.did);
      const updates = buildUpdateChain(fixture.did, source, fixture.secretKey, [
        benignPatch(fixture.did), benignPatch(fixture.did)
      ]);
      // v2 block time 2023-11-14, v3 block time 2027-01-15; versionTime sits between them, so
      // v2 applies and v3 is short-circuited before it is applied.
      const { metadata, didDocument } = driveSingleBeacon(fixture.did, updates, {
        versionTime : '2025-01-01T00:00:00Z',
        times       : [1700000000, 1800000000]
      });
      expect(metadata.versionId).to.equal('2');
      expect(didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 1);
    });

    it('stops at a deactivating update and reports deactivated', () => {
      const source = resolveDeterministic(fixture.did);
      const updates = buildUpdateChain(fixture.did, source, fixture.secretKey, [
        [{ op: 'add' as const, path: '/deactivated', value: true }], // v2 deactivates
        benignPatch(fixture.did)                                     // v3 must never be reached
      ]);
      const { metadata, didDocument } = driveSingleBeacon(fixture.did, updates);
      expect(metadata.deactivated).to.equal(true);
      expect(didDocument.deactivated).to.equal(true);
      expect(metadata.versionId).to.equal('2');
      // v3's benign append was never applied, so assertionMethod is unchanged from genesis.
      expect(didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length);
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

  describe('provide() validation and bounded discovery (hardening)', () => {
    // Drive a deterministic DID to the NeedSignedUpdate phase via a singleton
    // signal whose hash is absent from the (empty) sidecar.
    function reachNeedSignedUpdate(): { resolver: ReturnType<typeof DidBtcr2.resolve>; need: NeedSignedUpdate } {
      const { did } = deterministicData[2];
      const resolver = DidBtcr2.resolve(did);
      let state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      const signals = new Map<BeaconService, Array<BeaconSignal>>();
      signals.set(beaconNeed.beaconServices[0] as BeaconService, [{
        tx            : {} as any,
        signalBytes   : 'deadbeef'.repeat(8),
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, signals);
      state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedSignedUpdate');
      return { resolver, need: state.needs[0] as NeedSignedUpdate };
    }

    it('rejects a NeedSignedUpdate payload whose hash does not match the signal', () => {
      const { resolver, need } = reachNeedSignedUpdate();
      // Well-formed signed-update shape, but not the update the signal asked for.
      const wellFormedButWrong = {
        '@context'      : [],
        patch           : [],
        sourceHash      : 'aa',
        targetHash      : 'bb',
        targetVersionId : 2,
        proof           : {
          type               : 'DataIntegrityProof',
          cryptosuite        : 'bip340-jcs-2025',
          verificationMethod : 'did:btcr2:x#k',
          proofPurpose       : 'capabilityInvocation',
          proofValue         : 'zz'
        }
      };
      expect(() => resolver.provide(need, wellFormedButWrong as any)).to.throw(/hash mismatch/i);
    });

    it('rejects a NeedSignedUpdate payload that is not a signed update', () => {
      const { resolver, need } = reachNeedSignedUpdate();
      expect(() => resolver.provide(need, { not: 'an update' } as any)).to.throw(/not a signed BTCR2 update/i);
    });

    it('rejects a NeedCASAnnouncement payload whose hash does not match the signal', () => {
      const { genesisDocument } = externalData[2];
      const casGenesisDoc = JSON.parse(JSON.stringify(genesisDocument));
      casGenesisDoc.service[0].type = 'CASBeacon';
      const casDid = DidBtcr2.create(hash(canonicalize(casGenesisDoc)), { idType: 'EXTERNAL', version: 1, network: 'regtest' });
      const resolver = DidBtcr2.resolve(casDid, { sidecar: { genesisDocument: casGenesisDoc } });

      let state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      const signals = new Map<BeaconService, Array<BeaconSignal>>();
      signals.set(beaconNeed.beaconServices[0] as BeaconService, [{
        tx            : {} as any,
        signalBytes   : 'abcdef01'.repeat(8),
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, signals);

      state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedCASAnnouncement');
      const casNeed = state.needs[0] as NeedCASAnnouncement;
      // Valid announcement shape (record of string hashes), wrong hash.
      expect(() => resolver.provide(casNeed, { someUpdate: 'someHash' } as any)).to.throw(/hash mismatch/i);
    });

    it('rejects a non-Map payload for NeedBeaconSignals', () => {
      const resolver = DidBtcr2.resolve(deterministicData[0].did);
      const state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      expect(() => resolver.provide(state.needs[0] as NeedBeaconSignals, [] as any)).to.throw(/Map of beacon services/i);
    });

    it('rejects a non-object payload for NeedGenesisDocument', () => {
      const resolver = DidBtcr2.resolve(externalData[0].did);
      const state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected action-required');
      expect(state.needs[0].kind).to.equal('NeedGenesisDocument');
      expect(() => resolver.provide(state.needs[0] as NeedGenesisDocument, 'not-an-object' as any)).to.throw(/document object/i);
    });

    it('resolves a DID whose updates drive many discovery rounds (default is unbounded)', () => {
      const fixture = deterministicData[2];
      const sourceDocument = resolveDeterministic(fixture.did);
      const initialServiceCount = sourceDocument.service.length;

      // More rounds than the old fixed default of 10, so this would have failed
      // closed before; the default is now unbounded and it resolves cleanly.
      const hops = 12;
      const { updates, signalByAddress } = buildDiscoveryChain(fixture.did, sourceDocument, fixture.secretKey, hops);

      const resolved = driveDiscoveryChain(fixture.did, updates, signalByAddress);
      expect(resolved.didDocument.service.length).to.equal(initialServiceCount + hops);
    });

    it('treats a non-positive maxDiscoveryRounds as unbounded', () => {
      const fixture = deterministicData[2];
      const sourceDocument = resolveDeterministic(fixture.did);
      const { updates, signalByAddress } = buildDiscoveryChain(fixture.did, sourceDocument, fixture.secretKey, 3);

      // 0 used to trip immediately; under the new semantics it means "no limit".
      const resolved = driveDiscoveryChain(fixture.did, updates, signalByAddress, { maxDiscoveryRounds: 0 });
      expect(resolved.didDocument.service.length).to.equal(sourceDocument.service.length + 3);
    });

    it('still enforces an explicit positive maxDiscoveryRounds cap (INTERNAL_ERROR)', () => {
      const fixture = deterministicData[2];
      const sourceDocument = resolveDeterministic(fixture.did);
      const { updates, signalByAddress } = buildDiscoveryChain(fixture.did, sourceDocument, fixture.secretKey, 4);

      // Cap at 2 rounds: the 3rd discovery round exceeds it. The document is
      // well-formed, so the caller-imposed limit surfaces as INTERNAL_ERROR.
      let thrown: any;
      try {
        driveDiscoveryChain(fixture.did, updates, signalByAddress, { maxDiscoveryRounds: 2 });
      } catch(error) {
        thrown = error;
      }
      expect(thrown, 'expected resolution to throw').to.exist;
      expect(thrown.message).to.match(/beacon-discovery/i);
      expect(thrown.type).to.equal(INTERNAL_ERROR);
    });
  });

  describe('provide() idempotency and dedup (RES-4)', () => {
    // These lock in that provide() is safe to call redundantly or out of order:
    // double-provide of the same need, provide after a need was already satisfied,
    // and a stale need fulfilled a discovery round late. provide() is idempotent by
    // construction: the three hash-bound needs (CAS, SignedUpdate, SMTProof) write
    // hash-keyed sidecar maps, and NeedBeaconSignals is gated downstream by
    // #processedServices (keyed on service id). None of these tests deliver one
    // update as two signals; that duplicate-handling path lives in Resolver.updates()
    // and is tracked separately (finding-resolver-duplicate-handling).
    const fixture = deterministicData[2]; // regtest - has a known secretKey

    it('double-providing the same NeedSignedUpdate is idempotent (no double application)', () => {
      const source = resolveDeterministic(fixture.did);
      // One real benign v1-to-v2 update, delivered as a singleton signal but withheld
      // from the sidecar so the resolver asks for it via NeedSignedUpdate.
      const [ signed ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [ benignPatch(fixture.did) ]);
      const updateHashHex = canonicalHash(signed, { encoding: 'hex' });

      const resolver = DidBtcr2.resolve(fixture.did); // empty sidecar
      let state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      const genesis = beaconNeed.beaconServices[0] as BeaconService;
      const signals = new Map<BeaconService, Array<BeaconSignal>>();
      signals.set(genesis, [{
        tx            : {} as any,
        signalBytes   : updateHashHex,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, signals);

      state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedSignedUpdate');
      const updateNeed = state.needs[0] as NeedSignedUpdate;
      expect(updateNeed.updateHash).to.equal(updateHashHex);

      // Provide the same valid update twice; the second is a hash-keyed map overwrite.
      resolver.provide(updateNeed, signed);
      expect(() => resolver.provide(updateNeed, signed)).to.not.throw();

      state = resolver.resolve();
      expect(state.status).to.equal('resolved');
      if(state.status !== 'resolved') return;
      // Applied exactly once: version is 2 (not 3) and the benign patch landed once.
      expect(state.result.metadata.versionId).to.equal('2');
      expect(state.result.didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 1);
    });

    it('double-providing the same NeedCASAnnouncement is idempotent (advances identically)', () => {
      const { genesisDocument } = externalData[2];
      const casGenesisDoc = JSON.parse(JSON.stringify(genesisDocument));
      casGenesisDoc.service[0].type = 'CASBeacon';
      const casDid = DidBtcr2.create(hash(canonicalize(casGenesisDoc)), { idType: 'EXTERNAL', version: 1, network: 'regtest' });
      const resolver = DidBtcr2.resolve(casDid, { sidecar: { genesisDocument: casGenesisDoc } });

      let state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      const casService = beaconNeed.beaconServices[0] as BeaconService;

      const fakeUpdate = { '@context': [ 'test' ], patch: [], targetHash: 'fake', targetVersionId: 2, sourceHash: 'fake' };
      const updateHash = canonicalHash(fakeUpdate);
      const updateHashHex = canonicalHash(fakeUpdate, { encoding: 'hex' });
      const announcement = { [casDid]: updateHash };
      const announcementHashHex = canonicalHash(announcement, { encoding: 'hex' });

      const signals = new Map<BeaconService, Array<BeaconSignal>>();
      signals.set(casService, [{
        tx            : {} as any,
        signalBytes   : announcementHashHex,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, signals);

      state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedCASAnnouncement');
      const casNeed = state.needs[0] as NeedCASAnnouncement;

      // Provide the same announcement twice; the second is a hash-keyed map overwrite.
      resolver.provide(casNeed, announcement);
      expect(() => resolver.provide(casNeed, announcement)).to.not.throw();

      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedSignedUpdate');
      expect((state.needs[0] as NeedSignedUpdate).updateHash).to.equal(updateHashHex);
    });

    it('double-providing the same NeedSMTProof is idempotent (advances identically)', () => {
      const { genesisDocument } = externalData[2];
      const smtGenesisDoc = JSON.parse(JSON.stringify(genesisDocument));
      smtGenesisDoc.service[0].type = 'SMTBeacon';
      const smtDid = DidBtcr2.create(hash(canonicalize(smtGenesisDoc)), { idType: 'EXTERNAL', version: 1, network: 'regtest' });

      const fakeUpdate = { '@context': [ 'test' ], patch: [], targetHash: 'fake', targetVersionId: 2, sourceHash: 'fake' };
      const nonce = randomBytes(32);
      const signedUpdateBytes = new TextEncoder().encode(canonicalize(fakeUpdate));
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: smtDid, nonce, signedUpdate: signedUpdateBytes }]);
      tree.finalize();
      const rootHashHex = hashToHex(tree.rootHash);
      const smtProof = tree.proof(smtDid);

      const resolver = DidBtcr2.resolve(smtDid, { sidecar: { genesisDocument: smtGenesisDoc } });
      let state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      const smtService = beaconNeed.beaconServices[0] as BeaconService;
      const signals = new Map<BeaconService, Array<BeaconSignal>>();
      signals.set(smtService, [{
        tx            : {} as any,
        signalBytes   : rootHashHex,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, signals);

      state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedSMTProof');
      const smtNeed = state.needs[0] as NeedSMTProof;

      // Provide the same proof twice; the second is a root-hash-keyed map overwrite.
      resolver.provide(smtNeed, smtProof);
      expect(() => resolver.provide(smtNeed, smtProof)).to.not.throw();

      state = resolver.resolve();
      expect(state.status).to.equal('action-required');
      if(state.status !== 'action-required') return;
      expect(state.needs[0].kind).to.equal('NeedSignedUpdate');
      expect((state.needs[0] as NeedSignedUpdate).updateHash).to.equal(canonicalHash(fakeUpdate, { encoding: 'hex' }));
    });

    it('providing data after resolution is complete does not change the result', () => {
      const resolver = DidBtcr2.resolve(fixture.did);
      let state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      provideEmptySignals(resolver, beaconNeed);
      state = resolver.resolve();
      if(state.status !== 'resolved') throw new Error('expected resolved');
      const before = state.result;
      expect(before.metadata.versionId).to.equal('1');

      // A late, non-empty signal for the genesis beacon (a real update hash) must not
      // reopen resolution: the Complete phase returns the cached response.
      const source = resolveDeterministic(fixture.did);
      const [ signed ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [ benignPatch(fixture.did) ]);
      const late = new Map<BeaconService, Array<BeaconSignal>>();
      late.set(beaconNeed.beaconServices[0] as BeaconService, [{
        tx            : {} as any,
        signalBytes   : canonicalHash(signed, { encoding: 'hex' }),
        blockMetadata : { height: 200, time: 1700000000, confirmations: 6 }
      }]);
      expect(() => resolver.provide(beaconNeed, late)).to.not.throw();

      state = resolver.resolve();
      expect(state.status).to.equal('resolved');
      if(state.status !== 'resolved') return;
      expect(state.result.metadata.versionId).to.equal('1');
      expect(state.result.didDocument.id).to.equal(before.didDocument.id);
      expect(canonicalHash(state.result.didDocument)).to.equal(canonicalHash(before.didDocument));
    });

    it('providing NeedBeaconSignals twice for the same service before processing: last write wins', () => {
      const source = resolveDeterministic(fixture.did);
      const [ signed ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [ benignPatch(fixture.did) ]);
      const updateHashHex = canonicalHash(signed, { encoding: 'hex' });

      const resolver = DidBtcr2.resolve(fixture.did, { sidecar: { updates: [ signed ] } });
      const state0 = resolver.resolve();
      if(state0.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
      const beaconNeed = state0.needs[0] as NeedBeaconSignals;
      const genesis = beaconNeed.beaconServices[0] as BeaconService;

      // First: a real update signal on the genesis beacon. Second: empty signals for
      // the same service object. The second set() overwrites the first (the map is
      // keyed by service object reference), so the update is never delivered.
      const withUpdate = new Map<BeaconService, Array<BeaconSignal>>();
      withUpdate.set(genesis, [{
        tx            : {} as any,
        signalBytes   : updateHashHex,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, withUpdate);

      const empty = new Map<BeaconService, Array<BeaconSignal>>();
      empty.set(genesis, []);
      resolver.provide(beaconNeed, empty);

      const state = resolver.resolve();
      expect(state.status).to.equal('resolved');
      if(state.status !== 'resolved') return;
      // The empty second provide won: no update applied, version stays 1.
      expect(state.result.metadata.versionId).to.equal('1');
      expect(state.result.didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length);
    });

    it('a stale round-1 need fulfilled after round 2 begins is skipped by id-dedup', () => {
      const source = resolveDeterministic(fixture.did);
      const { updates, signalByAddress } = buildDiscoveryChain(fixture.did, source, fixture.secretKey, 2);

      const resolver = DidBtcr2.resolve(fixture.did, { sidecar: { updates } });
      let height = 100;
      const signalsFor = (need: NeedBeaconSignals): Map<BeaconService, Array<BeaconSignal>> => {
        const map = new Map<BeaconService, Array<BeaconSignal>>();
        for(const service of need.beaconServices) {
          const address = BeaconUtils.parseBitcoinAddress(service.serviceEndpoint as string);
          const updateHashHex = signalByAddress.get(address);
          map.set(service as BeaconService, updateHashHex
            ? [{ tx: {} as any, signalBytes: updateHashHex, blockMetadata: { height: height++, time: 1700000000, confirmations: 6 } }]
            : []
          );
        }
        return map;
      };

      // Round 1: deliver hop0 on the genesis beacon (others get empty signals).
      let state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected round 1 NeedBeaconSignals');
      const round1Need = state.needs[0] as NeedBeaconSignals;
      resolver.provide(round1Need, signalsFor(round1Need));

      // Round 2: the beacon hop0 added.
      state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected round 2 NeedBeaconSignals');
      const round2Need = state.needs[0] as NeedBeaconSignals;

      // Stale fulfillment: re-provide the round-1 need with FRESH service objects of
      // the same ids, re-delivering hop0. Every round-1 service id is already in
      // #processedServices, so the stale signals must be skipped (no re-collection, no
      // version inflation), even though the map is keyed by object reference.
      const staleSignals = new Map<BeaconService, Array<BeaconSignal>>();
      for(const [ service, sig ] of signalsFor(round1Need)) {
        const fresh: BeaconService = { id: service.id, type: service.type, serviceEndpoint: service.serviceEndpoint };
        staleSignals.set(fresh, sig);
      }
      resolver.provide(round1Need, staleSignals);

      // Now fulfill round 2 (hop1 on the beacon hop0 added).
      resolver.provide(round2Need, signalsFor(round2Need));

      // Round 3: terminal beacon hop1 added; empty signals, then resolve.
      state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected round 3 NeedBeaconSignals');
      provideEmptySignals(resolver, state.needs[0] as NeedBeaconSignals);

      state = resolver.resolve();
      expect(state.status).to.equal('resolved');
      if(state.status !== 'resolved') return;
      // Two hops applied exactly once each despite the stale re-provide: v3, +2 services.
      expect(state.result.metadata.versionId).to.equal('3');
      expect(state.result.didDocument.service.length).to.equal(source.service.length + 2);
    });
  });

  describe('duplicate update handling (Path C, ADR 067)', () => {
    // A confirmed duplicate re-announces an already-applied version. Under Path C it
    // advances neither the version counter nor the document, and it leaves the response
    // metadata (updated / confirmations / versionId) on the last update that actually
    // changed the document. These reproduce the finding-resolver-duplicate-handling
    // traces end-to-end through the resolver loop. Before Path C the version counter
    // incremented on every tuple, which inflated versionId and false-tripped
    // LATE_PUBLISHING_ERROR on the next genuine update.
    const fixture = deterministicData[2]; // regtest - has a known secretKey

    it('resolves [v2, v2-dup, v3]: a duplicate no longer bricks the next genuine update', () => {
      const source = resolveDeterministic(fixture.did);
      // Two genuine benign hops (v1->v2, v2->v3), both discoverable on the genesis beacon.
      const [ u2, u3 ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [
        benignPatch(fixture.did), benignPatch(fixture.did)
      ]);
      // Deliver v2 twice (the second is the duplicate), then v3.
      const { metadata, didDocument } = driveSignalSequence(fixture.did, [ u2, u3 ], [ u2, u2, u3 ]);
      // Before Path C the unconditional increment drove currentVersionId to 3 on the
      // duplicate, so genuine v3 was misread as a duplicate and confirmDuplicate read an
      // empty history slot, throwing a false LATE_PUBLISHING_ERROR. Now it resolves to v3.
      expect(metadata.versionId).to.equal('3');
      expect(didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 2);
    });

    it('a confirmed duplicate does not inflate versionId', () => {
      const source = resolveDeterministic(fixture.did);
      const [ u2 ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [ benignPatch(fixture.did) ]);
      // v2 announced twice, no v3: the duplicate must not advance the counter to 3.
      const { metadata, didDocument } = driveSignalSequence(fixture.did, [ u2 ], [ u2, u2 ]);
      expect(metadata.versionId).to.equal('2');
      expect(didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 1);
    });

    it('resolves [v2, v2-dup, v3, v3-dup]: duplicates of two different non-final versions', () => {
      const source = resolveDeterministic(fixture.did);
      const [ u2, u3 ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [
        benignPatch(fixture.did), benignPatch(fixture.did)
      ]);
      // This is the pattern the reference-impl's contemporary-hash push mishandles; Path C
      // (compare-only) handles it because the history holds only applied-update hashes.
      const { metadata, didDocument } = driveSignalSequence(fixture.did, [ u2, u3 ], [ u2, u2, u3, u3 ]);
      expect(metadata.versionId).to.equal('3');
      expect(didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 2);
    });

    it('resolves [v2, v3, v3-dup]: a duplicate of the latest version is confirmed, not misread', () => {
      const source = resolveDeterministic(fixture.did);
      const [ u2, u3 ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [
        benignPatch(fixture.did), benignPatch(fixture.did)
      ]);
      // updateHashHistory[targetVersionId - 2] holds the applied v3 update once v3 is
      // applied, so the duplicate confirms without the removed contemporary-hash push.
      const { metadata, didDocument } = driveSignalSequence(fixture.did, [ u2, u3 ], [ u2, u3, u3 ]);
      expect(metadata.versionId).to.equal('3');
      expect(didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 2);
    });

    it('confirms a cross-round duplicate re-announced on a beacon an earlier update added', () => {
      const source = resolveDeterministic(fixture.did);
      // Genuine two-hop history: u2 (v1->v2) adds beacon B0 and is announced on the genesis
      // beacon; u3 (v2->v3) is announced on B0 and so is only discovered a round later.
      const { updates, signalByAddress } = buildDiscoveryChain(fixture.did, source, fixture.secretKey, 2);
      const [ u2 ] = updates;
      const u2hash = canonicalHash(u2, { encoding: 'hex' });
      // Recompute B0's address the way buildDiscoveryChain derives it (secret byte i+1),
      // so round 2 can re-announce u2 there as a redundant duplicate.
      const secret = new Uint8Array(32);
      secret[31] = 1;
      const addedBeaconAddress = p2wpkh(secp256k1.getPublicKey(secret, true), getNetwork('regtest')).address!;

      const resolver = DidBtcr2.resolve(fixture.did, { sidecar: { updates } });
      let height = 100;
      let state = resolver.resolve();
      while(state.status === 'action-required') {
        const need = state.needs[0] as NeedBeaconSignals;
        const signals = new Map<BeaconService, Array<BeaconSignal>>();
        for(const service of need.beaconServices) {
          const address = BeaconUtils.parseBitcoinAddress(service.serviceEndpoint as string);
          const sigs: Array<BeaconSignal> = [];
          const primary = signalByAddress.get(address);
          if(primary) sigs.push({ tx: {} as any, signalBytes: primary, blockMetadata: { height: height++, time: 1700000000, confirmations: 6 } });
          // Redundantly re-announce u2 on the beacon it added; this signal is discovered a
          // round after u2 was applied, so confirmDuplicate must confirm it against the
          // update-hash history carried across discovery rounds (ADR 060), not misread it.
          if(address === addedBeaconAddress) sigs.push({ tx: {} as any, signalBytes: u2hash, blockMetadata: { height: height++, time: 1700000050, confirmations: 6 } });
          signals.set(service as BeaconService, sigs);
        }
        resolver.provide(need, signals);
        state = resolver.resolve();
      }
      if(state.status !== 'resolved') throw new Error('expected resolved');
      // Before Path C the cross-round duplicate false-tripped LATE_PUBLISHING_ERROR; now the
      // history resolves to v3 with both added beacons present.
      expect(state.result.metadata.versionId).to.equal('3');
      expect(state.result.didDocument.service.length).to.equal(source.service.length + 2);
    });

    it('still rejects a false duplicate whose unsigned hash does not match history', () => {
      const source = resolveDeterministic(fixture.did);
      const vm = source.verificationMethod![0]!;
      const signer = new LocalSigner(hexToBytes(fixture.secretKey));
      // Two distinct v1->v2 updates (both targetVersionId 2) with different patches, so
      // their unsigned-update hashes differ.
      const applied = Updater.sign(
        fixture.did, Updater.construct(source, benignPatch(fixture.did), 1), vm, signer
      );
      const forgedDuplicate = Updater.sign(
        fixture.did,
        Updater.construct(
          source,
          [{ op: 'add' as const, path: '/capabilityDelegation/-', value: `${fixture.did}#initialKey` }],
          1
        ),
        vm, signer
      );
      // `applied` applies first (v1->v2); `forgedDuplicate` then enters the duplicate
      // branch (targetVersionId 2 <= currentVersionId 2) but fails confirmation because
      // its unsigned hash does not match the applied update recorded in the history.
      let thrown: any;
      try {
        driveSignalSequence(fixture.did, [ applied, forgedDuplicate ], [ applied, forgedDuplicate ]);
      } catch(error) {
        thrown = error;
      }
      expect(thrown, 'expected a false duplicate to throw').to.exist;
      expect(thrown.type).to.equal(LATE_PUBLISHING_ERROR);
      expect(thrown.message).to.match(/invalid duplicate/i);
    });

    it('confirms a duplicate arriving on a second beacon the DID controls (redundant announcement)', () => {
      const source = resolveDeterministic(fixture.did);
      // A deterministic k1 DID exposes three beacons (p2pkh/p2wpkh/p2tr) derived from the
      // one key. Announcing the same real update on two of them is a plausible redundancy
      // pattern; both signals reach Resolver.updates() as the same update, one applied and
      // one confirmed as a duplicate.
      const [ u2 ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [ benignPatch(fixture.did) ]);
      const updateHashHex = canonicalHash(u2, { encoding: 'hex' });

      const resolver = DidBtcr2.resolve(fixture.did, { sidecar: { updates: [ u2 ] } });
      let state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
      const need = state.needs[0] as NeedBeaconSignals;
      expect(need.beaconServices.length).to.equal(3);

      // Deliver u2 on the first two beacons, empty on the third.
      const signals = new Map<BeaconService, Array<BeaconSignal>>();
      need.beaconServices.forEach((service, i) => {
        signals.set(service as BeaconService, i < 2
          ? [{ tx: {} as any, signalBytes: updateHashHex, blockMetadata: { height: 100 + i, time: 1700000000, confirmations: 6 } }]
          : []
        );
      });
      resolver.provide(need, signals);

      state = resolver.resolve();
      expect(state.status).to.equal('resolved');
      if(state.status !== 'resolved') return;
      // Applied once, confirmed once: version 2 (not inflated to 3), patch landed once.
      expect(state.result.metadata.versionId).to.equal('2');
      expect(state.result.didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 1);
    });
  });

  describe('duplicate edge cases (ADR 068)', () => {
    // Two edges of duplicate handling: (1) updates sort by targetVersionId before block
    // height, so a duplicate of an early version mined after a versionTime query point
    // used to trip the versionTime early-return before genuine in-window updates were
    // processed; duplicates are now confirmed before the versionTime check. (2) the
    // duplicate-confirmation history read updateHashHistory[targetVersionId - 2] used to
    // be unguarded, so a crafted targetVersionId below 2 (or a non-integer) crashed with
    // a raw TypeError instead of a typed ResolveError.
    const fixture = deterministicData[2]; // regtest - has a known secretKey

    it('versionTime: an over-window duplicate does not truncate the in-window history', () => {
      const source = resolveDeterministic(fixture.did);
      const [ u2, u3 ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [
        benignPatch(fixture.did), benignPatch(fixture.did)
      ]);
      // u2 mined Nov 2023 (in-window), a duplicate of u2 re-announced in 2030 (over-window),
      // genuine u3 mined Dec 2024 (in-window). Sorting by targetVersionId puts the 2030
      // duplicate ahead of u3, so the old check returned v2 and never processed u3.
      const { metadata, didDocument } = driveSignalSequence(
        fixture.did, [ u2, u3 ], [ u2, u2, u3 ],
        [
          { height: 100, time: 1700000000, confirmations: 6 },
          { height: 200, time: 1900000000, confirmations: 6 },
          { height: 150, time: 1735000000, confirmations: 6 }
        ],
        '2025-01-01T00:00:00Z'
      );
      // The version valid at 2025-01-01 is v3: both genuine updates predate it.
      expect(metadata.versionId).to.equal('3');
      expect(didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 2);
    });

    it('versionTime: a skipped over-window duplicate does not extend the view past versionTime', () => {
      const source = resolveDeterministic(fixture.did);
      const [ u2, u3 ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [
        benignPatch(fixture.did), benignPatch(fixture.did)
      ]);
      // The mirror of the test above: u2 is in-window, but its duplicate AND genuine u3 are
      // both mined after versionTime. The duplicate is confirmed and skipped; u3 must still
      // trip the versionTime early-return on its own blocktime, stopping at v2. Pins that
      // the duplicate branch's continue never carries resolution past the query point.
      const { metadata, didDocument } = driveSignalSequence(
        fixture.did, [ u2, u3 ], [ u2, u2, u3 ],
        [
          { height: 100, time: 1700000000, confirmations: 6 },
          { height: 200, time: 1900000000, confirmations: 6 },
          { height: 210, time: 1910000000, confirmations: 6 }
        ],
        '2025-01-01T00:00:00Z'
      );
      expect(metadata.versionId).to.equal('2');
      expect(didDocument.assertionMethod!.length).to.equal(source.assertionMethod!.length + 1);
    });

    it('versionTime: an over-window false duplicate still fails resolution as late publishing', () => {
      const source = resolveDeterministic(fixture.did);
      const vm = source.verificationMethod![0]!;
      const signer = new LocalSigner(hexToBytes(fixture.secretKey));
      const applied = Updater.sign(
        fixture.did, Updater.construct(source, benignPatch(fixture.did), 1), vm, signer
      );
      // A different update claiming the already-applied version 2, mined after versionTime.
      const forged = Updater.sign(
        fixture.did,
        Updater.construct(
          source,
          [{ op: 'add' as const, path: '/capabilityDelegation/-', value: `${fixture.did}#initialKey` }],
          1
        ),
        vm, signer
      );
      // A versionTime query is a view of the history, not an integrity waiver: equivocation
      // evidence mined after versionTime still fails resolution instead of being hidden by
      // the early return.
      let thrown: any;
      try {
        driveSignalSequence(
          fixture.did, [ applied, forged ], [ applied, forged ],
          [
            { height: 100, time: 1700000000, confirmations: 6 },
            { height: 200, time: 1900000000, confirmations: 6 }
          ],
          '2025-01-01T00:00:00Z'
        );
      } catch(error) {
        thrown = error;
      }
      expect(thrown, 'expected the false duplicate to fail resolution').to.exist;
      expect(thrown.type).to.equal(LATE_PUBLISHING_ERROR);
      expect(thrown.message).to.match(/invalid duplicate/i);
    });

    it('a crafted update with targetVersionId 1 throws a typed error, not a TypeError', () => {
      // Enters the duplicate branch on the first tuple (1 <= 1); the history is empty, so
      // the unguarded read used to crash with a raw TypeError on the byte comparison.
      const crafted = {
        '@context'      : [ 'test' ],
        patch           : [],
        sourceHash      : 'x',
        targetHash      : 'y',
        targetVersionId : 1,
        proof           : { type: 'DataIntegrityProof' }
      } as unknown as SignedBTCR2Update;
      let thrown: any;
      try {
        driveSignalSequence(fixture.did, [ crafted ], [ crafted ]);
      } catch(error) {
        thrown = error;
      }
      expect(thrown, 'expected the crafted duplicate to throw').to.exist;
      expect(thrown).to.not.be.instanceOf(TypeError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
      expect(thrown.message).to.match(/targetVersionId/i);
    });

    it('a crafted update with a non-integer targetVersionId throws a typed error', () => {
      // 0.5 <= currentVersionId 1 routes into the duplicate branch; the fractional index
      // used to read an undefined slot and crash.
      const crafted = {
        '@context'      : [ 'test' ],
        patch           : [],
        sourceHash      : 'x',
        targetHash      : 'y',
        targetVersionId : 0.5,
        proof           : { type: 'DataIntegrityProof' }
      } as unknown as SignedBTCR2Update;
      let thrown: any;
      try {
        driveSignalSequence(fixture.did, [ crafted ], [ crafted ]);
      } catch(error) {
        thrown = error;
      }
      expect(thrown, 'expected the crafted duplicate to throw').to.exist;
      expect(thrown).to.not.be.instanceOf(TypeError);
      expect(thrown.type).to.equal(INVALID_DID_UPDATE);
    });

    it('Resolver.updates() with a version counter that outruns its history throws typed late publishing', () => {
      // A standalone caller can pass a resolutionState whose counter exceeds its history;
      // a duplicate then names a version with no recorded applied update. Unconfirmable
      // duplicates are late-publishing evidence, and must not surface as a TypeError.
      const source = resolveDeterministic(fixture.did);
      const [ , u3 ] = buildUpdateChain(fixture.did, source, fixture.secretKey, [
        benignPatch(fixture.did), benignPatch(fixture.did)
      ]);
      let thrown: any;
      try {
        Resolver.updates(
          source,
          [[ u3, { height: 100, time: 1700000000, confirmations: 6 } ]],
          undefined,
          undefined,
          { currentVersionId: 5, updateHashHistory: [] }
        );
      } catch(error) {
        thrown = error;
      }
      expect(thrown, 'expected the unconfirmable duplicate to throw').to.exist;
      expect(thrown).to.not.be.instanceOf(TypeError);
      expect(thrown.type).to.equal(LATE_PUBLISHING_ERROR);
      expect(thrown.message).to.match(/no applied update/i);
    });

    it('provide() rejects a signed update whose targetVersionId is not an integer >= 2', () => {
      // The crafted update passes every other shape check and matches the signal's hash
      // binding (the signal IS its hash), so only the tightened targetVersionId guard
      // rejects it at the provide() boundary.
      const crafted = {
        '@context'      : [ 'test' ],
        patch           : [],
        sourceHash      : 'x',
        targetHash      : 'y',
        targetVersionId : 1,
        proof           : { type: 'DataIntegrityProof' }
      };
      const craftedHashHex = canonicalHash(crafted, { encoding: 'hex' });

      const resolver = DidBtcr2.resolve(fixture.did); // empty sidecar
      let state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedBeaconSignals');
      const beaconNeed = state.needs[0] as NeedBeaconSignals;
      const signals = new Map<BeaconService, Array<BeaconSignal>>();
      signals.set(beaconNeed.beaconServices[0] as BeaconService, [{
        tx            : {} as any,
        signalBytes   : craftedHashHex,
        blockMetadata : { height: 100, time: 1700000000, confirmations: 6 }
      }]);
      resolver.provide(beaconNeed, signals);

      state = resolver.resolve();
      if(state.status !== 'action-required') throw new Error('expected NeedSignedUpdate');
      const updateNeed = state.needs[0] as NeedSignedUpdate;
      expect(updateNeed.updateHash).to.equal(craftedHashHex);
      expect(() => resolver.provide(updateNeed, crafted as any)).to.throw(/not a signed BTCR2 update/i);
    });
  });
});
