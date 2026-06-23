import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils';
import { Script, Transaction, p2tr } from '@scure/btc-signer';
import { expect } from 'chai';
import {
  AggregationCohort,
  buildFallbackLeaf,
  buildFallbackSpend,
  buildRecoveryLeaves,
  fallbackSighash,
  resolveFallbackThreshold,
} from '../src/index.js';
import type { FallbackSignature } from '../src/index.js';

const NET = getNetwork('bitcoin');
const RECOVERY_KEY_HEX = 'a'.repeat(64);
const RECOVERY_SEQUENCE = 144;

/** Build an n-participant cohort with recovery + fallback params and compute its address. */
function buildCohort(n: number, fallbackThreshold?: number): {
  cohort: AggregationCohort;
  kps: SchnorrKeyPair[];
  payment: ReturnType<typeof p2tr>;
} {
  const kps = Array.from({ length: n }, () => SchnorrKeyPair.generate());
  const cohort = new AggregationCohort({
    minParticipants  : n,
    network          : 'bitcoin',
    recoveryKey      : hexToBytes(RECOVERY_KEY_HEX),
    recoverySequence : RECOVERY_SEQUENCE,
    fallbackThreshold,
  });
  kps.forEach((kp, i) => {
    const did = `did:btcr2:p${i}`;
    cohort.participants.push(did);
    cohort.participantKeys.set(did, kp.publicKey.compressed);
  });
  cohort.cohortKeys = kps.map(kp => kp.publicKey.compressed);
  cohort.computeBeaconAddress();
  const leaves = buildRecoveryLeaves('operator-funded', {
    recoveryKey       : hexToBytes(RECOVERY_KEY_HEX),
    recoverySequence  : RECOVERY_SEQUENCE,
    cohortKeys        : cohort.cohortKeys,
    fallbackThreshold : cohort.effectiveFallbackThreshold,
  });
  const payment = p2tr(cohort.internalKey, leaves, NET, true);
  return { cohort, kps, payment };
}

/** A beacon announcement tx spending the beacon UTXO (input 0). */
function beaconTx(script: Uint8Array, value: bigint): Transaction {
  const tx = new Transaction({ version: 2, allowUnknownInputs: true, allowUnknownOutputs: true });
  tx.addInput({ txid: '22'.repeat(32), index: 0, witnessUtxo: { script, amount: value } });
  // OP_RETURN signal + change output.
  tx.addOutput({ script: Script.encode([ 'RETURN', new Uint8Array(32).fill(7) ]), amount: 0n });
  const change = p2tr(schnorr.getPublicKey(hexToBytes('44'.repeat(32))), undefined, NET).address!;
  tx.addOutputAddress(change, value - 1000n, NET);
  return tx;
}

