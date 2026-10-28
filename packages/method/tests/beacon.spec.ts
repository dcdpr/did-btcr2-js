import { getNetwork } from '@did-btcr2/bitcoin';
import { canonicalHashBytes, canonicalize, canonicalHash, decode, encode, hash, INVALID_SIGNAL_DATA, MethodError, MISSING_UPDATE_DATA } from '@did-btcr2/std';
import type { SignedBTCR2Update } from '@did-btcr2/method';
import { BTCR2MerkleTree, hashToHex, type TreeEntry } from '@did-btcr2/smt';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { base58check, bech32, bech32m } from '@scure/base';
import { p2pkh, p2sh, p2tr, p2wpkh } from '@scure/btc-signer';
import { expect } from 'chai';
import { SinglePartyBeacon } from '../src/core/beacon/beacon.js';
import { CASBeacon } from '../src/core/beacon/cas-beacon.js';
import { CASBeaconError, SMTBeaconError } from '../src/core/beacon/error.js';
import { BeaconFactory } from '../src/core/beacon/factory.js';
import type { BeaconService, BeaconSignal, BlockMetadata } from '../src/core/beacon/interfaces.js';
import { SingletonBeacon } from '../src/core/beacon/singleton-beacon.js';
import { SMTBeacon } from '../src/core/beacon/smt-beacon.js';
import { BeaconUtils } from '../src/core/beacon/utils.js';
import type { SMTProof } from '../src/core/interfaces.js';
import type { CASAnnouncement, SidecarData } from '../src/core/types.js';
import { BTCR2_DID_DOCUMENT_CONTEXT, DidDocument } from '../src/utils/did-document.js';

/** Helper: empty sidecar data maps for each beacon type. */
function emptySidecar(): SidecarData {
  return {
    updateMap : new Map<string, SignedBTCR2Update>(),
    casMap    : new Map<string, CASAnnouncement>(),
    smtMap    : new Map<string, SMTProof>(),
  };
}

/** Helper: stock block metadata for test signals. */
const blockMeta: BlockMetadata = { height: 100, time: 1700000000, mediantime: 1700000000, confirmations: 6 };

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

/** The base64url letters in the order of their values (RFC 4648 Section 5). */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Helper: the same base64url text with a non-zero pad bit. A lenient decoder gets the same bytes. */
function padBit(text: string): string {
  return text.slice(0, -1) + LETTERS[LETTERS.indexOf(text.at(-1)!) | 1];
}

/** Helper: the error that `fn` throws, or undefined. */
function thrownBy(fn: () => unknown): any {
  try {
    fn();
  } catch(error) {
    return error;
  }
  return undefined;
}

