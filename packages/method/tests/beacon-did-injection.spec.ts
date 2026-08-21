import { canonicalize, encode } from '@did-btcr2/common';
import { base64UrlToHash, blockHash, BTCR2MerkleTree, hashToHex } from '@did-btcr2/smt';
import { randomBytes } from '@noble/hashes/utils';
import { expect } from 'chai';
import type { SignedBTCR2Update } from '../src/core/btcr2-update.js';
import { CASBeacon } from '../src/core/beacon/cas-beacon.js';
import { BeaconFactory } from '../src/core/beacon/factory.js';
import type { BeaconService, BeaconSignal, BlockMetadata } from '../src/core/beacon/interfaces.js';
import { SMTBeacon } from '../src/core/beacon/smt-beacon.js';
import type { SMTProof } from '../src/core/interfaces.js';
import type { CASAnnouncement, SidecarData } from '../src/core/types.js';

/**
 * A beacon serves one DID, and that DID is injected by the caller rather than
 * recovered from the beacon's own `service.id`. DID Core permits a service `id`
 * to be a relative DID URL (`#cohort-1`), which carries no DID to strip a
 * fragment from, so the old derivation produced the empty string and silently
 * keyed the wrong tree index (SMT) or the wrong announcement entry (CAS).
 */

const DID = 'did:btcr2:x1qk8wjcft0ypu2ju5v89p590jaklr30w7tprlpk9rt22f4y2qlq2j7fvyr2z';
const ENDPOINT = 'bitcoin:tb1pg5zz46v2fynlzm5rmjce3u4m86x90t9me2tprz4et3w52f3s6vaqntpjhk';
const blockMeta: BlockMetadata = { height: 100, time: 1700000000, confirmations: 6 };

/** A beacon service whose `id` is a relative DID URL, as DID Core permits. */
const relativeService: BeaconService = {
  id              : '#cohort-mutinynet-smt-2',
  type            : 'SMTBeacon',
  serviceEndpoint : ENDPOINT,
};

function update(marker: string): SignedBTCR2Update {
  return {
    '@context'      : ['https://btcr2.dev/context/v1'],
    patch           : [{ op: 'add', path: '/service/4', value: { id: `#${marker}` } }],
    sourceHash      : `${marker}-source`,
    targetHash      : `${marker}-target`,
    targetVersionId : 2,
  } as unknown as SignedBTCR2Update;
}

function canonicalHashHex(u: SignedBTCR2Update): string {
  return hashToHex(blockHash(new TextEncoder().encode(canonicalize(u))));
}

function emptySidecar(): SidecarData {
  return {
    updateMap : new Map<string, SignedBTCR2Update>(),
    casMap    : new Map<string, CASAnnouncement>(),
    smtMap    : new Map<string, SMTProof>(),
  };
}

