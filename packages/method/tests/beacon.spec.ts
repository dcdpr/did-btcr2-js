import { canonicalize, canonicalHash, hash } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { BTCR2MerkleTree } from '@did-btcr2/smt';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { expect } from 'chai';
import { CASBeacon } from '../src/core/beacon/cas-beacon.js';
import type { BeaconService, BeaconSignal, BlockMetadata } from '../src/core/beacon/interfaces.js';
import { SingletonBeacon } from '../src/core/beacon/singleton-beacon.js';
import { SMTBeacon } from '../src/core/beacon/smt-beacon.js';
import type { SMTProof } from '../src/core/interfaces.js';
import type { CASAnnouncement, SidecarData } from '../src/core/types.js';

/** Helper: empty sidecar data maps for each beacon type. */
function emptySidecar(): SidecarData {
  return {
    updateMap : new Map<string, SignedBTCR2Update>(),
    casMap    : new Map<string, CASAnnouncement>(),
    smtMap    : new Map<string, SMTProof>(),
  };
}

/** Helper: stock block metadata for test signals. */
const blockMeta: BlockMetadata = { height: 100, time: 1700000000, confirmations: 6 };

/** Helper: a fake signed update object for tests. */
function fakeUpdate(marker: string): SignedBTCR2Update {
  return {
    '@context'       : ['test'],
    patch            : [],
    sourceHash       : `${marker}-source`,
    targetHash       : `${marker}-target`,
    targetVersionId  : 2,
  } as unknown as SignedBTCR2Update;
}

/** Helper: a fake BeaconSignal with given hex signal bytes. */
function fakeSignal(signalBytes: string): BeaconSignal {
  return { tx: {} as unknown as BeaconSignal['tx'], signalBytes, blockMetadata: blockMeta };
}

const DID = 'did:btcr2:k1q5ptvjpcgt0jfgvddau2fllfcpxwa5qtw2umkafp5xqwqr72a7xanvcjf324y';

