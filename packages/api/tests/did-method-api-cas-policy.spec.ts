import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { getNetwork } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalHashBytes, encode, hash } from '@did-btcr2/common';
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
 * and records broadcasts into `order` / UTXO lookups into `counters`.
 */
function mockBitcoin(
  beaconAddress: string,
  order: string[],
  counters: { utxoCalls: number; sent: string[] },
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
      address     : { getUtxos: async () => { counters.utxoCalls += 1; return [utxo]; } },
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
function updateArgs(fixture: ReturnType<typeof updateFixture>, order: string[], counters: { utxoCalls: number; sent: string[] }) {
  return {
    sourceDocument       : fixture.sourceDocument,
    patches              : [],
    sourceVersionId      : 1,
    verificationMethodId : fixture.verificationMethodId,
    beaconId             : fixture.beaconId,
    signer               : fixture.signer,
    bitcoin              : mockBitcoin(fixture.beaconAddress, order, counters),
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

      const result = await methodApi.update(updateArgs(fixture, order, counters));

      expect(order).to.deep.equal(['cas:update', 'cas:announcement', 'tx-broadcast']);
      expect(result.txid).to.equal(TXID);
      expect(result.publishedToCas).to.deep.equal({ update: true, announcement: true });
      expect(result.announcement).to.deep.equal({ [fixture.did]: canonicalHash(result.signedUpdate) });
      // Both artifacts are retrievable at their canonical hashes.
      expect(executor.store.has(canonicalHash(result.signedUpdate))).to.equal(true);
      expect(executor.store.has(canonicalHash(result.announcement!))).to.equal(true);
    });

    it('auto + read-only CAS: throws up-front, before any signing or UTXO lookup', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new MemCasExecutor(order, false) })
      );

      await expect(methodApi.update(updateArgs(fixture, order, counters)))
        .to.be.rejectedWith(/read-only.*publishToCas 'never'/s);
      expect(counters.utxoCalls, 'must fail before the funding phase').to.equal(0);
      expect(order).to.deep.equal([]);
    });

    it('auto + no CAS configured: throws up-front', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

      await expect(methodApi.update(updateArgs(fixture, order, counters)))
        .to.be.rejectedWith(/no CAS is configured/);
      expect(counters.utxoCalls).to.equal(0);
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

      await expect(methodApi.update(updateArgs(fixture, order, counters)))
        .to.be.rejectedWith(/cas publish unavailable/);
      expect(order, 'no publish label, no tx broadcast').to.deep.equal([]);
      expect(counters.sent, 'the beacon UTXO must not be spent').to.have.length(0);
    });

    it('publish failure on the announcement aborts after the update publish, before the spend', async () => {
      const fixture = updateFixture('CASBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi(
        undefined, new CasApi({ executor: new FlakyCasExecutor(order, 2) })
      );

      await expect(methodApi.update(updateArgs(fixture, order, counters)))
        .to.be.rejectedWith(/cas publish unavailable/);
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

      const result = await methodApi.update(updateArgs(fixture, order, counters));

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

      const result = await methodApi.update(updateArgs(fixture, order, counters));

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

    it('auto + NO CAS configured: the default out-of-box path skips publication silently', async () => {
      const fixture = updateFixture('SingletonBeacon');
      const { order, counters } = recorders();
      const methodApi = new DidMethodApi();

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

      const result = await methodApi.update(updateArgs(fixture, order, counters));

      expect(order).to.deep.equal(['cas:update', 'tx-broadcast']);
      expect(result.publishedToCas).to.deep.equal({ update: true, announcement: false });
      expect(result.proof, 'the SMT proof must surface through the api').to.exist;
      expect(result.proof!.nonce).to.be.a('string');
      expect(result.proof!.updateId).to.equal(canonicalHash(result.signedUpdate));
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
        sourceDocument       : {} as never,
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
    const signalTx = {
      vout   : [{ scriptpubkey_asm: `OP_RETURN OP_PUSHBYTES_32 ${smtRootHex}` }],
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
