import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { getNetwork } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalHashBytes, encode, hash, INVALID_DID_UPDATE, UpdateError } from '@did-btcr2/common';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import type { Btcr2DidDocument, NeedBeaconSignals } from '@did-btcr2/method';
import { DidBtcr2, ID_PLACEHOLDER_VALUE } from '@did-btcr2/method';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Address, OutScript, p2wpkh, Transaction } from '@scure/btc-signer';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import type { BitcoinApi, CasExecutor, DidUpdateResult } from '../src/index.js';
import { CasApi, createApi, DidMethodApi, MultikeyApi } from '../src/index.js';

use(chaiAsPromised);

const network = getNetwork('regtest');
const TXID = 'e'.repeat(64);

/**
 * In-memory {@link CasExecutor} that records publish order. Each publish is
 * labeled `cas:update` or `cas:announcement` by inspecting the canonical JSON
 * (signed updates carry a `targetHash`; announcements are flat DID-to-hash maps).
 */
class MemCasExecutor implements CasExecutor {
  readonly store = new Map<string, Uint8Array>();
  readonly canPublish?: boolean;
  readonly #order?: string[];

  constructor(order?: string[], canPublish?: boolean) {
    this.#order = order;
    this.canPublish = canPublish;
  }

  async retrieve(hashKey: string): Promise<Uint8Array | null> {
    return this.store.get(hashKey) ?? null;
  }

  async publish(data: Uint8Array): Promise<string> {
    const text = new TextDecoder().decode(data);
    this.#order?.push(text.includes('"targetHash"') ? 'cas:update' : 'cas:announcement');
    const hashKey = encode(hash(text), 'base64urlnopad');
    this.store.set(hashKey, data);
    return hashKey;
  }
}

/** Writable executor whose publish rejects on the given 1-indexed call. */
class FlakyCasExecutor extends MemCasExecutor {
  #failOnCall: number;
  #calls = 0;

  constructor(order: string[], failOnCall: number) {
    super(order);
    this.#failOnCall = failOnCall;
  }

  override async publish(data: Uint8Array): Promise<string> {
    this.#calls += 1;
    if (this.#calls === this.#failOnCall) throw new Error('cas publish unavailable');
    return super.publish(data);
  }
}

/**
 * Minimal BitcoinConnection that funds `beaconAddress` with one confirmed UTXO
 * and records broadcasts into `order` / UTXO lookups into `counters`. `utxosAt`
 * replaces the UTXO list of an address. It receives the confirmed UTXO and the
 * address. A test can return the UTXO altered, with others, not at all, or at
 * one address only.
 */
function mockBitcoin(
  beaconAddress: string,
  order: string[],
  counters: { utxoCalls: number; sent: string[] },
  utxosAt: (funded: AddressUtxo, address: string) => AddressUtxo[] = funded => [funded],
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
      address     : { getUtxos: async (address: string) => { counters.utxoCalls += 1; return utxosAt(utxo, address); } },
      transaction : {
        getHex : async () => bytesToHex(prevTxBytes),
        send   : async (hex: string) => { counters.sent.push(hex); order.push('tx-broadcast'); return TXID; },
      },
    },
  } as unknown as BitcoinConnection;
}

/**
 * Resolve a deterministic DID to its genesis document (sans-I/O, empty signals)
 * and swap its services for a single beacon of `beaconType` at the address the
 * signer's key can spend. Returns everything an update() call needs.
 */