describe('SinglePartyBeacon.processSignals', () => {

  describe('SingletonBeacon', () => {
    const service: BeaconService = {
      id              : `${DID}#beacon-1`,
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    };
    const beacon = new SingletonBeacon(service, DID);

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
    const beacon = new CASBeacon(service, DID);

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

      // No update for our DID in this announcement - silently skip, no needs emitted
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

    const valid = canonicalHash(fakeUpdate('cas-bad-entry'));
    for(const [label, value] of [
      ['an empty string', ''],
      ['a hash with non-zero pad bits', padBit(valid)],
      ['a hash with "=" padding', `${valid}=`],
      ['a hash with a base64 letter outside base64url ("+")', `+${valid.slice(1)}`],
      ['a 31-byte value', encode(randomBytes(31), 'base64urlnopad')],
      ['a 33-byte value', encode(randomBytes(33), 'base64urlnopad')],
      ['a number', 42],
      ['null', null]
    ] as Array<[string, unknown]>) {
      it(`throws MISSING_UPDATE_DATA if the value of the entry for this DID is ${label}`, () => {
        const announcement = { [DID]: value } as unknown as CASAnnouncement;
        const announcementHashHex = bytesToHex(hash(canonicalize(announcement)));

        const sidecar = emptySidecar();
        sidecar.casMap.set(announcementHashHex, announcement);

        const thrown = thrownBy(() => beacon.processSignals([fakeSignal(announcementHashHex)], sidecar));
        expect(thrown).to.be.instanceOf(CASBeaconError);
        expect(thrown.type).to.equal(MISSING_UPDATE_DATA);
        expect(thrown.data).to.deep.equal({
          did              : DID,
          value,
          announcementHash : announcementHashHex,
          beaconServiceId  : service.id
        });
      });
    }

    it('ignores a malformed value for another DID if the value for this DID is valid', () => {
      const otherDid = 'did:btcr2:k1q5pcyz9x806tq82vysz6tde0lpge4frgmuxx33dxz6zxtkx7ljwg78q7n2tc4';
      for(const otherValue of ['', padBit(canonicalHash(fakeUpdate('cas-other'))), null]) {
        const update = fakeUpdate('cas-other-entry');
        const announcement = { [otherDid]: otherValue, [DID]: canonicalHash(update) } as unknown as CASAnnouncement;
        const announcementHashHex = bytesToHex(hash(canonicalize(announcement)));

        const sidecar = emptySidecar();
        sidecar.casMap.set(announcementHashHex, announcement);
        sidecar.updateMap.set(bytesToHex(hash(canonicalize(update))), update);

        const result = beacon.processSignals([fakeSignal(announcementHashHex)], sidecar);
        expect(result.needs, String(otherValue)).to.be.empty;
        expect(result.updates).to.have.length(1);
        expect(result.updates[0]![0]).to.deep.equal(update);
      }
    });
  });

  describe('SMTBeacon', () => {
    const service: BeaconService = {
      id              : `${DID}#beacon-1`,
      type            : 'SMTBeacon',
      serviceEndpoint : 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    };
    const beacon = new SMTBeacon(service, DID);

    /** A finalized single-entry tree for DID: the hex root (the signal bytes) and the proof. */
    function treeOf(entry: Omit<TreeEntry, 'did'>): { rootHex: string; proof: SMTProof } {
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: DID, ...entry }]);
      tree.finalize();
      return { rootHex: hashToHex(tree.rootHash), proof: tree.proof(DID) };
    }

    it('returns update when SMT proof and signed update are in sidecar', () => {
      const update = fakeUpdate('smt-happy');
      const { rootHex, proof } = treeOf({ nonce: randomBytes(32), updateId: canonicalHashBytes(update) });

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, proof);
      sidecar.updateMap.set(bytesToHex(canonicalHashBytes(update)), update);

      const result = beacon.processSignals([fakeSignal(rootHex)], sidecar);

      expect(result.updates).to.have.length(1);
      expect(result.updates[0]![0]).to.deep.equal(update);
      expect(result.needs).to.be.empty;
    });

    it('returns the update for a no-nonce proof (updateId only)', () => {
      const update = fakeUpdate('smt-no-nonce');
      const { rootHex, proof } = treeOf({ updateId: canonicalHashBytes(update) });
      expect(proof.nonce).to.be.undefined;

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, proof);
      sidecar.updateMap.set(bytesToHex(canonicalHashBytes(update)), update);

      const result = beacon.processSignals([fakeSignal(rootHex)], sidecar);

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

    it('skips a nonce non-update proof (nonce, no updateId)', () => {
      const { rootHex, proof } = treeOf({ nonce: randomBytes(32) });
      expect(proof.updateId).to.be.undefined;

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, proof);

      const result = beacon.processSignals([fakeSignal(rootHex)], sidecar);

      // The signal announces no update for this DID: no updates, no needs.
      expect(result.updates).to.be.empty;
      expect(result.needs).to.be.empty;
    });

    it('skips an empty-index proof (no nonce, no updateId) without a need', () => {
      // The tree holds another DID only: the proof of DID is the proof of an empty index.
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: 'did:btcr2:k1qother', nonce: randomBytes(32), updateId: randomBytes(32) }]);
      tree.finalize();
      const rootHex = hashToHex(tree.rootHash);
      const proof = tree.proof(DID);
      expect(proof.nonce).to.be.undefined;
      expect(proof.updateId).to.be.undefined;

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, proof);

      const result = beacon.processSignals([fakeSignal(rootHex)], sidecar);

      expect(result.updates).to.be.empty;
      expect(result.needs).to.be.empty;
    });

    it('throws INVALID_SIGNAL_DATA when the id of the proof is not the signal root', () => {
      const update = fakeUpdate('smt-wrong-root');
      const { proof } = treeOf({ nonce: randomBytes(32), updateId: canonicalHashBytes(update) });
      const otherRoot = '11'.repeat(32);

      // A caller-built map that files the proof under another root.
      const sidecar = emptySidecar();
      sidecar.smtMap.set(otherRoot, proof);

      const thrown = thrownBy(() => beacon.processSignals([fakeSignal(otherRoot)], sidecar));
      expect(thrown).to.be.instanceOf(SMTBeaconError);
      expect(thrown.type).to.equal(INVALID_SIGNAL_DATA);
      expect(thrown.message).to.match(/id does not equal the signal root/);
      expect(thrown.data.smtRootHash).to.equal(otherRoot);
    });

    it('emits NeedSMTProof for a proof in a caller-built map whose id has non-zero pad bits', () => {
      const update = fakeUpdate('smt-pad-bits');
      const { rootHex, proof } = treeOf({ nonce: randomBytes(32), updateId: canonicalHashBytes(update) });

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, { ...proof, id: padBit(proof.id) });
      sidecar.updateMap.set(bytesToHex(canonicalHashBytes(update)), update);

      const result = beacon.processSignals([fakeSignal(rootHex)], sidecar);

      expect(result.updates).to.be.empty;
      expect(result.needs).to.deep.equal([{ kind: 'NeedSMTProof', smtRootHash: rootHex, beaconServiceId: service.id }]);
    });

    it('emits NeedSMTProof for a proof in a caller-built map whose id has "=" padding and non-zero pad bits', () => {
      const { rootHex, proof } = treeOf({ nonce: randomBytes(32) });

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, { ...proof, id: `${padBit(proof.id)}=` });

      const result = beacon.processSignals([fakeSignal(rootHex)], sidecar);

      expect(result.updates).to.be.empty;
      expect(result.needs).to.deep.equal([{ kind: 'NeedSMTProof', smtRootHash: rootHex, beaconServiceId: service.id }]);
    });

    it('throws INVALID_SIGNAL_DATA for a proof whose updateId has non-zero pad bits', () => {
      // ADR 146: the decoders stay strict, so a pad-bit updateId fails SMT Proof Verification.
      const update = fakeUpdate('smt-pad-bit-update-id');
      const { rootHex, proof } = treeOf({ nonce: randomBytes(32), updateId: canonicalHashBytes(update) });

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, { ...proof, updateId: padBit(proof.updateId!) });
      sidecar.updateMap.set(bytesToHex(canonicalHashBytes(update)), update);

      const thrown = thrownBy(() => beacon.processSignals([fakeSignal(rootHex)], sidecar));
      expect(thrown).to.be.instanceOf(SMTBeaconError);
      expect(thrown.type).to.equal(INVALID_SIGNAL_DATA);
      expect(thrown.message).to.match(/verification failed/);
    });

    it('throws INVALID_SIGNAL_DATA for a proof in a caller-built map whose id has "=" padding and zero pad bits', () => {
      const { rootHex, proof } = treeOf({ nonce: randomBytes(32) });

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, { ...proof, id: `${proof.id}=` });

      const thrown = thrownBy(() => beacon.processSignals([fakeSignal(rootHex)], sidecar));
      expect(thrown).to.be.instanceOf(SMTBeaconError);
      expect(thrown.type).to.equal(INVALID_SIGNAL_DATA);
      expect(thrown.message).to.match(/id does not equal the signal root/);
    });

    it('throws INVALID_SIGNAL_DATA for a proof that does not verify', () => {
      // Build a valid tree and proof, then tamper with the nonce of the proof.
      const update = fakeUpdate('smt-tampered');
      const { rootHex, proof } = treeOf({ nonce: randomBytes(32), updateId: canonicalHashBytes(update) });

      // Tamper: replace the nonce with a valid-but-wrong (all-zero) base64url
      // value, so decoding succeeds but the proof no longer walks to the root.
      const tampered: SMTProof = { ...proof, nonce: 'A'.repeat(43) };

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, tampered);

      const thrown = thrownBy(() => beacon.processSignals([fakeSignal(rootHex)], sidecar));
      expect(thrown).to.be.instanceOf(SMTBeaconError);
      expect(thrown.type).to.equal(INVALID_SIGNAL_DATA);
      expect(thrown.message).to.match(/verification failed/);
      expect(thrown.data.did).to.equal(DID);
    });

    it('throws INVALID_SIGNAL_DATA, not RangeError, for a proof whose updateId is not 32 bytes', () => {
      const update = fakeUpdate('smt-short-update-id');
      const { rootHex, proof } = treeOf({ nonce: randomBytes(32), updateId: canonicalHashBytes(update) });
      const short: SMTProof = { ...proof, updateId: encode(randomBytes(31), 'base64urlnopad') };

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, short);

      const thrown = thrownBy(() => beacon.processSignals([fakeSignal(rootHex)], sidecar));
      expect(thrown).to.not.be.instanceOf(RangeError);
      expect(thrown).to.be.instanceOf(SMTBeaconError);
      expect(thrown.type).to.equal(INVALID_SIGNAL_DATA);
    });

    it('emits NeedSignedUpdate when proof is valid but update is missing', () => {
      const update = fakeUpdate('smt-update-missing');
      const { rootHex, proof } = treeOf({ nonce: randomBytes(32), updateId: canonicalHashBytes(update) });

      const sidecar = emptySidecar();
      sidecar.smtMap.set(rootHex, proof);
      // updateMap intentionally empty

      const result = beacon.processSignals([fakeSignal(rootHex)], sidecar);

      expect(result.updates).to.be.empty;
      expect(result.needs).to.have.length(1);
      expect(result.needs[0]!.kind).to.equal('NeedSignedUpdate');
      // updateHash emitted is the hex canonical hash of the update (updateMap is
      // hex-keyed; proof.updateId is the same hash encoded as base64url).
      expect((result.needs[0] as { updateHash: string }).updateHash).to.equal(bytesToHex(canonicalHashBytes(update)));
    });
  });
});