describe('beacons take the DID by injection, not from service.id', () => {
  describe('BeaconFactory', () => {
    it('binds the supplied DID to every beacon type', () => {
      for(const type of ['SingletonBeacon', 'CASBeacon', 'SMTBeacon'] as const) {
        const beacon = BeaconFactory.establish({ id: '#beacon-1', type, serviceEndpoint: ENDPOINT }, DID);
        expect(beacon.did, type).to.equal(DID);
      }
    });

    it('keeps the DID distinct from the service id', () => {
      const beacon = BeaconFactory.establish(relativeService, DID);
      expect(beacon.service.id).to.equal('#cohort-mutinynet-smt-2');
      expect(beacon.did).to.equal(DID);
    });
  });

  describe('SMTBeacon', () => {
    it('verifies a proof for a relative service id, indexing on the injected DID', () => {
      const signedUpdate = update('didcomm');
      const canonicalBytes = new TextEncoder().encode(canonicalize(signedUpdate));
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: DID, nonce: randomBytes(32), signedUpdate: canonicalBytes }]);
      tree.finalize();
      const proof = tree.proof(DID);

      const sidecar = emptySidecar();
      sidecar.smtMap.set(hashToHex(base64UrlToHash(proof.id)), proof);
      sidecar.updateMap.set(canonicalHashHex(signedUpdate), signedUpdate);

      const result = new SMTBeacon(relativeService, DID).processSignals([{
        tx            : {} as BeaconSignal['tx'],
        signalBytes   : hashToHex(base64UrlToHash(proof.id)),
        blockMetadata : blockMeta,
      }], sidecar);

      expect(result.needs).to.have.lengthOf(0);
      expect(result.updates).to.have.lengthOf(1);
      expect(result.updates[0]![0]).to.deep.equal(signedUpdate);
    });

    it('fails a proof built for a different DID', () => {
      const signedUpdate = update('didcomm');
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{
        did          : 'did:btcr2:x1qh9vyxphx0rhgpmwpa0p3u0qd5m8kf9lnya2tutsyfsf7z27jt09kargft7',
        nonce        : randomBytes(32),
        signedUpdate : new TextEncoder().encode(canonicalize(signedUpdate)),
      }]);
      tree.finalize();
      const proof = tree.proof('did:btcr2:x1qh9vyxphx0rhgpmwpa0p3u0qd5m8kf9lnya2tutsyfsf7z27jt09kargft7');

      const sidecar = emptySidecar();
      sidecar.smtMap.set(hashToHex(base64UrlToHash(proof.id)), proof);

      expect(() => new SMTBeacon(relativeService, DID).processSignals([{
        tx            : {} as BeaconSignal['tx'],
        signalBytes   : hashToHex(base64UrlToHash(proof.id)),
        blockMetadata : blockMeta,
      }], sidecar)).to.throw(/verification failed/);
    });

    it('reports the injected DID in the error data, never the empty string', () => {
      const sidecar = emptySidecar();
      const proof: SMTProof = {
        id        : encode(randomBytes(32), 'base64urlnopad'),
        updateId  : encode(randomBytes(32), 'base64urlnopad'),
        collapsed : encode(new Uint8Array(32), 'base64urlnopad'),
        hashes    : [],
      };
      sidecar.smtMap.set(hashToHex(base64UrlToHash(proof.id)), proof);

      try {
        new SMTBeacon(relativeService, DID).processSignals([{
          tx            : {} as BeaconSignal['tx'],
          signalBytes   : hashToHex(base64UrlToHash(proof.id)),
          blockMetadata : blockMeta,
        }], sidecar);
        expect.fail('expected a throw');
      } catch (error: any) {
        expect(error.data.did).to.equal(DID);
      }
    });
  });

  describe('CASBeacon', () => {
    it('reads the announcement entry keyed by the injected DID', () => {
      const signedUpdate = update('dwn');
      const updateHashHex = canonicalHashHex(signedUpdate);
      const announcement: CASAnnouncement = {
        [DID] : encode(base64UrlToHash(encode(new Uint8Array(Buffer.from(updateHashHex, 'hex')), 'base64urlnopad')), 'base64urlnopad'),
      };
      const announcementHashHex = hashToHex(
        blockHash(new TextEncoder().encode(canonicalize(announcement)))
      );

      const sidecar = emptySidecar();
      sidecar.casMap.set(announcementHashHex, announcement);
      sidecar.updateMap.set(updateHashHex, signedUpdate);

      const service: BeaconService = { id: '#cas-1', type: 'CASBeacon', serviceEndpoint: ENDPOINT };
      const result = new CASBeacon(service, DID).processSignals([{
        tx            : {} as BeaconSignal['tx'],
        signalBytes   : announcementHashHex,
        blockMetadata : blockMeta,
      }], sidecar);

      expect(result.needs).to.have.lengthOf(0);
      expect(result.updates).to.have.lengthOf(1);
      expect(result.updates[0]![0]).to.deep.equal(signedUpdate);
    });
  });
});
