import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalHashBytes, canonicalize, encode, hash, INVALID_DID_UPDATE, MISSING_UPDATE_DATA, UpdateError } from '@did-btcr2/common';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { BeaconError, ID_PLACEHOLDER_VALUE } from '@did-btcr2/method';
import { hexToBytes } from '@noble/hashes/utils.js';
import { p2wpkh, Transaction } from '@scure/btc-signer';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import type { AnnounceOptions, BitcoinApi, CasExecutor, DidUpdateResult } from '../src/index.js';
import { CasApi, createApi, DidMethodApi, MultikeyApi } from '../src/index.js';
import { network, recorders, smallUtxos, TXID, updateArgs, updateFixture } from './support/update-fixtures.js';

use(chaiAsPromised);

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

describe('DidMethodApi update() CAS publication policy', () => {

  describe('CAS beacon', () => {
    it('auto + writable CAS: publishes update then announcement, then broadcasts', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'auto' } }));

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
      const result = await methodApi.update(...updateArgs(fixture, order, counters));

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
      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'auto' } }));

      expect(order).to.deep.equal(['tx-broadcast']);
      expect(counters.utxoCalls, 'the update proceeds to funding/broadcast rather than aborting up-front').to.be.greaterThan(0);
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
      expect(result.announcement).to.deep.equal({ [fixture.did]: canonicalHash(result.signedUpdate) });
    });

    it('auto + no CAS configured: skips publication silently and returns the announcement', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'auto' } }));

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
      await expect(methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'always' } }))).to.be.rejectedWith(/'always'.*read-only/s);
      expect(counters.utxoCalls, 'must fail before the funding phase').to.equal(0);
      expect(order).to.deep.equal([]);
    });

    it('never + read-only CAS: succeeds and returns the announcement for sidecar distribution', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new MemCasExecutor(order, false) })
      );

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'never' } }));

      expect(order).to.deep.equal(['tx-broadcast']);
      expect(result.publishedToCas).to.deep.equal({ update: false, announcement: false });
      expect(result.announcement).to.deep.equal({ [fixture.did]: canonicalHash(result.signedUpdate) });
    });

    it('never + WRITABLE CAS: the explicit opt-out publishes nothing', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'never' } }));

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

      await expect(methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'auto' } }))).to.be.rejectedWith(/cas publish unavailable/);
      expect(order, 'no publish label, no tx broadcast').to.deep.equal([]);
      expect(counters.sent, 'the beacon UTXO must not be spent').to.have.length(0);
    });

    it('publish failure on the announcement aborts after the update publish, before the spend', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new FlakyCasExecutor(order, 2) })
      );

      await expect(methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'auto' } }))).to.be.rejectedWith(/cas publish unavailable/);
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

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'auto' } }));

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

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'auto' } }));

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

      await expect(methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'always' } }))).to.be.rejectedWith(/'always'.*read-only/s);
      expect(counters.utxoCalls).to.equal(0);
    });

    it('always + writable CAS: actually publishes the update', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'always' } }));

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
      const result = await methodApi.update(...updateArgs(fixture, order, counters));

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

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'auto' } }));

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
      const err: unknown = await methodApi.update(
        ...updateArgs(fixture, order, counters, { utxosAt: unconfirmed, announce: { publishToCas: 'always' } })
      ).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('cannot fund this update: 1 UTXO, none confirmed.');
      expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
      expect((err as UpdateError).data).to.deep.equal({
        beaconAddress : fixture.beaconAddress,
        utxos         : 1,
        reason        : '1 UTXO, none confirmed',
      });
      expect(counters.utxoCalls, 'the guard read the address').to.equal(1);
      expect(order, 'no publish label, no tx broadcast').to.deep.equal([]);
      expect(executor.store.size, 'nothing may reach the CAS').to.equal(0);
      expect(counters.sent).to.have.length(0);
    });

    it('a UTXO at or below the fee of its own input: refuses and names that fee', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      // At the default 5 sat/vB, a P2WPKH input (69 vB) costs 345 sats. A UTXO
      // of 345 sats adds no value, so the rule does not select it.
      await expect(methodApi.update(
        ...updateArgs(fixture, order, counters, { utxosAt: funded => [{ ...funded, value: 345 }] })
      )).to.be.rejectedWith(
        UpdateError, 'cannot fund this update: 1 confirmed UTXO, each at or below the fee of its own input (345 sats).'
      );
      expect(order).to.deep.equal([]);
      expect(counters.sent).to.have.length(0);
    });

    it('two UTXOs of 500 sats at the default fee rate: refuses with the value, fee, and size', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const executor = new MemCasExecutor(order);
      const methodApi = new DidMethodApi(undefined, new CasApi({ executor }));

      // Each UTXO is eligible (500 > 345 sats), but 2 inputs make 224 vB. At
      // 5 sat/vB the fee is 1120 sats, more than the total value.
      const err: unknown = await methodApi.update(
        ...updateArgs(fixture, order, counters, { utxosAt: smallUtxos, announce: { publishToCas: 'always' } })
      ).catch((e: unknown) => e);

      const reason = '2 spendable UTXOs, total value 1000 sats, fee 1120 sats (224 vB)';
      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include(
        `Beacon address ${fixture.beaconAddress} cannot fund this update: ${reason}.`
      );
      expect((err as UpdateError).message).to.include('set a lower `announce.feeRate`');
      expect((err as UpdateError).data).to.deep.equal({ beaconAddress: fixture.beaconAddress, utxos: 2, reason });
      expect(order, 'the refusal comes before any CAS publication').to.deep.equal([]);
      expect(counters.sent).to.have.length(0);
    });

    it('two UTXOs of 500 sats at announce.feeRate 1: spends both in one signal', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const result = await methodApi.update(
        ...updateArgs(fixture, order, counters, { utxosAt: smallUtxos, announce: { feeRate: 1 } })
      );

      expect(result.txid).to.equal(TXID);
      const tx = Transaction.fromRaw(hexToBytes(counters.sent[0]!), { allowUnknownOutputs: true });
      expect(tx.inputsLength).to.equal(2);
      // 224 vB at 1 sat/vB: the fee is 224 sats, and the change is 776 sats.
      expect(tx.getOutput(0).amount).to.equal(776n);
    });

    it('unfunded address: keeps the unfunded message', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      await expect(methodApi.update(
        ...updateArgs(fixture, order, counters, { utxosAt: () => [] })
      )).to.be.rejectedWith(UpdateError, 'is unfunded');
      expect(order).to.deep.equal([]);
    });

    it('one confirmed UTXO among unconfirmed ones: proceeds to broadcast', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      // The listing order must not matter: the unconfirmed UTXO comes first.
      const result = await methodApi.update(...updateArgs(fixture, order, counters, {
        utxosAt : funded => [
          { ...funded, txid: 'f'.repeat(64), status: { confirmed: false } as never },
          funded,
        ],
      }));

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

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { verificationMethodId: undefined }));

      // The proof names the method that signed the update.
      expect(result.signedUpdate.proof.verificationMethod).to.equal(`${fixture.did}#initialKey`);
      expect(result.txid).to.equal(TXID);
    });

    it('uses the only beacon without a chain read', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const result = await methodApi.update(...updateArgs(fixture, order, counters, { announce: { beaconId: undefined } }));

      expect(result.txid).to.equal(TXID);
      // The funding guard made one read, and the broadcast made one. The
      // derivation made none.
      expect(counters.utxoCalls).to.equal(2);
    });

    it('derives the one beacon among several whose address can fund the signal', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const other = withSecondBeacon(fixture);
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      // The other beacon holds an unconfirmed UTXO. It is not spendable, so it
      // is not a candidate.
      const result = await methodApi.update(...updateArgs(fixture, order, counters, {
        utxosAt              : (funded, address) => address === other.address
          ? [{ ...funded, status: { confirmed: false } as never }]
          : [funded],
        verificationMethodId : undefined,
        announce             : { beaconId: undefined },
      }));

      expect(result.txid).to.equal(TXID);
      expect(order).to.deep.equal(['tx-broadcast']);
      // The derivation made two reads. The funding guard and the broadcast
      // made one each.
      expect(counters.utxoCalls).to.equal(4);
    });

    it('refuses if no beacon can fund the signal, and gives the reason for each beacon', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const other = withSecondBeacon(fixture);
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const err: unknown = await methodApi.update(
        ...updateArgs(fixture, order, counters, { utxosAt: () => [], announce: { beaconId: undefined } })
      ).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include('cannot derive beaconId');
      expect((err as UpdateError).message).to.include(
        `#beacon-test (${fixture.beaconAddress}): no UTXOs; #beacon-other (${other.address}): no UTXOs.`
      );
      expect((err as UpdateError).type).to.equal(INVALID_DID_UPDATE);
      expect((err as UpdateError).data).to.deep.equal({
        did     : fixture.did,
        beacons : [
          { id: fixture.beaconId, type: 'SingletonBeacon', address: fixture.beaconAddress, reason: 'no UTXOs' },
          { id: other.id, type: 'SingletonBeacon', address: other.address, reason: 'no UTXOs' },
        ],
      });
      expect(order).to.deep.equal([]);
      expect(counters.sent).to.have.length(0);
    });

    it('refuses two UTXOs of 500 sats at the default fee rate, and gives the fee reason', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const other = withSecondBeacon(fixture);
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const err: unknown = await methodApi.update(...updateArgs(fixture, order, counters, {
        utxosAt  : (funded, address) => address === fixture.beaconAddress ? smallUtxos(funded) : [],
        announce : { beaconId: undefined },
      })).catch((e: unknown) => e);

      const reason = '2 spendable UTXOs, total value 1000 sats, fee 1120 sats (224 vB)';
      expect(err).to.be.instanceOf(UpdateError);
      expect((err as UpdateError).message).to.include(
        `#beacon-test (${fixture.beaconAddress}): ${reason}; #beacon-other (${other.address}): no UTXOs.`
      );
      expect((err as UpdateError).data!.beacons[0]).to.deep.equal(
        { id: fixture.beaconId, type: 'SingletonBeacon', address: fixture.beaconAddress, reason }
      );
      expect(counters.sent).to.have.length(0);
    });

    it('derives the beacon with two UTXOs of 500 sats at announce.feeRate 1', async () => {
      const fixture = updateFixture('SingletonBeacon');
      withSecondBeacon(fixture);
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const result = await methodApi.update(...updateArgs(fixture, order, counters, {
        utxosAt  : (funded, address) => address === fixture.beaconAddress ? smallUtxos(funded) : [],
        announce : { beaconId: undefined, feeRate: 1 },
      }));

      expect(result.txid).to.equal(TXID);
      const tx = Transaction.fromRaw(hexToBytes(counters.sent[0]!), { allowUnknownOutputs: true });
      expect(tx.inputsLength).to.equal(2);
    });

    it('throws an invalid change address again, not as the reason of a beacon', async () => {
      const fixture = updateFixture('SingletonBeacon');
      withSecondBeacon(fixture);
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      const err: unknown = await methodApi.update(...updateArgs(fixture, order, counters, {
        announce : { beaconId: undefined, changeAddress: 'not-an-address' },
      })).catch((e: unknown) => e);

      expect(err).to.be.instanceOf(BeaconError);
      expect((err as BeaconError).type).to.equal('INVALID_CHANGE_ADDRESS');
      expect(counters.sent).to.have.length(0);
    });

    it('refuses if several beacons can fund the signal', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const other = withSecondBeacon(fixture);
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      // The default UTXO list holds the confirmed UTXO at every address.
      const err: unknown = await methodApi.update(
        ...updateArgs(fixture, order, counters, { announce: { beaconId: undefined } })
      ).catch((e: unknown) => e);

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

      await expect(methodApi.update(...updateArgs(fixture, order, counters, { announce: { beaconId: undefined } }))).to.be.rejectedWith(UpdateError, 'has no beacon service');
      expect(counters.utxoCalls).to.equal(0);
    });
  });

  describe('broadcastOptions passthrough', () => {
    it('forwards a custom fee estimator to the beacon transaction', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const feeCalls: number[] = [];
      const methodApi = new DidMethodApi();

      await methodApi.update(...updateArgs(fixture, order, counters, {
        announce : {
          publishToCas : 'never',
          feeEstimator : { estimateFee: async (vsize: number) => { feeCalls.push(vsize); return 1000n; } },
        },
      }));

      expect(feeCalls.length, 'the custom estimator must be consulted').to.be.greaterThan(0);
    });

    it('announce.feeRate gives the same fee as an estimator with that fixed rate', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const methodApi = new DidMethodApi();
      const fee = async (announce: AnnounceOptions): Promise<bigint> => {
        const { order, counters } = recorders();
        await methodApi.update(...updateArgs(fixture, order, counters, { announce: { publishToCas: 'never', ...announce } }));
        const tx = Transaction.fromRaw(hexToBytes(counters.sent[0]), { allowUnknownOutputs: true });
        let spent = 0n;
        for (let i = 0; i < tx.outputsLength; i++) spent += tx.getOutput(i).amount ?? 0n;
        return 100_000n - spent;
      };

      const byRate = await fee({ feeRate: 7 });
      const byEstimator = await fee({ feeEstimator: { estimateFee: async (vsize: number) => BigInt(Math.ceil(vsize * 7)) } });
      expect(byRate > 0n, 'the fee must be positive').to.equal(true);
      expect(byRate).to.equal(byEstimator);
    });

    it('refuses announce.feeRate together with announce.feeEstimator, before any read', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const feeEstimator = { estimateFee: async () => 1000n };
      await expect(new DidMethodApi().update(...updateArgs(fixture, order, counters, { announce: { feeRate: 5, feeEstimator } })))
        .to.be.rejectedWith(UpdateError, 'not both');
      expect(counters.utxoCalls).to.equal(0);
    });

    for (const feeRate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5' as unknown as number]) {
      it(`refuses announce.feeRate ${String(feeRate)}`, async () => {
        const fixture = updateFixture('SingletonBeacon');
        const { order, counters } = recorders();
        await expect(new DidMethodApi().update(...updateArgs(fixture, order, counters, { announce: { feeRate } })))
          .to.be.rejectedWith(UpdateError, 'must be a positive finite number');
        expect(counters.utxoCalls).to.equal(0);
      });
    }
  });

  describe('DidBtcr2Api.updateDid passthrough', () => {
    it('forwards the source, patch, signer, and options to the method facade', async () => {
      const api = createApi();
      const captured: { args?: any[] } = {};
      const canned: DidUpdateResult = {
        signedUpdate   : {} as DidUpdateResult['signedUpdate'],
        txid           : TXID,
        publishedToCas : { update: false, announcement: false },
      };
      // Shadow the lazy btcr2 getter with a capturing stub so the forwarding
      // is observable without real signing or Bitcoin I/O.
      Object.defineProperty(api, 'btcr2', {
        value : { update: async (...args: unknown[]) => { captured.args = args; return canned; } },
      });

      const feeEstimator = { estimateFee: async () => 1000n };
      const source = { document: { id: 'did:btcr2:k1qtest' } as never, versionId: 1 };
      const signer = {} as never;
      const result = await api.updateDid(source, [], signer, {
        verificationMethodId : '#k',
        announce             : { beaconId: '#b', publishToCas: 'never', feeEstimator },
      });

      const [forwardedSource, patch, forwardedSigner, options] = captured.args!;
      expect(forwardedSource).to.equal(source);
      expect(patch).to.deep.equal([]);
      expect(forwardedSigner).to.equal(signer);
      expect(options).to.deep.equal({
        verificationMethodId : '#k',
        announce             : { beaconId: '#b', publishToCas: 'never', feeEstimator },
      });
      expect(result).to.equal(canned);
    });
  });
});

