import { getNetwork } from '@did-btcr2/bitcoin';
import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { canonicalHash, decode, encode } from '@did-btcr2/common';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Address, OutScript, p2wpkh, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';
import type { SignedBTCR2Update } from '../src/core/btcr2-update.js';
import { opReturnScript } from '../src/core/beacon/beacon.js';
import { CASBeacon } from '../src/core/beacon/cas-beacon.js';
import type { BeaconService, BeaconSignal, BlockMetadata } from '../src/core/beacon/interfaces.js';
import { SingletonBeacon } from '../src/core/beacon/singleton-beacon.js';
import { SMTBeacon } from '../src/core/beacon/smt-beacon.js';
import type { SMTProof } from '../src/core/interfaces.js';
import type { CASAnnouncement, SidecarData } from '../src/core/types.js';
import { Updater } from '../src/core/updater.js';

const network = getNetwork('regtest');
const DID = 'did:btcr2:k1q5ptvjpcgt0jfgvddau2fllfcpxwa5qtw2umkafp5xqwqr72a7xanvcjf324y';
const TXID = 'f'.repeat(64);

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

/**
 * Minimal BitcoinConnection that funds `beaconAddress` with a single confirmed
 * UTXO and records broadcasts. Builds a real prev tx whose output 0 pays the
 * beacon address so scure's nonWitnessUtxo hash check passes. Each call to
 * `transaction.send` appends the raw hex to `sent` and the label
 * `'tx-broadcast'` to `order` (shared with CAS-publish recorders).
 */
function mockBitcoin(
  beaconAddress: string,
  sent: string[],
  order: string[],
): BitcoinConnection {
  const beaconScript = OutScript.encode(Address(network).decode(beaconAddress));
  const prevTx = new Transaction({ allowUnknownOutputs: true });
  prevTx.addOutput({ amount: 100_000n, script: beaconScript });
  prevTx.addInput({ txid: new Uint8Array(32), index: 0xffffffff, finalScriptSig: new Uint8Array([0x00]) });
  const prevTxBytes = prevTx.toBytes();
  const utxo: AddressUtxo = { txid: prevTx.id, vout: 0, value: 100_000, status: { confirmed: true, block_height: 100 } as never };
  return {
    data : network,
    rest : {
      address     : { getUtxos: async () => [utxo] },
      transaction : {
        getHex : async () => bytesToHex(prevTxBytes),
        send   : async (hex: string) => { sent.push(hex); order.push('tx-broadcast'); return TXID; },
      },
    },
  } as unknown as BitcoinConnection;
}

/** Helper: the OP_RETURN script (hex) of the last output of a sent raw tx. */
function lastOutputScriptHex(rawHex: string): string {
  const tx = Transaction.fromRaw(hexToBytes(rawHex), { allowUnknownOutputs: true, allowUnknownInputs: true });
  return bytesToHex(tx.getOutput(tx.outputsLength - 1).script!);
}

/** Fresh signer + the P2WPKH beacon service it can spend, per beacon type. */
function testBeaconSetup(type: 'SingletonBeacon' | 'CASBeacon' | 'SMTBeacon'): {
  signer: LocalSigner;
  service: BeaconService;
} {
  const signer = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);
  const address = p2wpkh(signer.publicKey, network).address!;
  return {
    signer,
    service : { id: `${DID}#beacon-0`, type, serviceEndpoint: `bitcoin:${address}` },
  };
}

