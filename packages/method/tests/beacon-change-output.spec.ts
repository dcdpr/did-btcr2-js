import { getNetwork } from '@did-btcr2/bitcoin';
import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Address, OutScript, p2tr, p2wpkh, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';
import {
  beaconTxVsize,
  buildAggregationBeaconTx,
  CHANGE_OUTPUT_VBYTES,
  opReturnScript,
  resolveChangeAddress,
  SINGLETON_BEACON_TX_VSIZE,
} from '../src/core/beacon/beacon.js';

const network = getNetwork('regtest');
const FEE_RATE = 5; // DEFAULT_FEE_ESTIMATOR is StaticFeeEstimator(5)

/** A throwaway 33-byte-compressed key, used to mint distinct change addresses. */
const freshKey = (): Uint8Array => new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes).publicKey;

/**
 * Minimal BitcoinConnection that funds `beaconAddress` with one confirmed UTXO for
 * each entry of `values` (sats), the first one deepest. Builds a real prev tx for
 * each UTXO whose output 0 pays the beacon address, so scure's nonWitnessUtxo hash
 * check passes when the builder spends it.
 */
function mockBitcoin(beaconAddress: string, ...values: Array<number>): BitcoinConnection {
  const beaconScript = OutScript.encode(Address(network).decode(beaconAddress));
  const hexById = new Map<string, string>();
  const utxos = values.map((value, i): AddressUtxo => {
    const prevTx = new Transaction({ allowUnknownOutputs: true });
    prevTx.addOutput({ amount: BigInt(value), script: beaconScript });
    prevTx.addInput({ txid: new Uint8Array(32), index: i, finalScriptSig: new Uint8Array([0x00]) });
    // toBytes(true) keeps the scriptSig, so the bytes hash to prevTx.id (ADR 143).
    hexById.set(prevTx.id, bytesToHex(prevTx.toBytes(true)));
    return { txid: prevTx.id, vout: 0, value, status: { confirmed: true, block_height: 100 + i } as never };
  });
  return {
    data : network,
    rest : {
      address     : { getUtxos: async () => utxos },
      transaction : { getHex: async (txid: string) => hexById.get(txid)! },
    },
  } as unknown as BitcoinConnection;
}