/** Mint an x1 DID whose genesis document carries one beacon of `type`. */
function beaconDid(type: 'SMTBeacon' | 'CASBeacon'): { did: string; genesisDocument: object; beaconAddress: string } {
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
      id              : `${ID_PLACEHOLDER_VALUE}#${type === 'SMTBeacon' ? 'smt' : 'cas'}-beacon`,
      type,
      serviceEndpoint : `bitcoin:${beaconAddress}`,
    }],
  };
  const did = new DidMethodApi().createExternal(canonicalHashBytes(genesisDocument), { network: 'regtest' });
  return { did, genesisDocument, beaconAddress };
}

/** A Bitcoin mock whose beacon address has one signal for each value of `signalBytes`. */
function btcWithSignals(beaconAddress: string, signalBytes: Array<string>): BitcoinApi {
  // A signal is a transaction that spends from the beacon address, so the input side
  // has to look like one: discovery ignores transactions that merely pay the beacon.
  const signalTxs = signalBytes.map(bytes => ({
    vin    : [{
      txid        : 'f'.repeat(64),
      vout        : 0,
      prevout     : { scriptpubkey_address: beaconAddress },
      is_coinbase : false,
    }],
    // Discovery decodes the serialized script, which Esplora returns alongside the asm
    // rendering; the asm is here only to document what those bytes mean.
    vout   : [{
      scriptpubkey     : `6a20${bytes}`,
      scriptpubkey_asm : `OP_RETURN OP_PUSHBYTES_32 ${bytes}`,
    }],
    status : { confirmed: true, block_height: 100, block_hash: 'b'.repeat(64), block_time: 1700000000 },
  }));
  return {
    connection : {
      data : network,
      rest : {
        block   : { count: async () => 105, get: async () => ({ mediantime: 1700000000 }) },
        address : { getConfirmedTxs: async () => signalTxs },
      },
    } as unknown as BitcoinConnection,
  } as unknown as BitcoinApi;
}

