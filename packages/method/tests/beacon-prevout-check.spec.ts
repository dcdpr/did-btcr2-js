import { getNetwork } from '@did-btcr2/bitcoin';
import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Address, OutScript, p2tr, p2wpkh, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';
import type { SingletonScriptKind } from '../src/core/beacon/beacon.js';
import { buildAggregationBeaconTx, deriveSingletonAddress } from '../src/core/beacon/beacon.js';
import { BeaconError } from '../src/core/beacon/error.js';
import type { BeaconService } from '../src/core/beacon/interfaces.js';
import { SingletonBeacon } from '../src/core/beacon/singleton-beacon.js';
import type { SignedBTCR2Update } from '../src/core/btcr2-update.js';

const network = getNetwork('regtest');
const DID = 'did:btcr2:k1q5ptvjpcgt0jfgvddau2fllfcpxwa5qtw2umkafp5xqwqr72a7xanvcjf324y';
const KINDS: Array<SingletonScriptKind> = [ 'p2pkh', 'p2wpkh', 'p2tr' ];
const TXID = 'f'.repeat(64);

const update = { patch: [], targetVersionId: 2 } as unknown as SignedBTCR2Update;

/** A raw transaction with one output that pays `amount` to `script`, and its txid. */
function prevTxPaying(script: Uint8Array, amount: bigint, index = 0): { txid: string; hex: string } {
  const prevTx = new Transaction({ allowUnknownOutputs: true });
  prevTx.addOutput({ amount, script });
  prevTx.addInput({ txid: new Uint8Array(32), index, finalScriptSig: new Uint8Array([0x00]) });
  return { txid: prevTx.id, hex: bytesToHex(prevTx.toBytes(true)) };
}

/** A confirmed UTXO of the REST listing. */
function listed(txid: string, value: number, vout = 0): AddressUtxo {
  return { txid, vout, value, status: { confirmed: true, block_height: 100 } as never };
}

/**
 * Minimal BitcoinConnection: the address listing is `utxos`, and `getHex`
 * returns the entry of `hexById`. `transaction.send` records the raw hex in `sent`.
 */
function stubBitcoin(utxos: Array<AddressUtxo>, hexById: Map<string, string>, sent: Array<string>): BitcoinConnection {
  return {
    data : network,
    rest : {
      address     : { getUtxos: async () => utxos },
      transaction : {
        getHex : async (txid: string) => hexById.get(txid)!,
        send   : async (hex: string) => { sent.push(hex); return TXID; },
      },
    },
  } as unknown as BitcoinConnection;
}