describe('beacon change output (ADR 044)', () => {
  describe('resolveChangeAddress', () => {
    const beaconAddress = p2tr(SchnorrKeyPair.generate().publicKey.x, undefined, network).address!;

    it('defaults to the beacon address when no change address is supplied', () => {
      expect(resolveChangeAddress(beaconAddress, network)).to.equal(beaconAddress);
      expect(resolveChangeAddress(beaconAddress, network, beaconAddress)).to.equal(beaconAddress);
    });

    it('passes through a valid, distinct change address', () => {
      const change = p2wpkh(freshKey(), network).address!;
      expect(resolveChangeAddress(beaconAddress, network, change)).to.equal(change);
    });

    it('rejects an invalid change address with INVALID_CHANGE_ADDRESS', () => {
      expect(() => resolveChangeAddress(beaconAddress, network, 'not-a-bitcoin-address'))
        .to.throw(/Invalid change address/);
    });
  });

  describe('beaconTxVsize', () => {
    it('reproduces the per-kind singleton constant when change kind equals beacon kind', () => {
      for(const kind of ['p2pkh', 'p2wpkh', 'p2tr'] as const) {
        expect(beaconTxVsize(kind, kind)).to.equal(SINGLETON_BEACON_TX_VSIZE[kind]);
      }
    });

    it('adjusts by the exact change-output size delta for a differing change kind', () => {
      expect(beaconTxVsize('p2tr', 'p2wpkh'))
        .to.equal(SINGLETON_BEACON_TX_VSIZE.p2tr - CHANGE_OUTPUT_VBYTES.p2tr + CHANGE_OUTPUT_VBYTES.p2wpkh);
      // A larger-kind change on a smaller-kind input grows the vsize (P2PKH input, P2TR change).
      expect(beaconTxVsize('p2pkh', 'p2tr')).to.be.greaterThan(SINGLETON_BEACON_TX_VSIZE.p2pkh);
    });
  });

  describe('buildAggregationBeaconTx', () => {
    const internalKey = SchnorrKeyPair.generate().publicKey.x;
    const beaconAddress = p2tr(internalKey, undefined, network).address!;
    const opReturn = bytesToHex(opReturnScript(new Uint8Array(32)));

    it('reuses the beacon address for change by default, with the signal as the last output', async () => {
      const bitcoin = mockBitcoin(beaconAddress, 100_000);
      const plan = await buildAggregationBeaconTx({
        beaconAddress, internalPubkey : internalKey, signalBytes : new Uint8Array(32), bitcoin, network,
      });

      expect(plan.changeAddress).to.equal(beaconAddress);
      expect(plan.tx.outputsLength).to.equal(2);
      expect(plan.tx.getOutputAddress(0, network)).to.equal(beaconAddress);
      expect(bytesToHex(plan.tx.getOutput(1).script!)).to.equal(opReturn);
      // Default change kind is the P2TR beacon address: fee sized for P2TR change.
      expect(plan.feeSats).to.equal(BigInt(FEE_RATE * beaconTxVsize('p2tr', 'p2tr')));
    });

    it('routes change to a supplied address and sizes the fee for that change kind', async () => {
      const changeAddress = p2wpkh(freshKey(), network).address!;
      const bitcoin = mockBitcoin(beaconAddress, 100_000);
      const plan = await buildAggregationBeaconTx({
        beaconAddress, internalPubkey : internalKey, signalBytes : new Uint8Array(32), bitcoin, network,
        changeAddress,
      });

      expect(plan.changeAddress).to.equal(changeAddress);
      expect(plan.tx.getOutputAddress(0, network)).to.equal(changeAddress);
      // OP_RETURN stays last even with a rotated change output.
      expect(bytesToHex(plan.tx.getOutput(1).script!)).to.equal(opReturn);
      // A P2WPKH change output is cheaper than the default P2TR change: the fee follows.
      expect(plan.feeSats).to.equal(BigInt(FEE_RATE * beaconTxVsize('p2tr', 'p2wpkh')));
      expect(Number(plan.feeSats)).to.be.lessThan(FEE_RATE * beaconTxVsize('p2tr', 'p2tr'));
    });

    it('omits a dust change output, leaving the signal as the sole output', async () => {
      // Fund just above the fee, so the change after fees is below the dust limit.
      const feeSats = FEE_RATE * beaconTxVsize('p2tr', 'p2tr');
      const bitcoin = mockBitcoin(beaconAddress, feeSats + 50); // 50-sat change < 330 dust
      const plan = await buildAggregationBeaconTx({
        beaconAddress, internalPubkey : internalKey, signalBytes : new Uint8Array(32), bitcoin, network,
      });

      // Change is swept into the fee: the only output is the OP_RETURN signal.
      expect(plan.tx.outputsLength).to.equal(1);
      expect(bytesToHex(plan.tx.getOutput(0).script!)).to.equal(opReturn);
    });

    it('spends one input, the UTXO of the largest value, if several are eligible', async () => {
      // The deeper UTXO (5,000 sats) is smaller: one MuSig2 input takes the larger one.
      const bitcoin = mockBitcoin(beaconAddress, 5_000, 90_000);
      const plan = await buildAggregationBeaconTx({
        beaconAddress, internalPubkey : internalKey, signalBytes : new Uint8Array(32), bitcoin, network,
      });

      expect(plan.tx.inputsLength).to.equal(1);
      expect(plan.utxos.map(utxo => utxo.value)).to.deep.equal([ 90_000 ]);
      expect(plan.prevOutValues).to.deep.equal([ 90_000n ]);
      expect(plan.tx.getOutput(0).amount).to.equal(90_000n - plan.feeSats);
    });

    it('rejects an invalid change address before spending the UTXO', async () => {
      const bitcoin = mockBitcoin(beaconAddress, 100_000);
      let threw = false;
      try {
        await buildAggregationBeaconTx({
          beaconAddress, internalPubkey : internalKey, signalBytes    : new Uint8Array(32), bitcoin, network,
          changeAddress  : 'not-a-bitcoin-address',
        });
      } catch(err) {
        threw = true;
        expect((err as Error).message).to.match(/Invalid change address/);
      }
      expect(threw, 'expected an invalid change address to throw').to.equal(true);
    });
  });
});