/** The same base64url text with a non-zero pad bit (ADR 146). A lenient decoder gets the same bytes. */
function padBit(text: string): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return text.slice(0, -1) + letters[letters.indexOf(text.at(-1)!) | 1];
}

describe('DidMethodApi resolve() SMT proof handling', () => {
  const smtRootHex = 'ab'.repeat(32);

  /** A proof for `rootHex` whose id has a non-zero pad bit. */
  function padBitProof(rootHex: string): Record<string, unknown> {
    return { id: padBit(encode(hexToBytes(rootHex), 'base64urlnopad')), collapsed: 'A'.repeat(43), hashes: [] };
  }

  it('fails at once with a sidecar pointer and does not loop on NeedSMTProof', async () => {
    // The mock gives one beacon signal for the DID. The sidecar holds no proof.
    const { did, genesisDocument, beaconAddress } = beaconDid('SMTBeacon');
    const withSignals = new DidMethodApi(btcWithSignals(beaconAddress, [smtRootHex]));
    try {
      await withSignals.resolve(did, { sidecar: { genesisDocument } });
      expect.fail('resolution did not fail on the missing SMT proof');
    } catch (err: any) {
      expect(err.message).to.include('Failed to resolve DID');
      expect(String(err.cause?.message)).to.match(/SMT proof required/);
      expect(String(err.cause?.message)).to.match(/sidecar\.smtProofs/);
      expect(err.cause?.type).to.equal(MISSING_UPDATE_DATA);
    }
  });

  it('ignores an unused sidecar proof whose id has non-zero pad bits', async () => {
    const { did, genesisDocument, beaconAddress } = beaconDid('SMTBeacon');
    const noSignals = new DidMethodApi(btcWithSignals(beaconAddress, []));
    const result = await noSignals.resolve(did, { sidecar: { genesisDocument, smtProofs: [padBitProof(smtRootHex)] } as any });
    expect(result.didDocumentMetadata.versionId).to.equal('1');
  });

  it('raises MISSING_UPDATE_DATA if the only sidecar proof for a signal has an id with non-zero pad bits', async () => {
    const { did, genesisDocument, beaconAddress } = beaconDid('SMTBeacon');
    const withSignals = new DidMethodApi(btcWithSignals(beaconAddress, [smtRootHex]));
    try {
      await withSignals.resolve(did, { sidecar: { genesisDocument, smtProofs: [padBitProof(smtRootHex)] } as any });
      expect.fail('resolution did not fail on the ignored SMT proof');
    } catch (err: any) {
      expect(String(err.cause?.message)).to.match(/SMT proof required/);
      expect(String(err.cause?.message)).to.match(/ignores a proof whose id does not decode to 32 bytes/);
      expect(err.cause?.type).to.equal(MISSING_UPDATE_DATA);
    }
  });
});

