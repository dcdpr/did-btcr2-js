import { getNetwork } from '@did-btcr2/bitcoin';
import { LocalSigner, SchnorrKeyPair } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { OutScript, p2tr, p2wpkh, SigHash, Transaction } from '@scure/btc-signer';
import { expect } from 'chai';
import { opReturnScript } from '../src/core/beacon/beacon.js';

const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b));

const network = getNetwork('regtest');

/**
 * BIP-341 taproot key-path signing on the singleton-beacon dispatcher.
 *
 * Bitcoin's consensus verifier checks `tapKeySig` against the *tweaked* output
 * internal key `Q = P + tG` (BIP-341 §3), not the untweaked Schnorr pubkey.
 * `tx.finalize()` in scure-btc-signer does not perform this check — it
 * accepts any structurally-valid 64-byte signature into the witness. The vsize
 * spec asserts shape only and the tx-builder will happily produce a hex string
 * whose signature is valid BIP-340 over the sighash but invalid under
 * consensus.
 *
 * This spec verifies the signature against `p2tr(internalKey).tweakedPubkey`
 * (the same Q the Bitcoin verifier uses) and a sentinel that asserts the
 * signature does NOT verify against the untweaked P — exercising the BIP-341
 * tweak contract end-to-end at the unit-test layer.
 *
 * ECDSA paths (P2PKH, P2WPKH) are covered by `signer.spec.ts` in
 * @did-btcr2/keypair and exercised through scure's finalize in
 * `beacon-vsize.spec.ts`.
 */
describe('singleton beacon P2TR signing produces verifiable signatures', () => {
  it('P2TR: BIP-341 key-path signature verifies against the TWEAKED output key', () => {
    const kp = SchnorrKeyPair.generate();
    const signer = new LocalSigner(kp.secretKey.bytes);
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

    const sighash = tx.preimageWitnessV1(0, [tapOut.script], SigHash.DEFAULT, [100000n]);
    const sig = signer.sign(sighash, 'bip341');

    // The Bitcoin consensus verifier checks `tapKeySig` against the tweaked
    // output internal key (Q = P + tG), exposed by scure as `tapOut.tweakedPubkey`.
    // This assertion mirrors the consensus check at the unit level.
    expect(schnorr.verify(sig, sighash, tapOut.tweakedPubkey)).to.equal(true);

    // The same signature MUST NOT verify against the untweaked internal key P.
    // BIP-341 §3 requires the tweak; signing with the untweaked secret produces
    // a structurally-valid BIP-340 signature over the sighash that consensus
    // rejects because it checks against Q, not P.
    expect(schnorr.verify(sig, sighash, internalKey)).to.equal(false);

    // Also confirm scure can finalize the tx with this signature.
    tx.updateInput(0, { tapKeySig: sig });
    tx.finalize();
  });

  /**
   * BIP-143 P2WPKH scriptCode derivation.
   *
   * The BIP-143 sighash commits to a `scriptCode` that is the legacy P2PKH
   * script over the same pubkey hash as the witness program. Deriving that
   * hash from `OutScript.decode(prevOutScript)` (the bytes actually committed
   * on-chain) is a strict generalization of deriving it from
   * `hash160(signer.publicKey)`: the two are equal when signer and prev output
   * agree, and the prevOutScript form remains correct if they ever diverge
   * (since the consensus verifier always uses the prev-output bytes).
   *
   * Asserted invariants:
   *   1. Happy path: prevOutScript-derived hash equals `hash160(signer.publicKey)`.
   *   2. A tampered pubkey hash produces a different sighash — the sighash
   *      is sensitive to which bytes feed into the scriptCode.
   *
   * ECDSA signature verification across noble versions (v1.9.7 in method,
   * v2.0.1 in keypair) has incompatible APIs; signature correctness for
   * `LocalSigner.sign(_, 'ecdsa')` is covered in `keypair/tests/signer.spec.ts`,
   * and end-to-end finalization is exercised by `beacon-vsize.spec.ts`.
   */
  it('P2WPKH: BIP-143 scriptCode is derived from prevOutScript, not from signer.publicKey', () => {
    const kp = SchnorrKeyPair.generate();
    const signer = new LocalSigner(kp.secretKey.bytes);
    const pubkey = signer.publicKey;
    const witnessOut = p2wpkh(pubkey, network);
    const prevOutScript = witnessOut.script;

    const tx = new Transaction({ allowUnknownOutputs: true });
    tx.addInput({
      txid        : new Uint8Array(32),
      index       : 0,
      witnessUtxo : { amount: 100000n, script: prevOutScript },
    });
    tx.addOutputAddress(witnessOut.address!, 99000n, network);
    tx.addOutput({ script: opReturnScript(new Uint8Array(32)), amount: 0n });

    // Derive the scriptCode hash from prevOutScript bytes (BIP-143 §4: the
    // sighash commits to the prev output, so the scriptCode must follow those
    // bytes exactly).
    const decoded = OutScript.decode(prevOutScript);
    expect(decoded.type).to.equal('wpkh');
    if(decoded.type !== 'wpkh') throw new Error('unreachable');

    // Invariant 1: in the matching-pubkey happy path, the prevOutScript-derived
    // hash equals hash160(signer.publicKey) — the two derivations agree when
    // signer and prev output reference the same key.
    expect(Array.from(decoded.hash)).to.deep.equal(Array.from(hash160(pubkey)));

    const sighashScript = OutScript.encode({ type: 'pkh', hash: decoded.hash });
    const sighashType = SigHash.ALL;
    const sighash = tx.preimageWitnessV0(0, sighashScript, sighashType, 100000n);

    // Invariant 2: a tampered pubkey hash produces a different sighash —
    // demonstrating that the sighash is sensitive to which pubkey hash feeds
    // into the scriptCode. Deriving from prevOutScript locks the scriptCode to
    // the bytes actually committed on-chain.
    const tamperedHash = hash160(new Uint8Array(33).fill(0x02));
    const tamperedScript = OutScript.encode({ type: 'pkh', hash: tamperedHash });
    const tamperedSighash = tx.preimageWitnessV0(0, tamperedScript, sighashType, 100000n);
    expect(Array.from(tamperedSighash)).to.not.deep.equal(Array.from(sighash));

    // Finalize via the same partialSig path the production code uses. If the
    // sighash were wrong, scure would still finalize (it doesn't verify), but
    // the broadcast would be rejected by Bitcoin consensus.
    const sig = signer.sign(sighash, 'ecdsa');
    const sigWithType = new Uint8Array(sig.length + 1);
    sigWithType.set(sig);
    sigWithType[sig.length] = sighashType;
    tx.updateInput(0, { partialSig: [[pubkey, sigWithType]] }, true);
    tx.finalize();
  });
});