describe('Beacon.processSignals', () => {

  describe('SingletonBeacon', () => {
    const service: BeaconService = {
      id              : `${DID}#beacon-1`,
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    };
    const beacon = new SingletonBeacon(service);

    it('returns update when signal bytes match a sidecar entry', () => {
      const update = fakeUpdate('singleton-happy');
      const updateHashBytes = hash(canonicalize(update));
      const updateHashHex = bytesToHex(updateHashBytes);

      const sidecar = emptySidecar();
      sidecar.updateMap.set(updateHashHex, update);

      const result = beacon.processSignals([fakeSignal(updateHashHex)], sidecar);

      expect(result.updates).to.have.length(1);
      expect(result.updates[0]![0]).to.deep.equal(update);
      expect(result.updates[0]![1]).to.deep.equal(blockMeta);
      expect(result.needs).to.be.empty;
    });

    it('emits NeedSignedUpdate when update is missing from sidecar', () => {
      const update = fakeUpdate('singleton-missing');
      const updateHashHex = bytesToHex(hash(canonicalize(update)));

      const result = beacon.processSignals([fakeSignal(updateHashHex)], emptySidecar());

      expect(result.updates).to.be.empty;
      expect(result.needs).to.have.length(1);
      expect(result.needs[0]!.kind).to.equal('NeedSignedUpdate');
      expect((result.needs[0] as { updateHash: string }).updateHash).to.equal(updateHashHex);
    });
  });

  describe('CASBeacon', () => {
    const service: BeaconService = {
      id              : `${DID}#beacon-1`,
      type            : 'CASBeacon',
      serviceEndpoint : 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    };
    const beacon = new CASBeacon(service);

    it('returns update when CAS announcement and signed update are in sidecar', () => {
      const update = fakeUpdate('cas-happy');
      // CAS announcement values are base64urlnopad per spec
      const updateHashB64 = canonicalHash(update);
      const announcement: CASAnnouncement = { [DID]: updateHashB64 };
      const announcementHashHex = bytesToHex(hash(canonicalize(announcement)));

      // updateMap is keyed by hex
      const updateHashHex = bytesToHex(hash(canonicalize(update)));

      const sidecar = emptySidecar();
      sidecar.casMap.set(announcementHashHex, announcement);
      sidecar.updateMap.set(updateHashHex, update);

      const result = beacon.processSignals([fakeSignal(announcementHashHex)], sidecar);

      expect(result.updates).to.have.length(1);
      expect(result.updates[0]![0]).to.deep.equal(update);
      expect(result.needs).to.be.empty;
    });

    it('emits NeedCASAnnouncement when announcement is missing', () => {
      const announcementHashHex = bytesToHex(hash(canonicalize({ placeholder: true })));
      const result = beacon.processSignals([fakeSignal(announcementHashHex)], emptySidecar());

      expect(result.updates).to.be.empty;
      expect(result.needs).to.have.length(1);
      expect(result.needs[0]!.kind).to.equal('NeedCASAnnouncement');
      expect((result.needs[0] as { announcementHash: string }).announcementHash).to.equal(announcementHashHex);
    });

    it('skips signal when CAS announcement has no entry for this DID (multi-DID batch)', () => {
      // Announcement contains entries for OTHER dids only
      const otherDid = 'did:btcr2:k1q5pcyz9x806tq82vysz6tde0lpge4frgmuxx33dxz6zxtkx7ljwg78q7n2tc4';
      const otherUpdate = fakeUpdate('cas-other');
      const announcement: CASAnnouncement = { [otherDid]: canonicalHash(otherUpdate) };
      const announcementHashHex = bytesToHex(hash(canonicalize(announcement)));

      const sidecar = emptySidecar();
      sidecar.casMap.set(announcementHashHex, announcement);

      const result = beacon.processSignals([fakeSignal(announcementHashHex)], sidecar);

      // No update for our DID in this announcement — silently skip, no needs emitted
      expect(result.updates).to.be.empty;
      expect(result.needs).to.be.empty;
    });

    it('emits NeedSignedUpdate when announcement has entry but update is missing', () => {
      const update = fakeUpdate('cas-update-missing');
      const announcement: CASAnnouncement = { [DID]: canonicalHash(update) };
      const announcementHashHex = bytesToHex(hash(canonicalize(announcement)));
      const updateHashHex = bytesToHex(hash(canonicalize(update)));

      const sidecar = emptySidecar();
      sidecar.casMap.set(announcementHashHex, announcement);
      // updateMap is intentionally empty

      const result = beacon.processSignals([fakeSignal(announcementHashHex)], sidecar);

      expect(result.updates).to.be.empty;
      expect(result.needs).to.have.length(1);
      expect(result.needs[0]!.kind).to.equal('NeedSignedUpdate');
      expect((result.needs[0] as { updateHash: string }).updateHash).to.equal(updateHashHex);
    });
  });

  describe('SMTBeacon', () => {
    const service: BeaconService = {
      id              : `${DID}#beacon-1`,
      type            : 'SMTBeacon',
      serviceEndpoint : 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    };
    const beacon = new SMTBeacon(service);

    it('returns update when SMT proof and signed update are in sidecar', () => {
      const update = fakeUpdate('smt-happy');
      const canonicalBytes = new TextEncoder().encode(canonicalize(update));
      const nonce = randomBytes(32);
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: DID, nonce, signedUpdate: canonicalBytes }]);
      tree.finalize();
      const proof = tree.proof(DID);

      const updateHashHex = bytesToHex(hash(canonicalize(update)));
      const sidecar = emptySidecar();
      sidecar.smtMap.set(proof.id, proof);
      sidecar.updateMap.set(updateHashHex, update);

      const result = beacon.processSignals([fakeSignal(proof.id)], sidecar);

      expect(result.updates).to.have.length(1);
      expect(result.updates[0]![0]).to.deep.equal(update);
      expect(result.needs).to.be.empty;
    });

    it('emits NeedSMTProof when proof is missing from sidecar', () => {
      const rootHex = '0000000000000000000000000000000000000000000000000000000000000000';
      const result = beacon.processSignals([fakeSignal(rootHex)], emptySidecar());

      expect(result.updates).to.be.empty;
      expect(result.needs).to.have.length(1);
      expect(result.needs[0]!.kind).to.equal('NeedSMTProof');
      expect((result.needs[0] as { smtRootHash: string }).smtRootHash).to.equal(rootHex);
    });

    it('skips non-inclusion proofs (no updateId)', () => {
      // A non-inclusion proof has nonce but no updateId
      const nonce = randomBytes(32);
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: DID, nonce }]); // no signedUpdate → non-inclusion
      tree.finalize();
      const proof = tree.proof(DID);
      expect(proof.updateId).to.be.undefined;

      const sidecar = emptySidecar();
      sidecar.smtMap.set(proof.id, proof);

      const result = beacon.processSignals([fakeSignal(proof.id)], sidecar);

      // Non-inclusion: no updates, no needs emitted — this beacon has nothing for this DID
      expect(result.updates).to.be.empty;
      expect(result.needs).to.be.empty;
    });

    it('throws when proof is missing the required nonce', () => {
      const update = fakeUpdate('smt-no-nonce');
      const updateHashHex = bytesToHex(hash(canonicalize(update)));
      const rootHex = '1111111111111111111111111111111111111111111111111111111111111111';

      // Malformed proof — has updateId but no nonce
      const badProof: SMTProof = {
        id        : rootHex,
        updateId  : updateHashHex,
        collapsed : '0',
        hashes    : [],
      };

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, badProof);

      expect(() => beacon.processSignals([fakeSignal(rootHex)], sidecar)).to.throw(
        'SMT proof missing required nonce field.'
      );
    });

    it('throws when Merkle inclusion proof fails verification', () => {
      // Build a valid tree & proof, then tamper with the proof's nonce
      const update = fakeUpdate('smt-tampered');
      const canonicalBytes = new TextEncoder().encode(canonicalize(update));
      const nonce = randomBytes(32);
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: DID, nonce, signedUpdate: canonicalBytes }]);
      tree.finalize();
      const proof = tree.proof(DID);

      // Tamper: replace the nonce with all zeros, which won't satisfy the proof
      const tampered: SMTProof = {
        ...proof,
        nonce : '0000000000000000000000000000000000000000000000000000000000000000',
      };

      const sidecar = emptySidecar();
      sidecar.smtMap.set(tampered.id, tampered);

      expect(() => beacon.processSignals([fakeSignal(tampered.id)], sidecar)).to.throw(
        'SMT proof verification failed.'
      );
    });

    it('emits NeedSignedUpdate when proof is valid but update is missing', () => {
      const update = fakeUpdate('smt-update-missing');
      const canonicalBytes = new TextEncoder().encode(canonicalize(update));
      const nonce = randomBytes(32);
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: DID, nonce, signedUpdate: canonicalBytes }]);
      tree.finalize();
      const proof = tree.proof(DID);

      const sidecar = emptySidecar();
      sidecar.smtMap.set(proof.id, proof);
      // updateMap intentionally empty

      const result = beacon.processSignals([fakeSignal(proof.id)], sidecar);

      expect(result.updates).to.be.empty;
      expect(result.needs).to.have.length(1);
      expect(result.needs[0]!.kind).to.equal('NeedSignedUpdate');
      // updateHash emitted should be the hex canonical hash of the update (matches proof.updateId)
      expect((result.needs[0] as { updateHash: string }).updateHash).to.equal(proof.updateId);
    });
  });
});