describe('DidMethodApi resolve() CAS announcement values (ADR 146)', () => {
  it('raises MISSING_UPDATE_DATA if the sidecar CAS announcement value for the DID is an empty string', async () => {
    const { did, genesisDocument, beaconAddress } = beaconDid('CASBeacon');
    const announcement = { [did]: '' };
    const methodApi = new DidMethodApi(btcWithSignals(beaconAddress, [canonicalHash(announcement, { encoding: 'hex' })]));
    const err: any = await methodApi.resolve(did, { sidecar: { genesisDocument, casUpdates: [announcement] } as any })
      .then(() => expect.fail('resolution did not fail on the empty CAS announcement value'), (e: unknown) => e);
    expect(err.cause?.type).to.equal(MISSING_UPDATE_DATA);
    expect(err.cause?.data).to.deep.include({ did, value: '' });
  });

  it('raises MISSING_UPDATE_DATA if a CAS-fetched announcement value for the DID has non-zero pad bits', async () => {
    const { did, genesisDocument, beaconAddress } = beaconDid('CASBeacon');
    const value = padBit(canonicalHash({ other: true }));
    const announcement = { [did]: value };
    const bytes = new TextEncoder().encode(canonicalize(announcement));
    const cas = new CasApi({ executor: { retrieve: async () => bytes, publish: async () => '' } });
    const methodApi = new DidMethodApi(btcWithSignals(beaconAddress, [canonicalHash(announcement, { encoding: 'hex' })]), cas);
    const err: any = await methodApi.resolve(did, { sidecar: { genesisDocument } })
      .then(() => expect.fail('resolution did not fail on the pad-bit CAS announcement value'), (e: unknown) => e);
    expect(err.cause?.type).to.equal(MISSING_UPDATE_DATA);
    expect(err.cause?.data).to.deep.include({ did, value });
  });
});