describe('BeaconFactory.establish', () => {
  const base = `${DID}#beacon-1`;
  const endpoint = 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

  it('returns the typed subclass for each beacon type, all extending SinglePartyBeacon', () => {
    const cases: Array<[BeaconService['type'], new (s: BeaconService, d: string) => SinglePartyBeacon]> = [
      ['SingletonBeacon', SingletonBeacon],
      ['CASBeacon', CASBeacon],
      ['SMTBeacon', SMTBeacon],
    ];
    for(const [type, ctor] of cases) {
      const beacon = BeaconFactory.establish({ id: base, type, serviceEndpoint: endpoint }, DID);
      expect(beacon instanceof ctor, `${type} instance`).to.equal(true);
      expect(beacon instanceof SinglePartyBeacon, `${type} extends SinglePartyBeacon`).to.equal(true);
      expect(beacon.service.type).to.equal(type);
    }
  });

  it('throws on an unknown beacon type', () => {
    const service = { id: base, type: 'BogusBeacon', serviceEndpoint: endpoint } as unknown as BeaconService;
    expect(() => BeaconFactory.establish(service, DID)).to.throw('Invalid Beacon Type');
  });
});

describe('BeaconUtils.getBeaconServices (ADR 148)', () => {
  // The service member of a DID document is optional. A document without it has no beacon.
  const beacon: BeaconService = {
    id              : `${DID}#beacon-1`,
    type            : 'SingletonBeacon',
    serviceEndpoint : 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  };

  it('gives the beacon services of a document and no other service', () => {
    const other = { id: `${DID}#web`, type: 'LinkedDomains', serviceEndpoint: 'https://example.com' };
    const document = new DidDocument({ id: DID, '@context': [...BTCR2_DID_DOCUMENT_CONTEXT], service: [beacon, other as BeaconService] });
    expect(BeaconUtils.getBeaconServices(document)).to.deep.equal([beacon]);
  });

  it('gives the ids of the beacon services and of no other service', () => {
    const other = { id: `${DID}#web`, type: 'LinkedDomains', serviceEndpoint: 'https://example.com' };
    const document = new DidDocument({ id: DID, '@context': [...BTCR2_DID_DOCUMENT_CONTEXT], service: [beacon, other as BeaconService] });
    expect(BeaconUtils.getBeaconServiceIds(document)).to.deep.equal([`${DID}#beacon-1`]);
  });

  it('gives no beacon service for a document without service', () => {
    const document = new DidDocument({ id: DID, '@context': [...BTCR2_DID_DOCUMENT_CONTEXT] });
    expect(document).to.not.have.own.property('service');
    expect(BeaconUtils.getBeaconServices(document)).to.deep.equal([]);
  });

  it('gives no beacon service for a document whose service is a string', () => {
    const document = { id: DID, '@context': [...BTCR2_DID_DOCUMENT_CONTEXT], service: 'x' } as unknown as DidDocument;
    expect(BeaconUtils.getBeaconServices(document)).to.deep.equal([]);
  });
});

