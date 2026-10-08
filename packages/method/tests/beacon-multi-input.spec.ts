import { getNetwork } from '@did-btcr2/bitcoin';
import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { canonicalHash, decode } from '@did-btcr2/common';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { Address, OutScript, p2pkh, p2tr, Script, SigHash, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';
import type { SingletonScriptKind } from '../src/core/beacon/beacon.js';
import { beaconTxVsize, deriveSingletonAddress, opReturnScript } from '../src/core/beacon/beacon.js';
import { BeaconError } from '../src/core/beacon/error.js';
import { StaticFeeEstimator } from '../src/core/beacon/fee-estimator.js';
import type { BeaconService } from '../src/core/beacon/interfaces.js';
import { SingletonBeacon } from '../src/core/beacon/singleton-beacon.js';
import type { SignedBTCR2Update } from '../src/core/btcr2-update.js';

const network = getNetwork('regtest');
const DID = 'did:btcr2:k1q5ptvjpcgt0jfgvddau2fllfcpxwa5qtw2umkafp5xqwqr72a7xanvcjf324y';
const KINDS: Array<SingletonScriptKind> = [ 'p2pkh', 'p2wpkh', 'p2tr' ];
const TXID = 'f'.repeat(64);
const FEE_RATE = 5; // DEFAULT_FEE_ESTIMATOR is StaticFeeEstimator(5)
// Each input can be up to a few vbytes smaller than BEACON_INPUT_VBYTES (DER signature length).
const SLACK_PER_INPUT = 10;

const update = { patch: [], targetVersionId: 2 } as unknown as SignedBTCR2Update;

/**
 * Minimal BitcoinConnection: the beacon address holds one confirmed UTXO for each
 * entry of `funds`. Each UTXO has its own real prev tx, so the UTXO check of
 * ADR 143 passes. `transaction.send` records the raw hex in `sent`.
 */
function fundedBitcoin(
  beaconAddress: string,
  funds: Array<{ value: number; height: number }>,
  sent: Array<string>,
): { bitcoin: BitcoinConnection; utxos: Array<AddressUtxo> } {
  const script = OutScript.encode(Address(network).decode(beaconAddress));
  const hexById = new Map<string, string>();
  const utxos = funds.map(({ value, height }, i): AddressUtxo => {
    const prevTx = new Transaction({ allowUnknownOutputs: true });
    prevTx.addOutput({ amount: BigInt(value), script });
    prevTx.addInput({ txid: new Uint8Array(32), index: i, finalScriptSig: new Uint8Array([0x00]) });
    // toBytes(true) keeps the scriptSig, so the bytes hash to prevTx.id (ADR 143).
    hexById.set(prevTx.id, bytesToHex(prevTx.toBytes(true)));
    return { txid: prevTx.id, vout: 0, value, status: { confirmed: true, block_height: height } as never };
  });
  const bitcoin = {
    data : network,
    rest : {
      address     : { getUtxos: async () => utxos },
      transaction : {
        getHex : async (txid: string) => hexById.get(txid)!,
        send   : async (hex: string) => { sent.push(hex); return TXID; },
      },
    },
  } as unknown as BitcoinConnection;
  return { bitcoin, utxos };
}

/** A fresh signer and the singleton beacon of `kind` that it controls. */
function beaconOf(kind: SingletonScriptKind): { signer: LocalSigner; address: string; beacon: SingletonBeacon } {
  const signer = new LocalSigner(SchnorrKeyPair.generate().secretKey.bytes);
  const address = deriveSingletonAddress(kind, signer.publicKey, network);
  const service: BeaconService = { id: `${DID}#beacon-0`, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${address}` };
  return { signer, address, beacon: new SingletonBeacon(service, DID) };
}

/**
 * Verify the signature of input `idx` of a signed beacon tx against the consensus
 * sighash. For P2TR, the sighash commits to the scripts and amounts of all inputs.
 */
function verifyInput(
  tx: Transaction,
  idx: number,
  kind: SingletonScriptKind,
  signer: LocalSigner,
  scripts: Array<Uint8Array>,
  amounts: Array<bigint>,
): boolean {
  const input = tx.getInput(idx);
  if(kind === 'p2tr') {
    const [sig] = input.finalScriptWitness!;
    const sighash = tx.preimageWitnessV1(idx, scripts, SigHash.DEFAULT, amounts);
    const outputKey = p2tr(signer.publicKey.slice(1, 33), undefined, network).tweakedPubkey;
    return schnorr.verify(sig!, sighash, outputKey);
  }
  const [sigWithType, pubkey] = kind === 'p2pkh'
    ? Script.decode(input.finalScriptSig!) as Array<Uint8Array>
    : input.finalScriptWitness!;
  expect(sigWithType!.at(-1)).to.equal(SigHash.ALL);
  expect(bytesToHex(pubkey!)).to.equal(bytesToHex(signer.publicKey));
  const sighash = kind === 'p2pkh'
    ? (tx as unknown as {
      preimageLegacy: (idx: number, prevScript: Uint8Array, hashType: number) => Uint8Array;
    }).preimageLegacy(idx, scripts[idx]!, SigHash.ALL)
    // BIP-143: the scriptCode of a P2WPKH input is the P2PKH script of the same key.
    : tx.preimageWitnessV0(idx, p2pkh(signer.publicKey, network).script, SigHash.ALL, amounts[idx]!);
  return secp256k1.verify(sigWithType!.slice(0, -1), sighash, signer.publicKey);
}

describe('single-party beacon tx with several inputs', () => {
  for(const kind of KINDS) {
    it(`${kind}: spends each eligible UTXO in ADR 063 order, and each signature verifies`, async () => {
      const { signer, address, beacon } = beaconOf(kind);
      const sent: Array<string> = [];
      const { bitcoin, utxos } = fundedBitcoin(address, [
        { value: 30_000, height: 120 },
        { value: 20_000, height: 100 },
        { value: 10_000, height: 110 },
      ], sent);

      await beacon.broadcastSignal(update, signer, bitcoin);

      expect(sent).to.have.length(1);
      const tx = Transaction.fromRaw(hexToBytes(sent[0]!), { allowUnknownOutputs: true, allowUnknownInputs: true });
      // Deepest first: heights 100, 110, 120.
      const ordered = [ utxos[1]!, utxos[2]!, utxos[0]! ];
      expect(tx.inputsLength).to.equal(3);
      ordered.forEach((utxo, i) => expect(bytesToHex(tx.getInput(i).txid!)).to.equal(utxo.txid));

      const script = OutScript.encode(Address(network).decode(address));
      const scripts = ordered.map(() => script);
      const amounts = ordered.map(utxo => BigInt(utxo.value));
      for(let idx = 0; idx < tx.inputsLength; idx++) {
        expect(verifyInput(tx, idx, kind, signer, scripts, amounts), `input ${idx}`).to.equal(true);
      }

      // The analytical vsize is a tight upper bound of the real vsize.
      const bound = beaconTxVsize(kind, kind, 3);
      expect(tx.vsize).to.be.at.most(bound);
      expect(tx.vsize).to.be.at.least(bound - 3 * SLACK_PER_INPUT);

      // Change to the beacon address first, then the signal.
      expect(tx.outputsLength).to.equal(2);
      expect(tx.getOutputAddress(0, network)).to.equal(address);
      expect(tx.getOutput(0).amount).to.equal(60_000n - BigInt(FEE_RATE * bound));
      const signal = decode(canonicalHash(update), 'base64urlnopad');
      expect(bytesToHex(tx.getOutput(1).script!)).to.equal(bytesToHex(opReturnScript(signal)));
    });
  }

  describe('two P2WPKH UTXOs of 500 sats', () => {
    const funds = [ { value: 500, height: 100 }, { value: 500, height: 101 } ];

    it('fund a signal at 1 sat/vB: 2 inputs, 224 vB, change 776 sats', async () => {
      const { signer, address, beacon } = beaconOf('p2wpkh');
      const sent: Array<string> = [];
      const { bitcoin } = fundedBitcoin(address, funds, sent);

      await beacon.broadcastSignal(update, signer, bitcoin, { feeEstimator: new StaticFeeEstimator(1) });

      const tx = Transaction.fromRaw(hexToBytes(sent[0]!), { allowUnknownOutputs: true, allowUnknownInputs: true });
      expect(tx.inputsLength).to.equal(2);
      expect(beaconTxVsize('p2wpkh', 'p2wpkh', 2)).to.equal(224);
      expect(tx.getOutput(0).amount).to.equal(776n);
    });

    it('do not fund a signal at 5 sat/vB, and nothing is broadcast', async () => {
      const { signer, address, beacon } = beaconOf('p2wpkh');
      const sent: Array<string> = [];
      const { bitcoin } = fundedBitcoin(address, funds, sent);

      const err = await beacon.broadcastSignal(update, signer, bitcoin).then(() => undefined, (e: unknown) => e);

      expect(err).to.be.instanceOf(BeaconError);
      expect((err as BeaconError).type).to.equal('INSUFFICIENT_FUNDS');
      expect((err as BeaconError).message).to.equal(
        `Beacon address ${address} cannot fund a signal: 2 spendable UTXOs, total value 1000 sats, fee 1120 sats (224 vB).`
      );
      expect(sent).to.have.length(0);
    });
  });
});