/** A fresh signer, the singleton beacon of `kind` that it controls, and the beacon script. */
function beaconOf(kind: SingletonScriptKind): {
  signer: LocalSigner; address: string; script: Uint8Array; beacon: SingletonBeacon;
} {
  const signer = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);
  const address = deriveSingletonAddress(kind, signer.publicKey, network);
  const script = OutScript.encode(Address(network).decode(address));
  const service: BeaconService = { id: `${DID}#beacon-0`, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${address}` };
  return { signer, address, script, beacon: new SingletonBeacon(service, DID) };
}

/** The error of `promise`, or `undefined` if it resolves. */
async function errorOf(promise: Promise<unknown>): Promise<BeaconError | undefined> {
  return promise.then(() => undefined, (e: unknown) => e as BeaconError);
}

/** Expect a `PREVOUT_MISMATCH` error for `utxo` with `reason`. */
function expectMismatch(err: BeaconError | undefined, address: string, utxo: AddressUtxo, reason: string): void {
  expect(err).to.be.instanceOf(BeaconError);
  expect(err!.type).to.equal('PREVOUT_MISMATCH');
  expect(err!.data).to.deep.equal({ address, txid: utxo.txid, vout: utxo.vout, reason });
  expect(err!.message).to.equal(
    `UTXO ${utxo.txid}:${utxo.vout} of beacon address ${address} does not agree with its previous transaction: ${reason}.`
  );
}

describe('beacon UTXO check against the previous transaction (ADR 143)', () => {
  for(const kind of KINDS) {
    it(`${kind}: refuses a listing value below the output value, and nothing is broadcast`, async () => {
      const { signer, address, script, beacon } = beaconOf(kind);
      const prev = prevTxPaying(script, 1_000_000n);
      const utxo = listed(prev.txid, 20_000);
      const sent: Array<string> = [];
      const bitcoin = stubBitcoin([ utxo ], new Map([[ prev.txid, prev.hex ]]), sent);

      const err = await errorOf(beacon.broadcastSignal(update, signer, bitcoin));

      expectMismatch(err, address, utxo, 'the output value is 1000000 sats, not 20000 sats');
      expect(sent).to.have.length(0);
    });
  }

  it('refuses a listing value above the output value', async () => {
    const { signer, address, script, beacon } = beaconOf('p2pkh');
    const prev = prevTxPaying(script, 20_000n);
    const utxo = listed(prev.txid, 1_000_000);
    const sent: Array<string> = [];
    const bitcoin = stubBitcoin([ utxo ], new Map([[ prev.txid, prev.hex ]]), sent);

    const err = await errorOf(beacon.broadcastSignal(update, signer, bitcoin));

    expectMismatch(err, address, utxo, 'the output value is 20000 sats, not 1000000 sats');
    expect(sent).to.have.length(0);
  });

  it('refuses a previous transaction that does not hash to the txid', async () => {
    const { signer, address, script, beacon } = beaconOf('p2pkh');
    const prev = prevTxPaying(script, 100_000n);
    const other = prevTxPaying(script, 100_000n, 1);
    const utxo = listed(prev.txid, 100_000);
    const sent: Array<string> = [];
    const bitcoin = stubBitcoin([ utxo ], new Map([[ prev.txid, other.hex ]]), sent);

    const err = await errorOf(beacon.broadcastSignal(update, signer, bitcoin));

    expectMismatch(err, address, utxo, `the previous transaction hashes to ${other.txid}`);
    expect(sent).to.have.length(0);
  });

  it('refuses an output index past the last output of the previous transaction', async () => {
    const { signer, address, script, beacon } = beaconOf('p2pkh');
    const prev = prevTxPaying(script, 100_000n);
    const utxo = listed(prev.txid, 100_000, 1);
    const sent: Array<string> = [];
    const bitcoin = stubBitcoin([ utxo ], new Map([[ prev.txid, prev.hex ]]), sent);

    const err = await errorOf(beacon.broadcastSignal(update, signer, bitcoin));

    expectMismatch(err, address, utxo, 'the previous transaction has no output at index 1');
    expect(sent).to.have.length(0);
  });

  it('refuses an output that pays a different script', async () => {
    const { signer, address, beacon } = beaconOf('p2pkh');
    const otherScript = p2wpkh(SchnorrKeyPair.generate().publicKey.compressed, network).script;
    const prev = prevTxPaying(otherScript, 100_000n);
    const utxo = listed(prev.txid, 100_000);
    const sent: Array<string> = [];
    const bitcoin = stubBitcoin([ utxo ], new Map([[ prev.txid, prev.hex ]]), sent);

    const err = await errorOf(beacon.broadcastSignal(update, signer, bitcoin));

    expectMismatch(err, address, utxo, 'the output pays a different script');
    expect(sent).to.have.length(0);
  });

  it('refuses a previous transaction that does not decode', async () => {
    const { signer, address, beacon } = beaconOf('p2pkh');
    const utxo = listed('a'.repeat(64), 100_000);
    const sent: Array<string> = [];
    const bitcoin = stubBitcoin([ utxo ], new Map([[ utxo.txid, '0100' ]]), sent);

    const err = await errorOf(beacon.broadcastSignal(update, signer, bitcoin));

    expectMismatch(err, address, utxo, 'the previous transaction does not decode');
    expect(sent).to.have.length(0);
  });

  it('accepts a previous transaction in the witness serialization', async () => {
    // A REST endpoint returns a segwit transaction with its witness. The txid excludes the witness.
    const { signer, script, beacon } = beaconOf('p2wpkh');
    const funder = SchnorrKeyPair.generate();
    const funderScript = p2wpkh(funder.publicKey.compressed, network).script;
    const prevTx = new Transaction();
    prevTx.addInput({ txid: new Uint8Array(32).fill(7), index: 0, witnessUtxo: { amount: 200_000n, script: funderScript } });
    prevTx.addOutput({ amount: 100_000n, script });
    prevTx.sign(funder.secretKey.bytes);
    prevTx.finalize();
    expect(prevTx.hasWitnesses).to.equal(true);
    const utxo = listed(prevTx.id, 100_000);
    const sent: Array<string> = [];
    const bitcoin = stubBitcoin([ utxo ], new Map([[ prevTx.id, prevTx.hex ]]), sent);

    const result = await beacon.broadcastSignal(update, signer, bitcoin);

    expect(result.txid).to.equal(TXID);
    expect(sent).to.have.length(1);
  });

  it('buildAggregationBeaconTx refuses a listing value below the output value', async () => {
    const internalPubkey = SchnorrKeyPair.generate().publicKey.x;
    const beaconAddress = p2tr(internalPubkey, undefined, network).address!;
    const script = OutScript.encode(Address(network).decode(beaconAddress));
    const prev = prevTxPaying(script, 1_000_000n);
    const utxo = listed(prev.txid, 20_000);
    const bitcoin = stubBitcoin([ utxo ], new Map([[ prev.txid, prev.hex ]]), []);

    const err = await errorOf(buildAggregationBeaconTx({
      beaconAddress, internalPubkey, signalBytes : new Uint8Array(32), bitcoin, network,
    }));

    expectMismatch(err, beaconAddress, utxo, 'the output value is 1000000 sats, not 20000 sats');
  });
});
