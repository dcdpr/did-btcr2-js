import { getNetwork } from '@did-btcr2/bitcoin';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { OutScript, p2pkh, p2tr, p2wpkh, SigHash, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';
import {
  opReturnScript,
  P2PKH_BEACON_TX_VSIZE,
  P2TR_BEACON_TX_VSIZE,
  P2WPKH_BEACON_TX_VSIZE,
} from '../src/core/beacon/beacon.js';

const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b));
const network = getNetwork('regtest');
// vbyte slack used as a sanity check that the constants are not wildly over-estimating.
// Per-kind variation comes from DER signature length (P2PKH/P2WPKH: 70-72 bytes) and
// stripped vs witness weight discount.
const SLACK = 10;

/**
 * Lock in the three vsize constants used for singleton (P2PKH / P2WPKH / P2TR) and
 * aggregation (P2TR) beacon fee estimation.
 *
 * If scure-btc-signer changes its serialization or our witness shape drifts, the
 * actual vsize could exceed the constant, under-paying the fee and getting txs
 * rejected. Tight upper bound: actual must not exceed the constant, and must be
 * within {@link SLACK} vbytes of it.
 */
describe('beacon vsize constants', () => {
  it('P2PKH_BEACON_TX_VSIZE is a tight upper bound for a signed 1-in / P2PKH-change + OP_RETURN(32) tx', () => {
    const kp = SchnorrKeyPair.generate();
    const signer = new LocalSigner(kp.secretKey.bytes);
    const pubkey = signer.publicKey;
    const pkOut = p2pkh(pubkey, network);

    // Legacy P2PKH inputs require a non-witness prev tx. Build a synthetic prev tx
    // with one P2PKH output owned by `pubkey`. Order matters: scure refuses to
    // mutate outputs once any input carries finalScriptSig, so add the output first.
    const prevTx = new Transaction();
    prevTx.addOutput({ amount: 100000n, script: pkOut.script });
    prevTx.addInput({
      txid           : new Uint8Array(32),
      index          : 0xffffffff,
      finalScriptSig : new Uint8Array([0x00]),
    });
    const prevTxBytes = prevTx.toBytes();

    const tx = new Transaction({ allowUnknownOutputs: true });
    tx.addInput({
      txid           : sha256(sha256(prevTxBytes)).reverse(),
      index          : 0,
      nonWitnessUtxo : prevTxBytes,
    });
    tx.addOutputAddress(pkOut.address!, 99000n, network);
    tx.addOutput({ script: opReturnScript(new Uint8Array(32)), amount: 0n });

    const sighashType = SigHash.ALL;
    const sighash = (tx as unknown as {
      preimageLegacy: (idx: number, prevScript: Uint8Array, hashType: number) => Uint8Array;
    }).preimageLegacy(0, pkOut.script, sighashType);
    const sig = signer.sign(sighash, 'ecdsa');
    const sigWithType = concatBytes(sig, new Uint8Array([sighashType]));
    tx.updateInput(0, { partialSig: [[pubkey, sigWithType]] }, true);
    tx.finalize();

    const actual = tx.vsize;
    expect(actual).to.be.at.most(P2PKH_BEACON_TX_VSIZE);
    expect(actual).to.be.at.least(P2PKH_BEACON_TX_VSIZE - SLACK);
  });

  it('P2WPKH_BEACON_TX_VSIZE is a tight upper bound for a signed 1-in / P2WPKH-change + OP_RETURN(32) tx', () => {
    const kp = SchnorrKeyPair.generate();
    const signer = new LocalSigner(kp.secretKey.bytes);
    const pubkey = signer.publicKey;
    const witnessOut = p2wpkh(pubkey, network);

    const tx = new Transaction({ allowUnknownOutputs: true });
    tx.addInput({
      txid        : new Uint8Array(32),
      index       : 0,
      witnessUtxo : { amount: 100000n, script: witnessOut.script },
    });
    tx.addOutputAddress(witnessOut.address!, 99000n, network);
    tx.addOutput({ script: opReturnScript(new Uint8Array(32)), amount: 0n });

    const sighashScript = OutScript.encode({ type: 'pkh', hash: hash160(pubkey) });
    const sighashType = SigHash.ALL;
    const sighash = tx.preimageWitnessV0(0, sighashScript, sighashType, 100000n);
    const sig = signer.sign(sighash, 'ecdsa');
    const sigWithType = concatBytes(sig, new Uint8Array([sighashType]));
    tx.updateInput(0, { partialSig: [[pubkey, sigWithType]] }, true);
    tx.finalize();

    const actual = tx.vsize;
    expect(actual).to.be.at.most(P2WPKH_BEACON_TX_VSIZE);
    expect(actual).to.be.at.least(P2WPKH_BEACON_TX_VSIZE - SLACK);
  });

  it('P2TR_BEACON_TX_VSIZE is a tight upper bound for a signed 1-in / P2TR-change + OP_RETURN(32) tx', () => {
    const kp = SchnorrKeyPair.generate();
    const internalKey = kp.publicKey.x;
    const tapOut = p2tr(internalKey, undefined, network);

    const tx = new Transaction({ allowUnknownOutputs: true });
    tx.addInput({
      txid           : new Uint8Array(32),
      index          : 0,
      witnessUtxo    : { amount: 100000n, script: tapOut.script },
      tapInternalKey : internalKey,
    });
    tx.addOutputAddress(tapOut.address!, 99000n, network);
    tx.addOutput({ script: opReturnScript(new Uint8Array(32)), amount: 0n });

    // BIP-340 key-path signature is a fixed 64 bytes. Inject a dummy so scure can finalize.
    tx.updateInput(0, { tapKeySig: new Uint8Array(64) });
    tx.finalize();

    const actual = tx.vsize;
    expect(actual).to.be.at.most(P2TR_BEACON_TX_VSIZE);
    expect(actual).to.be.at.least(P2TR_BEACON_TX_VSIZE - SLACK);
  });
});