describe('SinglePartyBeacon.broadcastSignal result shape', () => {

  describe('SingletonBeacon', () => {
    it('returns the signed update and the broadcast txid, with the update hash in OP_RETURN', async () => {
      const { signer, service } = testBeaconSetup('SingletonBeacon');
      const sent: string[] = [];
      const bitcoin = mockBitcoin(service.serviceEndpoint.replace('bitcoin:', ''), sent, []);
      const update = fakeUpdate('singleton-result');

      const result = await new SingletonBeacon(service).broadcastSignal(update, signer, bitcoin);

      expect(result.signedUpdate).to.equal(update);
      expect(result.txid).to.equal(TXID);
      expect(result.announcement).to.equal(undefined);
      expect(result.proof).to.equal(undefined);
      expect(sent).to.have.length(1);
      const expectedSignal = decode(canonicalHash(update), 'base64urlnopad');
      expect(lastOutputScriptHex(sent[0]!)).to.equal(bytesToHex(opReturnScript(expectedSignal)));
    });
  });

  describe('CASBeacon', () => {
    it('returns the announcement mapping the DID to the update hash, plus the txid', async () => {
      const { signer, service } = testBeaconSetup('CASBeacon');
      const sent: string[] = [];
      const bitcoin = mockBitcoin(service.serviceEndpoint.replace('bitcoin:', ''), sent, []);
      const update = fakeUpdate('cas-result');

      const result = await new CASBeacon(service).broadcastSignal(update, signer, bitcoin);

      expect(result.signedUpdate).to.equal(update);
      expect(result.txid).to.equal(TXID);
      expect(result.announcement).to.deep.equal({ [DID]: canonicalHash(update) });
      // OP_RETURN carries the canonical hash of the announcement, not the update.
      const expectedSignal = decode(canonicalHash(result.announcement!), 'base64urlnopad');
      expect(lastOutputScriptHex(sent[0]!)).to.equal(bytesToHex(opReturnScript(expectedSignal)));
    });

    it('invokes casPublish before the transaction broadcast', async () => {
      const { signer, service } = testBeaconSetup('CASBeacon');
      const order: string[] = [];
      const bitcoin = mockBitcoin(service.serviceEndpoint.replace('bitcoin:', ''), [], order);
      let published: CASAnnouncement | undefined;

      await new CASBeacon(service).broadcastSignal(fakeUpdate('cas-order'), signer, bitcoin, {
        casPublish : async (announcement) => { order.push('cas-publish'); published = announcement; },
      });

      expect(order).to.deep.equal(['cas-publish', 'tx-broadcast']);
      expect(published).to.deep.equal({ [DID]: canonicalHash(fakeUpdate('cas-order')) });
    });

    it('aborts pre-spend when casPublish fails: no transaction is broadcast', async () => {
      const { signer, service } = testBeaconSetup('CASBeacon');
      const sent: string[] = [];
      const bitcoin = mockBitcoin(service.serviceEndpoint.replace('bitcoin:', ''), sent, []);

      let threw = false;
      try {
        await new CASBeacon(service).broadcastSignal(fakeUpdate('cas-fail'), signer, bitcoin, {
          casPublish : async () => { throw new Error('cas unavailable'); },
        });
      } catch(err) {
        threw = true;
        expect((err as Error).message).to.equal('cas unavailable');
      }
      expect(threw, 'expected the casPublish failure to propagate').to.equal(true);
      expect(sent, 'the beacon UTXO must not be spent after a publish failure').to.have.length(0);
    });

    it('round-trips: broadcast artifacts fed back as sidecar resolve the update with no needs', async () => {
      const { signer, service } = testBeaconSetup('CASBeacon');
      const beacon = new CASBeacon(service);
      const bitcoin = mockBitcoin(service.serviceEndpoint.replace('bitcoin:', ''), [], []);
      const update = fakeUpdate('cas-roundtrip');

      const result = await beacon.broadcastSignal(update, signer, bitcoin);

      const sidecar = emptySidecar();
      const announcementHashHex = canonicalHash(result.announcement!, { encoding: 'hex' });
      sidecar.casMap.set(announcementHashHex, result.announcement!);
      sidecar.updateMap.set(canonicalHash(update, { encoding: 'hex' }), update);

      const { updates, needs } = beacon.processSignals([fakeSignal(announcementHashHex)], sidecar);
      expect(needs).to.have.length(0);
      expect(updates).to.have.length(1);
      expect(updates[0]![0]).to.equal(update);
    });
  });

  describe('SMTBeacon', () => {
    it('returns the inclusion proof (nonce embedded) that the on-chain root verifies against', async () => {
      const { signer, service } = testBeaconSetup('SMTBeacon');
      const sent: string[] = [];
      const bitcoin = mockBitcoin(service.serviceEndpoint.replace('bitcoin:', ''), sent, []);
      const update = fakeUpdate('smt-result');

      const result = await new SMTBeacon(service).broadcastSignal(update, signer, bitcoin);

      expect(result.signedUpdate).to.equal(update);
      expect(result.txid).to.equal(TXID);
      expect(result.proof, 'the proof must be returned: its nonce exists nowhere else').to.exist;
      expect(result.proof!.nonce).to.be.a('string');
      expect(result.proof!.updateId).to.equal(canonicalHash(update));
      // OP_RETURN carries the tree root the proof commits to.
      const rootBytes = decode(result.proof!.id, 'base64urlnopad');
      expect(lastOutputScriptHex(sent[0]!)).to.equal(bytesToHex(opReturnScript(rootBytes)));
    });

    it('round-trips: the returned proof makes the on-chain signal resolvable', async () => {
      const { signer, service } = testBeaconSetup('SMTBeacon');
      const beacon = new SMTBeacon(service);
      const bitcoin = mockBitcoin(service.serviceEndpoint.replace('bitcoin:', ''), [], []);
      const update = fakeUpdate('smt-roundtrip');

      const result = await beacon.broadcastSignal(update, signer, bitcoin);

      const sidecar = emptySidecar();
      const rootHex = encode(decode(result.proof!.id, 'base64urlnopad'), 'hex');
      sidecar.smtMap.set(rootHex, result.proof!);
      sidecar.updateMap.set(canonicalHash(update, { encoding: 'hex' }), update);

      const { updates, needs } = beacon.processSignals([fakeSignal(rootHex)], sidecar);
      expect(needs).to.have.length(0);
      expect(updates).to.have.length(1);
      expect(updates[0]![0]).to.equal(update);
    });
  });

  describe('Updater.announce', () => {
    it('forwards broadcast options to the beacon and returns the BroadcastResult', async () => {
      const { signer, service } = testBeaconSetup('CASBeacon');
      const order: string[] = [];
      const bitcoin = mockBitcoin(service.serviceEndpoint.replace('bitcoin:', ''), [], order);
      const update = fakeUpdate('announce-options');

      const result = await Updater.announce(service, update, signer, bitcoin, {
        casPublish : async () => { order.push('cas-publish'); },
      });

      expect(order).to.deep.equal(['cas-publish', 'tx-broadcast']);
      expect(result.txid).to.equal(TXID);
      expect(result.announcement).to.deep.equal({ [DID]: canonicalHash(update) });
    });
  });
});