function updateFixture(beaconType: 'SingletonBeacon' | 'CASBeacon' | 'SMTBeacon'): {
  did: string;
  sourceDocument: Btcr2DidDocument;
  verificationMethodId: string;
  beaconId: string;
  signer: LocalSigner;
  beaconAddress: string;
} {
  const kp = SchnorrKeyPair.generate();
  const signer = new LocalSigner(kp.secretKey.bytes);
  const did = DidBtcr2.create(kp.publicKey.compressed, { idType: 'KEY', network: 'regtest' });

  const resolver = DidBtcr2.resolve(did);
  const state = resolver.resolve();
  if(state.status !== 'action-required') throw new Error('expected action-required');
  resolver.provide(state.needs[0] as NeedBeaconSignals, new Map());
  const final = resolver.resolve();
  if(final.status !== 'resolved') throw new Error('expected resolved');

  const beaconAddress = p2wpkh(signer.publicKey, network).address!;
  const beaconId = `${did}#beacon-test`;
  const sourceDocument = JSON.parse(JSON.stringify(final.result.didDocument)) as Btcr2DidDocument;
  sourceDocument.service = [{
    id              : beaconId,
    type            : beaconType,
    serviceEndpoint : `bitcoin:${beaconAddress}`,
  }];

  return {
    did,
    sourceDocument,
    verificationMethodId : `${did}#initialKey`,
    beaconId,
    signer,
    beaconAddress,
  };
}

/** Common update() args for a fixture, wired to fresh recorders. */
function updateArgs(
  fixture: ReturnType<typeof updateFixture>,
  order: string[],
  counters: { utxoCalls: number; sent: string[] },
  utxosAt?: (funded: AddressUtxo, address: string) => AddressUtxo[],
) {
  return {
    sourceDocument       : fixture.sourceDocument,
    patches              : [],
    sourceVersionId      : 1,
    verificationMethodId : fixture.verificationMethodId,
    beaconId             : fixture.beaconId,
    signer               : fixture.signer,
    bitcoin              : mockBitcoin(fixture.beaconAddress, order, counters, utxosAt),
  };
}