describe('Aggregate beacon k-of-n fallback (ADR 042)', () => {

  describe('resolveFallbackThreshold', () => {
    it('defaults to n-1 and floors at 1', () => {
      expect(resolveFallbackThreshold(undefined, 5)).to.equal(4);
      expect(resolveFallbackThreshold(undefined, 1)).to.equal(1);
      expect(resolveFallbackThreshold(2, 5)).to.equal(2);
    });
  });

  describe('buildFallbackLeaf', () => {
    it('builds a k-of-n CHECKSIGADD leaf over the x-only cohort keys', () => {
      const keys = Array.from({ length: 3 }, () => SchnorrKeyPair.generate().publicKey.compressed);
      const script = buildFallbackLeaf({ cohortKeys: keys, fallbackThreshold: 2 });
      const decoded = Script.decode(script);
      // <key> CHECKSIG <key> CHECKSIGADD <key> CHECKSIGADD <2> NUMEQUAL
      expect(decoded).to.include('CHECKSIG');
      expect(decoded.filter(x => x === 'CHECKSIGADD')).to.have.lengthOf(2);
      expect(decoded[decoded.length - 1]).to.equal('NUMEQUAL');
    });

    it('is invariant to the order keys are supplied in (BIP-327 sort)', () => {
      const a = SchnorrKeyPair.generate().publicKey.compressed;
      const b = SchnorrKeyPair.generate().publicKey.compressed;
      const c = SchnorrKeyPair.generate().publicKey.compressed;
      const s1 = buildFallbackLeaf({ cohortKeys: [ a, b, c ], fallbackThreshold: 2 });
      const s2 = buildFallbackLeaf({ cohortKeys: [ c, a, b ], fallbackThreshold: 2 });
      expect(s1).to.deep.equal(s2);
    });

    it('rejects a threshold outside [1, n]', () => {
      const keys = [ SchnorrKeyPair.generate().publicKey.compressed, SchnorrKeyPair.generate().publicKey.compressed ];
      expect(() => buildFallbackLeaf({ cohortKeys: keys, fallbackThreshold: 0 })).to.throw(/INVALID_FALLBACK_THRESHOLD|\[1,/);
      expect(() => buildFallbackLeaf({ cohortKeys: keys, fallbackThreshold: 3 })).to.throw(/INVALID_FALLBACK_THRESHOLD|\[1,/);
    });

    it('rejects a non-33-byte cohort key', () => {
      expect(() => buildFallbackLeaf({ cohortKeys: [ new Uint8Array(32) ], fallbackThreshold: 1 }))
        .to.throw(/INVALID_COHORT_KEY|33-byte/);
    });
  });

  describe('computeBeaconAddress with the fallback leaf', () => {
    it('an advertised threshold changes the address vs the default n-1', () => {
      const kps = Array.from({ length: 3 }, () => SchnorrKeyPair.generate());
      const mk = (k?: number): string => {
        const c = new AggregationCohort({
          minParticipants   : 3, network           : 'bitcoin',
          recoveryKey       : hexToBytes(RECOVERY_KEY_HEX), recoverySequence  : RECOVERY_SEQUENCE, fallbackThreshold : k,
        });
        c.cohortKeys = kps.map(p => p.publicKey.compressed);
        return c.computeBeaconAddress();
      };
      // default (n-1 = 2) vs explicit 1: different leaf A, different address.
      expect(mk(undefined)).to.not.equal(mk(1));
      // default n-1 equals an explicit 2.
      expect(mk(undefined)).to.equal(mk(2));
    });
  });

  describe('buildFallbackSpend round-trip', () => {
    function signAll(cohort: AggregationCohort, kps: SchnorrKeyPair[], tx: Transaction, script: Uint8Array, value: bigint, who: number[]): FallbackSignature[] {
      const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: cohort.effectiveFallbackThreshold });
      const sighash = fallbackSighash(tx, 0, script, value, leaf);
      return who.map(i => ({
        pubKey    : kps[i].publicKey.compressed.slice(1),
        signature : schnorr.sign(sighash, kps[i].secretKey.bytes),
      }));
    }

    it('assembles a finalized k-of-n script-path witness from k standalone sigs', () => {
      const { cohort, kps, payment } = buildCohort(3, 2);
      const value = 100000n;
      const tx = beaconTx(payment.script, value);
      const sigs = signAll(cohort, kps, tx, payment.script, value, [ 0, 1 ]);

      const finalized = buildFallbackSpend({
        pendingTx         : tx,
        cohortKeys        : cohort.cohortKeys,
        fallbackThreshold : 2,
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX),
        recoverySequence  : RECOVERY_SEQUENCE,
        network           : 'bitcoin',
        prevOutScript     : payment.script,
        prevOutValue      : value,
        signatures        : sigs,
      });

      const witness = finalized.getInput(0).finalScriptWitness;
      expect(witness, 'finalScriptWitness present').to.not.be.undefined;
      // Script-path stack: [<n signature-or-empty entries>, leafScript, controlBlock].
      const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: 2 });
      expect(witness![witness!.length - 2]).to.deep.equal(leaf);
      // Exactly k (2) non-empty 64-byte signatures.
      const sigEntries = witness!.slice(0, witness!.length - 2).filter(e => e.length === 64);
      expect(sigEntries).to.have.lengthOf(2);

      // Each finalized signature verifies against the script-path sighash and a cohort key.
      const sighash = fallbackSighash(beaconTx(payment.script, value), 0, payment.script, value, leaf);
      const xonly = cohort.cohortKeys.map(k => k.slice(1));
      for(const sig of sigEntries) {
        expect(xonly.some(xk => schnorr.verify(sig, sighash, xk))).to.be.true;
      }
    });

    it('accepts more than k collected sigs but injects exactly k', () => {
      const { cohort, kps, payment } = buildCohort(3, 2);
      const value = 100000n;
      const tx = beaconTx(payment.script, value);
      const sigs = signAll(cohort, kps, tx, payment.script, value, [ 0, 1, 2 ]); // all 3
      const finalized = buildFallbackSpend({
        pendingTx         : tx, cohortKeys        : cohort.cohortKeys, fallbackThreshold : 2,
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX), recoverySequence  : RECOVERY_SEQUENCE,
        network           : 'bitcoin', prevOutScript     : payment.script, prevOutValue      : value, signatures        : sigs,
      });
      const witness = finalized.getInput(0).finalScriptWitness!;
      const sigEntries = witness.slice(0, witness.length - 2).filter(e => e.length === 64);
      // A k-of-n CHECKSIGADD leaf is satisfied by EXACTLY k sigs (NUMEQUAL).
      expect(sigEntries).to.have.lengthOf(2);
    });

    it('rejects when fewer than k valid signatures are supplied', () => {
      const { cohort, kps, payment } = buildCohort(3, 2);
      const value = 100000n;
      const tx = beaconTx(payment.script, value);
      const sigs = signAll(cohort, kps, tx, payment.script, value, [ 0 ]); // only 1, need 2
      expect(() => buildFallbackSpend({
        pendingTx         : tx, cohortKeys        : cohort.cohortKeys, fallbackThreshold : 2,
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX), recoverySequence  : RECOVERY_SEQUENCE,
        network           : 'bitcoin', prevOutScript     : payment.script, prevOutValue      : value, signatures        : sigs,
      })).to.throw(/NOT_ENOUGH_FALLBACK_SIGNATURES|need 2/);
    });

    it('ignores a forged signature (does not count toward k)', () => {
      const { cohort, kps, payment } = buildCohort(3, 2);
      const value = 100000n;
      const tx = beaconTx(payment.script, value);
      const good = signAll(cohort, kps, tx, payment.script, value, [ 0 ]);
      // One real key but a garbage signature.
      const forged: FallbackSignature = { pubKey: kps[1].publicKey.compressed.slice(1), signature: new Uint8Array(64).fill(9) };
      expect(() => buildFallbackSpend({
        pendingTx         : tx, cohortKeys        : cohort.cohortKeys, fallbackThreshold : 2,
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX), recoverySequence  : RECOVERY_SEQUENCE,
        network           : 'bitcoin', prevOutScript     : payment.script, prevOutValue      : value,
        signatures        : [ ...good, forged ],
      })).to.throw(/Not enough valid fallback signatures|need 2/);
    });

    it('ignores a signature from a non-cohort key', () => {
      const { cohort, kps, payment } = buildCohort(3, 2);
      const value = 100000n;
      const tx = beaconTx(payment.script, value);
      const leaf = buildFallbackLeaf({ cohortKeys: cohort.cohortKeys, fallbackThreshold: 2 });
      const sighash = fallbackSighash(tx, 0, payment.script, value, leaf);
      const outsider = SchnorrKeyPair.generate();
      const sigs: FallbackSignature[] = [
        { pubKey: kps[0].publicKey.compressed.slice(1), signature: schnorr.sign(sighash, kps[0].secretKey.bytes) },
        { pubKey: outsider.publicKey.compressed.slice(1), signature: schnorr.sign(sighash, outsider.secretKey.bytes) },
      ];
      expect(() => buildFallbackSpend({
        pendingTx         : tx, cohortKeys        : cohort.cohortKeys, fallbackThreshold : 2,
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX), recoverySequence  : RECOVERY_SEQUENCE,
        network           : 'bitcoin', prevOutScript     : payment.script, prevOutValue      : value, signatures        : sigs,
      })).to.throw(/Not enough valid fallback signatures|need 2/);
    });

    it('rejects a prevout script that is not the cohort beacon output', () => {
      const { cohort, kps, payment } = buildCohort(3, 2);
      const value = 100000n;
      const tx = beaconTx(payment.script, value);
      const sigs = signAll(cohort, kps, tx, payment.script, value, [ 0, 1 ]);
      const wrongScript = p2tr(schnorr.getPublicKey(hexToBytes('55'.repeat(32))), undefined, NET).script;
      expect(() => buildFallbackSpend({
        pendingTx         : tx, cohortKeys        : cohort.cohortKeys, fallbackThreshold : 2,
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX), recoverySequence  : RECOVERY_SEQUENCE,
        network           : 'bitcoin', prevOutScript     : wrongScript, prevOutValue      : value, signatures        : sigs,
      })).to.throw(/PREVOUT_SCRIPT_MISMATCH|does not match/);
    });

    it('defaults the threshold to n-1 when omitted, matching the cohort', () => {
      const { cohort, kps, payment } = buildCohort(3); // no advertised threshold => k=2
      expect(cohort.effectiveFallbackThreshold).to.equal(2);
      const value = 100000n;
      const tx = beaconTx(payment.script, value);
      const sigs = signAll(cohort, kps, tx, payment.script, value, [ 0, 2 ]);
      const finalized = buildFallbackSpend({
        pendingTx        : tx, cohortKeys       : cohort.cohortKeys, // fallbackThreshold omitted
        recoveryKey      : hexToBytes(RECOVERY_KEY_HEX), recoverySequence : RECOVERY_SEQUENCE,
        network          : 'bitcoin', prevOutScript    : payment.script, prevOutValue     : value, signatures       : sigs,
      });
      expect(finalized.getInput(0).finalScriptWitness).to.not.be.undefined;
    });
  });
});