describe('BeaconUtils.parseBitcoinAddress and isBeaconService (BIP321)', () => {
  // The addresses come from one fixed key. The parse does not check the network, so the
  // mainnet and the regtest forms are both Bitcoin addresses.
  const secret = new Uint8Array(32);
  secret[31] = 7;
  const publicKey = secp256k1.getPublicKey(secret, true);
  const mainnet = getNetwork('bitcoin');
  const regtest = getNetwork('regtest');
  const WPKH = p2wpkh(publicKey, mainnet).address!;
  const TR = p2tr(publicKey.slice(1), undefined, mainnet).address!;
  const PKH = p2pkh(publicKey, mainnet).address!;
  const SH = p2sh(p2wpkh(publicKey, mainnet), mainnet).address!;
  const PKH_REGTEST = p2pkh(publicKey, regtest).address!;
  const SH_REGTEST = p2sh(p2wpkh(publicKey, regtest), regtest).address!;
  const MIXED_CASE = `${WPKH.slice(0, 10).toUpperCase()}${WPKH.slice(10)}`;
  const BASE58CHECK = base58check(sha256);
  const SCHEME_ERROR = 'Invalid Bitcoin URI: the scheme is not bitcoin:';
  const ADDRESS_ERROR = 'Invalid Bitcoin URI: the address part is not a Bitcoin address';
  const REQ_ERROR = 'Invalid Bitcoin URI: a query key starts with req-';

  /** The same text with a different last character: a bech32 string with a bad checksum. */
  function badChecksum(text: string): string {
    return text.slice(0, -1) + (text.endsWith('q') ? 'p' : 'q');
  }

  /** A bech32 or bech32m string of a witness version and a program of `length` bytes. */
  function segwit(codec: typeof bech32, version: number, length: number): string {
    return codec.encode('bc', [version, ...codec.toWords(new Uint8Array(length).fill(1))]);
  }

  // [title, uri, address]
  const accepted: Array<[string, string, string]> = [
    ['the scheme bitcoin:', `bitcoin:${WPKH}`, WPKH],
    ['the scheme BITCOIN:', `BITCOIN:${WPKH}`, WPKH],
    ['the scheme Bitcoin:', `Bitcoin:${WPKH}`, WPKH],
    ['the scheme bItCoIn:', `bItCoIn:${WPKH}`, WPKH],
    ['a label query', `bitcoin:${WPKH}?label=x`, WPKH],
    ['an amount query', `bitcoin:${WPKH}?amount=1`, WPKH],
    ['two query keys', `bitcoin:${WPKH}?label=x&amount=1`, WPKH],
    ['a query key in upper case', `bitcoin:${WPKH}?LABEL=x`, WPKH],
    ['a bech32 address in upper case, in lower case', `bitcoin:${WPKH.toUpperCase()}`, WPKH],
    ['a bech32m (P2TR) address in upper case, in lower case', `bitcoin:${TR.toUpperCase()}`, TR],
    ['a base58 P2PKH address under BITCOIN:, as given', `BITCOIN:${PKH}`, PKH],
    ['a base58 P2SH address', `bitcoin:${SH}`, SH],
    ['a regtest base58 P2PKH address', `bitcoin:${PKH_REGTEST}`, PKH_REGTEST],
    ['a regtest base58 P2SH address', `bitcoin:${SH_REGTEST}`, SH_REGTEST],
    ['a bech32m version 1 address with a 2-byte program', `bitcoin:${segwit(bech32m, 1, 2)}`, segwit(bech32m, 1, 2)],
  ];

  for(const [title, uri, address] of accepted) {
    it(`gives the address of a URI with ${title}`, () => {
      expect(BeaconUtils.parseBitcoinAddress(uri)).to.equal(address);
    });
  }

  // [title, uri, message]
  const refused: Array<[string, unknown, string]> = [
    ['a req-pop query key', `bitcoin:${WPKH}?req-pop=x`, REQ_ERROR],
    ['a REQ- query key', `bitcoin:${WPKH}?REQ-x=1`, REQ_ERROR],
    ['a req- query key after a label', `bitcoin:${WPKH}?label=x&req-pop=x`, REQ_ERROR],
    ['an empty address part', 'bitcoin:?lightning=lnbc1', ADDRESS_ERROR],
    ['a fragment after the address', `bitcoin:${WPKH}#frag`, ADDRESS_ERROR],
    ['two slashes before the address', `bitcoin://${WPKH}`, ADDRESS_ERROR],
    ['an encoded question mark after the address', `bitcoin:${WPKH}%3F`, ADDRESS_ERROR],
    ['the text abc', 'bitcoin:abc', ADDRESS_ERROR],
    ['a bech32 address with a bad checksum', `bitcoin:${badChecksum(WPKH)}`, ADDRESS_ERROR],
    ['a bech32 address in mixed case', `bitcoin:${MIXED_CASE}`, ADDRESS_ERROR],
    ['a base58 address in upper case', `bitcoin:${PKH.toUpperCase()}`, ADDRESS_ERROR],
    ['a WIF key (base58check with a 33-byte payload)', `bitcoin:${BASE58CHECK.encode(new Uint8Array([0x80, ...secret]))}`, ADDRESS_ERROR],
    // The version byte 0x00 is the P2PKH version, so only the length check refuses this text.
    ['a 33-byte base58check text with the version 0x00', `bitcoin:${BASE58CHECK.encode(new Uint8Array([0x00, ...publicKey.slice(1)]))}`, ADDRESS_ERROR],
    ['a 21-byte base58check text with the version 0x30', `bitcoin:${BASE58CHECK.encode(new Uint8Array([0x30, ...new Uint8Array(20).fill(1)]))}`, ADDRESS_ERROR],
    ['a bech32 string of version 1', `bitcoin:${segwit(bech32, 1, 32)}`, ADDRESS_ERROR],
    ['a bech32m string of version 0', `bitcoin:${segwit(bech32m, 0, 20)}`, ADDRESS_ERROR],
    ['a bech32 version 0 string with a 21-byte program', `bitcoin:${segwit(bech32, 0, 21)}`, ADDRESS_ERROR],
    ['no scheme', WPKH, SCHEME_ERROR],
    ['an input that is not a string', 42, SCHEME_ERROR],
  ];

  for(const [title, uri, message] of refused) {
    it(`refuses a URI with ${title}`, () => {
      const thrown = thrownBy(() => BeaconUtils.parseBitcoinAddress(uri as string));
      expect(thrown).to.be.instanceOf(MethodError);
      expect(thrown.type).to.equal('BEACON_SERVICE_ERROR');
      expect(thrown.message).to.equal(message);
    });
  }

  it('the bech32 library gives the prefix of an address in upper case in lower case', () => {
    // The parse depends on this behavior of @scure/base. If the library changes it, this test fails.
    expect(bech32.decode(WPKH.toUpperCase() as `${string}1${string}`, 90).prefix).to.equal('bc');
    expect(bech32m.decode(TR.toUpperCase() as `${string}1${string}`, 90).prefix).to.equal('bc');
    expect(bech32.decodeUnsafe(MIXED_CASE, 90)).to.equal(undefined);
  });

  it('isBeaconService is true for each beacon type with a good endpoint', () => {
    for(const type of ['SingletonBeacon', 'CASBeacon', 'SMTBeacon'] as const) {
      expect(BeaconUtils.isBeaconService({ id: `${DID}#beacon-0`, type, serviceEndpoint: `bitcoin:${WPKH}` }), type).to.equal(true);
    }
    expect(BeaconUtils.isBeaconService({ id: `${DID}#beacon-0`, type: 'SingletonBeacon', serviceEndpoint: `BITCOIN:${PKH}` })).to.equal(true);
  });

  it('isBeaconService is false for a LinkedDomains service with a good bitcoin: endpoint', () => {
    const service = { id: `${DID}#web`, type: 'LinkedDomains', serviceEndpoint: `bitcoin:${WPKH}` } as unknown as BeaconService;
    expect(BeaconUtils.isBeaconService(service)).to.equal(false);
  });

  it('isBeaconService is false for a SingletonBeacon whose endpoint has no address', () => {
    const service: BeaconService = { id: `${DID}#beacon-0`, type: 'SingletonBeacon', serviceEndpoint: 'bitcoin:?lightning=x' };
    expect(BeaconUtils.isBeaconService(service)).to.equal(false);
  });

  it('getBeaconServices gives the good beacon and not the beacon without an address', () => {
    const good: BeaconService = { id: `${DID}#beacon-0`, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${WPKH}` };
    const bad: BeaconService = { id: `${DID}#beacon-1`, type: 'SingletonBeacon', serviceEndpoint: 'bitcoin:?lightning=x' };
    const document = { id: DID, '@context': [...BTCR2_DID_DOCUMENT_CONTEXT], service: [bad, good] } as unknown as DidDocument;
    expect(BeaconUtils.getBeaconServices(document)).to.deep.equal([good]);
  });
});

describe('CAS announcement hash chain (regression)', () => {
  // Pins the two encoding transitions that link an on-chain CAS signal to a signed
  // update (see the CASBeacon class docs). If canonicalHash's default encoding
  // (base64urlnopad) or the on-chain hex encoding ever drifts, resolution would
  // silently fail to find the update; these assertions make that break loud.
  const service: BeaconService = {
    id              : `${DID}#beacon-1`,
    type            : 'CASBeacon',
    serviceEndpoint : 'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  };
  const beacon = new CASBeacon(service, DID);

  it('signal hop: on-chain signalBytes (hex) equals the casMap key canonicalHash(announcement, hex)', () => {
    const update = fakeUpdate('cas-chain-signal');
    // The announcement is built exactly as broadcastSignal builds it.
    const announcement: CASAnnouncement = { [DID]: canonicalHash(update) };

    // Broadcast writes hash(canonicalize(announcement)) as the OP_RETURN payload, hex on-chain.
    const onChainSignalHex = bytesToHex(hash(canonicalize(announcement)));
    // The resolver keys casMap by canonicalHash(announcement, { encoding: 'hex' }).
    const casMapKey = canonicalHash(announcement, { encoding: 'hex' });

    expect(casMapKey).to.equal(onChainSignalHex);
  });

  it('update hop: decoded announcement value (hex) equals the updateMap key canonicalHash(update, hex)', () => {
    const update = fakeUpdate('cas-chain-update');

    // The announcement stores the update hash as base64urlnopad (canonicalHash default).
    const announcementValueB64 = canonicalHash(update);
    // The resolver decodes that value to hex to key updateMap.
    const decodedToHex = encode(decode(announcementValueB64, 'base64urlnopad'), 'hex');
    const updateMapKey = canonicalHash(update, { encoding: 'hex' });

    expect(decodedToHex).to.equal(updateMapKey);
  });

  it('end-to-end: a broadcast-shaped announcement resolves to the update with no needs', () => {
    const update = fakeUpdate('cas-chain-e2e');

    // Mirror broadcastSignal: announcement value is base64urlnopad, signal is the hex announcement hash.
    const announcement: CASAnnouncement = { [DID]: canonicalHash(update) };
    const announcementHashHex = bytesToHex(hash(canonicalize(announcement)));

    // Mirror Resolver.sidecarData: both maps keyed by canonicalHash hex.
    const sidecar = emptySidecar();
    sidecar.casMap.set(canonicalHash(announcement, { encoding: 'hex' }), announcement);
    sidecar.updateMap.set(canonicalHash(update, { encoding: 'hex' }), update);

    const result = beacon.processSignals([fakeSignal(announcementHashHex)], sidecar);

    expect(result.updates).to.have.length(1);
    expect(result.updates[0]![0]).to.deep.equal(update);
    expect(result.needs).to.be.empty;
  });
});