describe('DidMethodApi update() CAS publication policy', () => {

  function recorders(): { order: string[]; counters: { utxoCalls: number; sent: string[] } } {
    return { order: [], counters: { utxoCalls: 0, sent: [] } };
  }

  describe('CAS beacon', () => {
    it('auto + writable CAS: publishes update then announcement, then broadcasts', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'auto',
      });

      expect(order).to.deep.equal(['cas:update', 'cas:announcement', 'tx-broadcast']);
      expect(result.txid).to.equal(TXID);
      expect(result.publishedToCas).to.deep.equal({ update: true, announcement: true });
      expect(result.announcement).to.deep.equal({ [fixture.did]: canonicalHash(result.signedUpdate) });
      // Both artifacts are retrievable at their canonical hashes.
      expect(executor.store.has(canonicalHash(result.signedUpdate))).to.equal(true);
      expect(executor.store.has(canonicalHash(result.announcement!))).to.equal(true);
    });

    it('default (omitted) + writable CAS: publishes nothing (publication is opt-in)', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      // No publishToCas passed -> the default 'never'. Even a CAS beacon with a
      // writable CAS configured must publish nothing: CAS publication is opt-in
      // and never required, and the update completes sidecar-only.
      const result = await methodApi.update(updateArgs(fixture, order, counters));

      expect(order).to.deep.equal(['tx-broadcast']);
      expect(executor.store.size, 'nothing may reach the CAS by default').to.equal(0);
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
      expect(result.announcement).to.deep.equal({ [fixture.did]: canonicalHash(result.signedUpdate) });
    });

    it('auto + read-only CAS: skips publication silently and returns the announcement', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new MemCasExecutor(order, false) })
      );

      // 'auto' is best-effort and never blocks: with no writable CAS it skips
      // publication for CAS beacons too, and hands back the announcement.
      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'auto',
      });

      expect(order).to.deep.equal(['tx-broadcast']);
      expect(counters.utxoCalls, 'the update proceeds to funding/broadcast rather than aborting up-front').to.be.greaterThan(0);
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
      expect(result.announcement).to.deep.equal({ [fixture.did]: canonicalHash(result.signedUpdate) });
    });

    it('auto + no CAS configured: skips publication silently and returns the announcement', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'auto',
      });

      expect(order).to.deep.equal(['tx-broadcast']);
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
      expect(result.announcement).to.deep.equal({ [fixture.did]: canonicalHash(result.signedUpdate) });
    });

    it('always + read-only CAS: throws up-front for a CAS beacon too', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new MemCasExecutor(order, false) })
      );

      // 'always' is the opt-in hard-guarantee mode: it fails up-front for every
      // beacon type (including CAS) when no writable CAS is available.
      await expect(methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'always',
      })).to.be.rejectedWith(/'always'.*read-only/s);
      expect(counters.utxoCalls, 'must fail before the funding phase').to.equal(0);
      expect(order).to.deep.equal([]);
    });

    it('never + read-only CAS: succeeds and returns the announcement for sidecar distribution', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new MemCasExecutor(order, false) })
      );

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'never',
      });

      expect(order).to.deep.equal(['tx-broadcast']);
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
      expect(result.announcement).to.deep.equal({ [fixture.did]: canonicalHash(result.signedUpdate) });
    });

    it('never + WRITABLE CAS: the explicit opt-out publishes nothing', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'never',
      });

      expect(order).to.deep.equal(['tx-broadcast']);
      expect(executor.store.size, 'nothing may reach the CAS under never').to.equal(0);
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
      expect(result.announcement).to.exist;
    });

    it('publish failure on the signed update aborts before any broadcast', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new FlakyCasExecutor(order, 1) })
      );

      await expect(methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'auto',
      })).to.be.rejectedWith(/cas publish unavailable/);
      expect(order, 'no publish label, no tx broadcast').to.deep.equal([]);
      expect(counters.sent, 'the beacon UTXO must not be spent').to.have.length(0);
    });

    it('publish failure on the announcement aborts after the update publish, before the spend', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new FlakyCasExecutor(order, 2) })
      );

      await expect(methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'auto',
      })).to.be.rejectedWith(/cas publish unavailable/);
      // Partial-publish state: the update reached the CAS (harmless, content-
      // addressed), the announcement did not, and no transaction was broadcast.
      expect(order).to.deep.equal(['cas:update']);
      expect(counters.sent).to.have.length(0);
    });
  });

  describe('Singleton beacon', () => {
    it('auto + read-only CAS: skips publication silently', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new MemCasExecutor(order, false) })
      );

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'auto',
      });

      expect(order).to.deep.equal(['tx-broadcast']);
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
      expect(result.txid).to.equal(TXID);
      expect(result.announcement).to.equal(undefined);
      expect(result.proof).to.equal(undefined);
    });

    it('auto + writable CAS: publishes the signed update before broadcasting', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'auto',
      });

      expect(order).to.deep.equal(['cas:update', 'tx-broadcast']);
      expect(result.publishedToCas).to.deep.equal({ update: true, announcement: false });
      expect(executor.store.has(canonicalHash(result.signedUpdate))).to.equal(true);
    });

    it('always + read-only CAS: throws up-front', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new MemCasExecutor(order, false) })
      );

      await expect(methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'always',
      })).to.be.rejectedWith(/'always'.*read-only/s);
      expect(counters.utxoCalls).to.equal(0);
    });

    it('always + writable CAS: actually publishes the update', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'always',
      });

      expect(order).to.deep.equal(['cas:update', 'tx-broadcast']);
      expect(result.publishedToCas).to.deep.equal({ update: true, announcement: false });
      expect(executor.store.has(canonicalHash(result.signedUpdate))).to.equal(true);
    });

    it('default (omitted) + NO CAS configured: the out-of-box path publishes nothing', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      // No publishToCas and no CAS: the out-of-box default 'never' completes the
      // update sidecar-only, publishing nothing.
      const result = await methodApi.update(updateArgs(fixture, order, counters));

      expect(order).to.deep.equal(['tx-broadcast']);
      expect(result.txid).to.equal(TXID);
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
    });
  });

  describe('SMT beacon', () => {
    it('auto + writable CAS: publishes the update and returns the inclusion proof', async () => {
      const fixture = updateFixture('SMTBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas : 'auto',
      });

      expect(order).to.deep.equal(['cas:update', 'tx-broadcast']);
      expect(result.publishedToCas).to.deep.equal({ update: true, announcement: false });
      expect(result.proof, 'the SMT proof must surface through the api').to.exist;
      expect(result.proof!.nonce).to.be.a('string');
      expect(result.proof!.updateId).to.equal(canonicalHash(result.signedUpdate));
    });
  });

  describe('NeedFunding spendability guard', () => {
    const unconfirmed = (funded: AddressUtxo): AddressUtxo[] =>
      [{ ...funded, status: { confirmed: false } as never }];

    it('unconfirmed-only address: refuses before any CAS publication, even under always', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      // The beacon spends only a confirmed UTXO. The guard applies that rule at
      // NeedFunding, so the refusal lands before the signed update or the
      // announcement reaches the CAS, and before the beacon UTXO is spent.
      const err: unknown = await methodApi.update({
        ...updateArgs(fixture, order, counters, unconfirmed),
        publishToCas : 'always',
      }).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('are unconfirmed');
      expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
      expect((err as UpdateError).data).to.deep.equal({ beaconAddress: fixture.beaconAddress, utxos: 1 });
      expect(counters.utxoCalls, 'the guard read the address').to.equal(1);
      expect(order, 'no publish label, no tx broadcast').to.deep.equal([]);
      expect(executor.store.size, 'nothing may reach the CAS').to.equal(0);
      expect(counters.sent).to.have.length(0);
    });

    it('dust-only address: refuses and names the dust limit', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      // 546 sats is the boundary: a UTXO at or below it is not spendable.
      await expect(methodApi.update(
        updateArgs(fixture, order, counters, funded => [{ ...funded, value: 546 }])
      )).to.be.rejectedWith(UpdateError, '546-sat dust limit');
      expect(order).to.deep.equal([]);
      expect(counters.sent).to.have.length(0);
    });

    it('unfunded address: keeps the unfunded message', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      await expect(methodApi.update(
        updateArgs(fixture, order, counters, () => [])
      )).to.be.rejectedWith(UpdateError, 'is unfunded');
      expect(order).to.deep.equal([]);
    });

    it('one confirmed UTXO among unconfirmed ones: proceeds to broadcast', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      // The listing order must not matter: the unconfirmed UTXO comes first.
      const result = await methodApi.update(updateArgs(fixture, order, counters, funded => [
        { ...funded, txid: 'f'.repeat(64), status: { confirmed: false } as never },
        funded,
      ]));

      expect(result.txid).to.equal(TXID);
      expect(order).to.deep.equal(['tx-broadcast']);
    });
  });

  describe('derived verificationMethodId and beaconId', () => {
    /** This helper adds a second Singleton beacon at an address that the fixture's signer cannot spend. */
    function withSecondBeacon(fixture: ReturnType<typeof updateFixture>): { id: string; address: string } {
      const address = p2wpkh(SchnorrKeyPair.generate().publicKey.compressed, network).address!;
      const id = `${fixture.did}#beacon-other`;
      fixture.sourceDocument.service.push({ id, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${address}` });
      return { id, address };
    }

    it('derives the verification method that publishes the signer\'s key', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        verificationMethodId : undefined,
      });

      // The proof names the method that signed the update.
      expect(result.signedUpdate.proof.verificationMethod).to.equal(`${fixture.did}#initialKey`);
      expect(result.txid).to.equal(TXID);
    });

    it('uses the only beacon without a chain read', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        beaconId : undefined,
      });

      expect(result.txid).to.equal(TXID);
      // The funding guard made one read, and the broadcast made one. The
      // derivation made none.
      expect(counters.utxoCalls).to.equal(2);
    });

    it('derives the one beacon among several that holds a spendable UTXO', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const other = withSecondBeacon(fixture);
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      // The other beacon holds an unconfirmed UTXO. It is not spendable, so it
      // is not a candidate.
      const result = await methodApi.update({
        ...updateArgs(fixture, order, counters, (funded, address) => address === other.address
          ? [{ ...funded, status: { confirmed: false } as never }]
          : [funded]),
        verificationMethodId : undefined,
        beaconId             : undefined,
      });

      expect(result.txid).to.equal(TXID);
      expect(order).to.deep.equal(['tx-broadcast']);
      // The derivation made two reads. The funding guard and the broadcast
      // made one each.
      expect(counters.utxoCalls).to.equal(4);
    });

    it('refuses if no beacon holds a spendable UTXO, and names every address', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const other = withSecondBeacon(fixture);
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const err: unknown = await methodApi.update({
        ...updateArgs(fixture, order, counters, () => []),
        beaconId : undefined,
      }).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('cannot derive beaconId');
      expect((err as UpdateError).message).to.include(`${fixture.beaconId} (${fixture.beaconAddress})`);
      expect((err as UpdateError).message).to.include(`${other.id} (${other.address})`);
      expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
      expect((err as UpdateError).data).to.deep.equal({
        did     : fixture.did,
        beacons : [
          { id: fixture.beaconId, type: 'SingletonBeacon', address: fixture.beaconAddress },
          { id: other.id, type: 'SingletonBeacon', address: other.address },
        ],
      });
      expect(order).to.deep.equal([]);
      expect(counters.sent).to.have.length(0);
    });

    it('refuses if several beacons hold a spendable UTXO', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const other = withSecondBeacon(fixture);
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      // The default UTXO list holds the confirmed UTXO at every address.
      const err: unknown = await methodApi.update({
        ...updateArgs(fixture, order, counters),
        beaconId : undefined,
      }).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('Pass beaconId to choose which one spends');
      expect((err as UpdateError).data).to.deep.equal({ did: fixture.did, funded: [fixture.beaconId, other.id] });
      expect(order).to.deep.equal([]);
      expect(counters.sent).to.have.length(0);
    });

    it('refuses a document with no beacon service', async () => {
      const fixture = updateFixture('SingletonBeacon');
      fixture.sourceDocument.service = [];
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      await expect(methodApi.update({
        ...updateArgs(fixture, order, counters),
        beaconId : undefined,
      })).to.be.rejectedWith(UpdateError, 'has no beacon service');
      expect(counters.utxoCalls).to.equal(0);
    });
  });

  describe('broadcastOptions passthrough', () => {
    it('forwards a custom fee estimator to the beacon transaction', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const feeCalls: number[] = [];
      const methodApi = new DidMethodApi();

      await methodApi.update({
        ...updateArgs(fixture, order, counters),
        publishToCas     : 'never',
        broadcastOptions : { feeEstimator: { estimateFee: async (vsize: number) => { feeCalls.push(vsize); return 1000n; } } },
      });

      expect(feeCalls.length, 'the custom estimator must be consulted').to.be.greaterThan(0);
    });
  });

  describe('UpdateBuilder passthrough', () => {
    it('chains publishToCas and broadcastOptions into update()', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new MemCasExecutor(order, false) })
      );

      const result = await methodApi.buildUpdate(fixture.sourceDocument)
        .version(1)
        .verificationMethodId(fixture.verificationMethodId)
        .beacon(fixture.beaconId)
        .signer(fixture.signer)
        .bitcoin(mockBitcoin(fixture.beaconAddress, order, counters))
        .publishToCas('never')
        .broadcastOptions({})
        .execute();

      expect(result.txid).to.equal(TXID);
      expect(result.announcement).to.exist;
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
    });
  });

  describe('DidBtcr2Api.updateDid passthrough', () => {
    it('forwards publishToCas and broadcastOptions to the method facade', async () => {
      const api = createApi();
      const captured: { params?: any } = {};
      const canned: DidUpdateResult = {
        signedUpdate   : {} as DidUpdateResult['signedUpdate'],
        txid           : TXID,
        publishedToCas : { update: false, announcement: false },
      };
      // Shadow the lazy btcr2 getter with a capturing stub so the forwarding
      // is observable without real signing or Bitcoin I/O.
      Object.defineProperty(api, 'btcr2', {
        value : { update: async (params: unknown) => { captured.params = params; return canned; } },
      });

      const feeEstimator = { estimateFee: async () => 1000n };
      const result = await api.updateDid({
        did                  : 'did:btcr2:k1qtest',
        patches              : [],
        verificationMethodId : '#k',
        beaconId             : '#b',
        signer               : {} as never,
        sourceDocument       : { id: 'did:btcr2:k1qtest' } as never,
        sourceVersionId      : 1,
        publishToCas         : 'never',
        broadcastOptions     : { feeEstimator },
      });

      expect(captured.params.publishToCas).to.equal('never');
      expect(captured.params.broadcastOptions.feeEstimator).to.equal(feeEstimator);
      expect(result).to.equal(canned);
    });
  });
});

describe('DidMethodApi resolve() SMT proof handling', () => {
  it('fails fast with a sidecar pointer instead of spinning on NeedSMTProof', async () => {
    // Mint an x1 DID whose genesis document carries an SMT beacon, then surface
    // one on-chain signal for it with no proof in the sidecar.
    const kp = SchnorrKeyPair.generate();
    const mkApi = new MultikeyApi();
    const mk = mkApi.create('#key-0', ID_PLACEHOLDER_VALUE, kp);
    const vm = mkApi.toVerificationMethod(mk);
    const beaconAddress = p2wpkh(new LocalSigner(kp.secretKey.bytes).publicKey, network).address!;
    const genesisDocument = {
      'id'                   : ID_PLACEHOLDER_VALUE,
      '@context'             : ['https://www.w3.org/ns/did/v1.1', 'https://btcr2.dev/context/v1'],
      'verificationMethod'   : [{ ...vm, id: `${ID_PLACEHOLDER_VALUE}#key-0`, controller: ID_PLACEHOLDER_VALUE }],
      'authentication'       : [`${ID_PLACEHOLDER_VALUE}#key-0`],
      'assertionMethod'      : [`${ID_PLACEHOLDER_VALUE}#key-0`],
      'capabilityInvocation' : [`${ID_PLACEHOLDER_VALUE}#key-0`],
      'capabilityDelegation' : [`${ID_PLACEHOLDER_VALUE}#key-0`],
      'service'              : [{
        id              : `${ID_PLACEHOLDER_VALUE}#smt-beacon`,
        type            : 'SMTBeacon',
        serviceEndpoint : `bitcoin:${beaconAddress}`,
      }],
    };

    const methodApi = new DidMethodApi();
    const did = methodApi.createExternal(canonicalHashBytes(genesisDocument), { network: 'regtest' });

    const smtRootHex = 'ab'.repeat(32);
    // A signal is a transaction that spends from the beacon address, so the input side
    // has to look like one: discovery ignores transactions that merely pay the beacon.
    const signalTx = {
      vin    : [{
        txid        : 'f'.repeat(64),
        vout        : 0,
        prevout     : { scriptpubkey_address: beaconAddress },
        is_coinbase : false,
      }],
      // Discovery decodes the serialized script, which Esplora returns alongside the asm
      // rendering; the asm is here only to document what those bytes mean.
      vout   : [{
        scriptpubkey     : `6a20${smtRootHex}`,
        scriptpubkey_asm : `OP_RETURN OP_PUSHBYTES_32 ${smtRootHex}`,
      }],
      status : { block_height: 100, block_time: 1700000000 },
    };
    const btcMock = {
      connection : {
        data : network,
        rest : {
          block   : { count: async () => 105 },
          address : { getTxs: async () => [signalTx] },
        },
      } as unknown as BitcoinConnection,
    } as unknown as BitcoinApi;

    const withSignals = new DidMethodApi(btcMock);
    try {
      await withSignals.resolve(did, { sidecar: { genesisDocument } });
      expect.fail('resolution should have failed on the missing SMT proof');
    } catch (err: any) {
      expect(err.message).to.include('Failed to resolve DID');
      expect(String(err.cause?.message)).to.match(/SMT proof required/);
      expect(String(err.cause?.message)).to.match(/sidecar\.smtProofs/);
    }
  });
});
