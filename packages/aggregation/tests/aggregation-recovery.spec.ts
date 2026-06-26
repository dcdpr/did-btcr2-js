import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils';
import { Script, SigHash, Transaction, p2tr } from '@scure/btc-signer';
import { expect } from 'chai';
import type { CohortConditions } from '../src/index.js';
import {
  AggregationCohort,
  BeaconSigningSession,
  DEFAULT_FUNDING_MODEL,
  DEFAULT_RECOVERY_SEQUENCE,
  MAX_RECOVERY_SEQUENCE,
  buildFallbackLeaf,
  buildRecoveryLeaves,
  buildRecoveryScript,
  buildRecoverySpend,
  validateCohortConditions,
} from '../src/index.js';

/** BIP-68 nSequence flag bits the recovery sequence must never set. */
const BIP68_DISABLE_BIT = 0x80000000; // bit 31: disables CHECKSEQUENCEVERIFY entirely
const BIP68_TYPE_BIT = 0x00400000;    // bit 22: switches block-based to time-based

const RECOVERY_KEY_HEX = 'a'.repeat(64);
const RECOVERY_SEQUENCE = 144;

/** A minimal set of valid cohort conditions for validateCohortConditions tests. */
function baseConditions(overrides: Partial<CohortConditions> = {}): CohortConditions {
  return {
    beaconType       : 'CASBeacon',
    minParticipants  : 2,
    recoveryKey      : RECOVERY_KEY_HEX,
    recoverySequence : RECOVERY_SEQUENCE,
    ...overrides,
  };
}

/** Build a 2-participant cohort with recovery params and compute its beacon address. */
function buildCohort(network = 'bitcoin'): {
  cohort: AggregationCohort;
  kp1: SchnorrKeyPair;
  kp2: SchnorrKeyPair;
  did1: string;
  did2: string;
} {
  const kp1 = SchnorrKeyPair.generate();
  const kp2 = SchnorrKeyPair.generate();
  const did1 = 'did:btcr2:alice';
  const did2 = 'did:btcr2:bob';
  const cohort = new AggregationCohort({
    minParticipants  : 2,
    network,
    recoveryKey      : hexToBytes(RECOVERY_KEY_HEX),
    recoverySequence : RECOVERY_SEQUENCE,
  });
  cohort.participants.push(did1, did2);
  cohort.participantKeys.set(did1, kp1.publicKey.compressed);
  cohort.participantKeys.set(did2, kp2.publicKey.compressed);
  cohort.cohortKeys = [kp1.publicKey.compressed, kp2.publicKey.compressed];
  cohort.computeBeaconAddress();
  return { cohort, kp1, kp2, did1, did2 };
}

describe('Aggregate beacon recovery (ADR 042)', () => {

  describe('buildRecoveryScript / buildRecoveryLeaves', () => {
    it('encodes the CSV recovery leaf as <seq> CSV DROP <key> CHECKSIG', () => {
      const recoveryKey = hexToBytes(RECOVERY_KEY_HEX);
      const script = buildRecoveryScript({ recoveryKey, recoverySequence: RECOVERY_SEQUENCE });
      const expected = Script.encode([
        RECOVERY_SEQUENCE,
        'CHECKSEQUENCEVERIFY',
        'DROP',
        recoveryKey,
        'CHECKSIG',
      ]);
      expect(script).to.deep.equal(expected);

      // Decode it back and assert the opcode structure explicitly. Script.decode
      // returns opcode names (strings) for known opcodes and raw bytes for pushes.
      const decoded = Script.decode(script);
      expect(decoded[1]).to.equal('CHECKSEQUENCEVERIFY');
      expect(decoded[2]).to.equal('DROP');
      expect(decoded[4]).to.equal('CHECKSIG');
      expect(decoded[3]).to.deep.equal(recoveryKey);
    });

    it('operator-funded returns the fallback leaf (A) then the CSV recovery leaf (B)', () => {
      const cohortKeys = [ SchnorrKeyPair.generate().publicKey.compressed, SchnorrKeyPair.generate().publicKey.compressed ];
      const leaves = buildRecoveryLeaves(DEFAULT_FUNDING_MODEL, {
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX),
        recoverySequence  : RECOVERY_SEQUENCE,
        cohortKeys,
        fallbackThreshold : 1,
      });
      expect(leaves).to.have.lengthOf(2);
      // Canonical order: leaf A is the k-of-n fallback, leaf B is the CSV recovery.
      expect(leaves[0].script).to.deep.equal(buildFallbackLeaf({ cohortKeys, fallbackThreshold: 1 }));
      expect(leaves[1].script).to.deep.equal(
        buildRecoveryScript({ recoveryKey: hexToBytes(RECOVERY_KEY_HEX), recoverySequence: RECOVERY_SEQUENCE })
      );
    });

    it('participant-funded is reserved and throws', () => {
      expect(() => buildRecoveryLeaves('participant-funded', {
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX),
        recoverySequence  : RECOVERY_SEQUENCE,
        cohortKeys        : [ SchnorrKeyPair.generate().publicKey.compressed ],
        fallbackThreshold : 1,
      })).to.throw(/reserved|not yet implemented|UNSUPPORTED/i);
    });

    it('rejects a non-32-byte recovery key and a zero sequence', () => {
      expect(() => buildRecoveryScript({ recoveryKey: new Uint8Array(31), recoverySequence: 144 }))
        .to.throw(/32-byte|INVALID_RECOVERY_KEY/);
      expect(() => buildRecoveryScript({ recoveryKey: hexToBytes(RECOVERY_KEY_HEX), recoverySequence: 0 }))
        .to.throw(/INVALID_RECOVERY_SEQUENCE|\[1,/);
    });

    it('rejects a recovery sequence with the BIP-68 disable bit (bit 31) set', () => {
      // A value with bit 31 set would disable CHECKSEQUENCEVERIFY: the recovery
      // key could then spend with no delay. It must be rejected.
      const key = hexToBytes(RECOVERY_KEY_HEX);
      expect(() => buildRecoveryScript({ recoveryKey: key, recoverySequence: BIP68_DISABLE_BIT }))
        .to.throw(/INVALID_RECOVERY_SEQUENCE|\[1,/);
      expect(() => buildRecoveryScript({ recoveryKey: key, recoverySequence: BIP68_DISABLE_BIT | 144 }))
        .to.throw(/INVALID_RECOVERY_SEQUENCE|\[1,/);
    });

    it('rejects a recovery sequence with the BIP-68 type bit (bit 22) set', () => {
      // bit 22 switches the timelock from block-based to time-based (seconds);
      // the recovery policy is block-based only.
      expect(() => buildRecoveryScript({ recoveryKey: hexToBytes(RECOVERY_KEY_HEX), recoverySequence: BIP68_TYPE_BIT | 1 }))
        .to.throw(/INVALID_RECOVERY_SEQUENCE|\[1,/);
    });

    it('rejects a recovery sequence above the block-range maximum', () => {
      expect(() => buildRecoveryScript({ recoveryKey: hexToBytes(RECOVERY_KEY_HEX), recoverySequence: MAX_RECOVERY_SEQUENCE + 1 }))
        .to.throw(/INVALID_RECOVERY_SEQUENCE|\[1,/);
      // The boundary value itself is accepted.
      expect(() => buildRecoveryScript({ recoveryKey: hexToBytes(RECOVERY_KEY_HEX), recoverySequence: MAX_RECOVERY_SEQUENCE }))
        .to.not.throw();
    });

    it('exposes a sane default recovery sequence', () => {
      expect(DEFAULT_RECOVERY_SEQUENCE).to.be.a('number');
      expect(DEFAULT_RECOVERY_SEQUENCE).to.be.greaterThan(0);
    });
  });

  describe('validateCohortConditions: recovery params are mandatory', () => {
    it('accepts a well-formed recovery key + sequence', () => {
      expect(validateCohortConditions(baseConditions())).to.be.empty;
    });

    it('rejects a missing recovery key', () => {
      const c = baseConditions();
      delete (c as Partial<CohortConditions>).recoveryKey;
      const problems = validateCohortConditions(c);
      expect(problems.some(p => /recoveryKey/.test(p))).to.be.true;
    });

    it('rejects a malformed (non-64-hex) recovery key', () => {
      expect(validateCohortConditions(baseConditions({ recoveryKey: 'zz' })).some(p => /recoveryKey/.test(p))).to.be.true;
      expect(validateCohortConditions(baseConditions({ recoveryKey: 'ab'.repeat(20) })).some(p => /recoveryKey/.test(p))).to.be.true;
    });

    it('rejects a missing or non-positive recovery sequence', () => {
      const c = baseConditions();
      delete (c as Partial<CohortConditions>).recoverySequence;
      expect(validateCohortConditions(c).some(p => /recoverySequence/.test(p))).to.be.true;
      expect(validateCohortConditions(baseConditions({ recoverySequence: 0 })).some(p => /recoverySequence/.test(p))).to.be.true;
    });

    it('rejects a recovery sequence outside the BIP-68 block range', () => {
      expect(validateCohortConditions(baseConditions({ recoverySequence: BIP68_DISABLE_BIT })).some(p => /recoverySequence/.test(p))).to.be.true;
      expect(validateCohortConditions(baseConditions({ recoverySequence: BIP68_TYPE_BIT | 1 })).some(p => /recoverySequence/.test(p))).to.be.true;
      expect(validateCohortConditions(baseConditions({ recoverySequence: MAX_RECOVERY_SEQUENCE + 1 })).some(p => /recoverySequence/.test(p))).to.be.true;
      expect(validateCohortConditions(baseConditions({ recoverySequence: MAX_RECOVERY_SEQUENCE }))).to.be.empty;
    });

    it('accepts a known funding model and rejects an unknown one', () => {
      expect(validateCohortConditions(baseConditions({ fundingModel: 'operator-funded' }))).to.be.empty;
      expect(validateCohortConditions(baseConditions({ fundingModel: 'mystery' as never })).some(p => /fundingModel/.test(p))).to.be.true;
    });
  });

  describe('computeBeaconAddress: internal key + recovery script tree', () => {
    it('throws when recovery params are absent', () => {
      const cohort = new AggregationCohort({ minParticipants: 2, network: 'bitcoin' });
      cohort.cohortKeys = [SchnorrKeyPair.generate().publicKey.compressed, SchnorrKeyPair.generate().publicKey.compressed];
      expect(() => cohort.computeBeaconAddress()).to.throw(/NO_RECOVERY_PARAMS|recovery/i);
    });

    it('derives a Taproot address and a tweak that commits to the Merkle root', () => {
      const { cohort } = buildCohort('bitcoin');
      expect(cohort.beaconAddress.startsWith('bc1p')).to.be.true;
      expect(cohort.tapMerkleRoot).to.have.lengthOf(32);
      expect(cohort.internalKey).to.have.lengthOf(32);

      // The tweak must be taggedHash("TapTweak", internalKey || merkleRoot), NOT
      // the key-path-only taggedHash("TapTweak", internalKey). They must differ,
      // and the script-tree tweak must match the recomputed value.
      const keyPathOnlyTweak = schnorr.utils.taggedHash('TapTweak', cohort.internalKey);
      const concat = new Uint8Array([...cohort.internalKey, ...cohort.tapMerkleRoot]);
      const scriptTreeTweak = schnorr.utils.taggedHash('TapTweak', concat);
      expect(cohort.tapTweak).to.deep.equal(scriptTreeTweak);
      expect(cohort.tapTweak).to.not.deep.equal(keyPathOnlyTweak);
    });

    it('matches an independently recomputed p2tr address with the same script tree', () => {
      const { cohort } = buildCohort('bitcoin');
      const leaves = buildRecoveryLeaves(DEFAULT_FUNDING_MODEL, {
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX),
        recoverySequence  : RECOVERY_SEQUENCE,
        cohortKeys        : cohort.cohortKeys,
        fallbackThreshold : cohort.effectiveFallbackThreshold,
      });
      const payment = p2tr(cohort.internalKey, leaves, getNetwork('bitcoin'), true);
      expect(payment.address).to.equal(cohort.beaconAddress);
    });
  });

  describe('the MuSig2 key-path signature validates against the script-tree beacon output', () => {
    // This is the correctness oracle for the tweak change: if the key-path tweak
    // did not commit to the recovery tree's Merkle root, the aggregated MuSig2
    // signature would not verify against the funded output key.
    it('a full 2-of-2 round produces a signature valid under the tweaked output key', () => {
      const { cohort, kp1, kp2, did1, did2 } = buildCohort('bitcoin');

      const leaves = buildRecoveryLeaves(DEFAULT_FUNDING_MODEL, {
        recoveryKey       : hexToBytes(RECOVERY_KEY_HEX),
        recoverySequence  : RECOVERY_SEQUENCE,
        cohortKeys        : cohort.cohortKeys,
        fallbackThreshold : cohort.effectiveFallbackThreshold,
      });
      const payment = p2tr(cohort.internalKey, leaves, getNetwork('bitcoin'), true);
      const value = 100000n;

      const tx = new Transaction({ version: 2 });
      tx.addInput({ txid: '11'.repeat(32), index: 0, witnessUtxo: { amount: value, script: payment.script } });
      tx.addOutput({ script: payment.script, amount: value - 500n });

      const mk = (): BeaconSigningSession => new BeaconSigningSession({
        cohort,
        pendingTx      : tx,
        prevOutScripts : [payment.script],
        prevOutValues  : [value],
      });
      const service = mk();
      const p1 = mk();
      const p2 = mk();

      const n1 = p1.generateNonceContribution(kp1.publicKey.compressed, kp1.secretKey.bytes);
      const n2 = p2.generateNonceContribution(kp2.publicKey.compressed, kp2.secretKey.bytes);
      service.addNonceContribution(did1, n1);
      service.addNonceContribution(did2, n2);
      const agg = service.generateAggregatedNonce();
      p1.aggregatedNonce = agg;
      p2.aggregatedNonce = agg;

      service.addPartialSignature(did1, p1.generatePartialSignature(kp1.secretKey.bytes));
      service.addPartialSignature(did2, p2.generatePartialSignature(kp2.secretKey.bytes));
      const finalSig = service.generateFinalSignature();

      expect(finalSig).to.have.lengthOf(64);
      // The definitive check: the aggregated key-path signature is valid for the
      // Taproot output key the address (and thus the funded UTXO) commits to.
      expect(schnorr.verify(finalSig, service.sigHash, payment.tweakedPubkey)).to.be.true;
    });
  });

  describe('buildRecoverySpend', () => {
    function freshRecovery(): { secretKey: Uint8Array; recoveryKey: Uint8Array } {
      const kp = SchnorrKeyPair.generate();
      return { secretKey: kp.secretKey.bytes, recoveryKey: schnorr.getPublicKey(kp.secretKey.bytes) };
    }

    function cohortKeys(): Uint8Array[] {
      return [SchnorrKeyPair.generate().publicKey.compressed, SchnorrKeyPair.generate().publicKey.compressed];
    }

    function destination(): string {
      const kp = SchnorrKeyPair.generate();
      return p2tr(schnorr.getPublicKey(kp.secretKey.bytes), undefined, getNetwork('bitcoin')).address!;
    }

    it('builds a finalized script-path spend with the CSV sequence and recovery witness', () => {
      const { secretKey, recoveryKey } = freshRecovery();
      const keys = cohortKeys();
      const tx = buildRecoverySpend({
        cohortKeys         : keys,
        recoverySecretKey  : secretKey,
        recoveryKey,
        recoverySequence   : RECOVERY_SEQUENCE,
        network            : 'bitcoin',
        utxo               : { txid: '22'.repeat(32), vout: 0, value: 100000n },
        destinationAddress : destination(),
        fee                : 400n,
      });

      const input = tx.getInput(0);
      expect(input.sequence).to.equal(RECOVERY_SEQUENCE);

      // Script-path witness stack: [signature, leafScript, controlBlock].
      const witness = input.finalScriptWitness;
      expect(witness, 'finalScriptWitness present').to.not.be.undefined;
      expect(witness!).to.have.lengthOf(3);
      expect(witness![1]).to.deep.equal(buildRecoveryScript({ recoveryKey, recoverySequence: RECOVERY_SEQUENCE }));
      // Output pays the recovered value minus fee.
      expect(tx.getOutput(0).amount).to.equal(100000n - 400n);
    });

    it('rebuilds the same funded output a cohort would compute', () => {
      const { secretKey, recoveryKey } = freshRecovery();
      const kp1 = SchnorrKeyPair.generate();
      const kp2 = SchnorrKeyPair.generate();
      const keys = [kp1.publicKey.compressed, kp2.publicKey.compressed];

      const cohort = new AggregationCohort({
        minParticipants  : 2,
        network           : 'bitcoin',
        recoveryKey,
        recoverySequence : RECOVERY_SEQUENCE,
      });
      cohort.cohortKeys = keys;
      cohort.computeBeaconAddress();

      const tx = buildRecoverySpend({
        cohortKeys         : keys,
        recoverySecretKey  : secretKey,
        recoveryKey,
        recoverySequence   : RECOVERY_SEQUENCE,
        network            : 'bitcoin',
        utxo               : { txid: '33'.repeat(32), vout: 1, value: 50000n },
        destinationAddress : destination(),
        fee                : 300n,
      });
      // The spent output script must equal the cohort's beacon output script.
      const leaves = buildRecoveryLeaves(DEFAULT_FUNDING_MODEL, {
        recoveryKey, recoverySequence : RECOVERY_SEQUENCE, cohortKeys : keys, fallbackThreshold : cohort.effectiveFallbackThreshold,
      });
      const expectedScript = p2tr(cohort.internalKey, leaves, getNetwork('bitcoin'), true).script;
      expect(tx.getInput(0).witnessUtxo!.script).to.deep.equal(expectedScript);
    });

    it('rejects a recovery secret that does not match the committed recovery key', () => {
      const { recoveryKey } = freshRecovery();
      const wrong = SchnorrKeyPair.generate().secretKey.bytes;
      expect(() => buildRecoverySpend({
        cohortKeys         : cohortKeys(),
        recoverySecretKey  : wrong,
        recoveryKey,
        recoverySequence   : RECOVERY_SEQUENCE,
        network            : 'bitcoin',
        utxo               : { txid: '44'.repeat(32), vout: 0, value: 100000n },
        destinationAddress : destination(),
        fee                : 400n,
      })).to.throw(/RECOVERY_KEY_MISMATCH|does not correspond/);
    });

    it('rejects a fee that exceeds the UTXO value', () => {
      const { secretKey, recoveryKey } = freshRecovery();
      expect(() => buildRecoverySpend({
        cohortKeys         : cohortKeys(),
        recoverySecretKey  : secretKey,
        recoveryKey,
        recoverySequence   : RECOVERY_SEQUENCE,
        network            : 'bitcoin',
        utxo               : { txid: '55'.repeat(32), vout: 0, value: 1000n },
        destinationAddress : destination(),
        fee                : 1000n,
      })).to.throw(/FEE_EXCEEDS_VALUE|exceeds/);
    });

    it('rejects a recovered output below the dust limit', () => {
      const { secretKey, recoveryKey } = freshRecovery();
      expect(() => buildRecoverySpend({
        cohortKeys         : cohortKeys(),
        recoverySecretKey  : secretKey,
        recoveryKey,
        recoverySequence   : RECOVERY_SEQUENCE,
        network            : 'bitcoin',
        utxo               : { txid: '66'.repeat(32), vout: 0, value: 800n },
        destinationAddress : destination(),
        fee                : 400n, // out = 400, below the 546-sat dust floor
      })).to.throw(/DUST_OUTPUT|dust/);
    });

    it('rejects when the reconstructed address does not match the supplied beaconAddress', () => {
      const { secretKey, recoveryKey } = freshRecovery();
      expect(() => buildRecoverySpend({
        cohortKeys         : cohortKeys(),
        recoverySecretKey  : secretKey,
        recoveryKey,
        recoverySequence   : RECOVERY_SEQUENCE,
        network            : 'bitcoin',
        utxo               : { txid: '77'.repeat(32), vout: 0, value: 100000n },
        destinationAddress : destination(),
        fee                : 400n,
        beaconAddress      : 'bc1pwrongaddressthatdoesnotmatchanything0000000000000000000000',
      })).to.throw(/BEACON_ADDRESS_MISMATCH|does not match/);
    });

    it('produces a recovery signature valid for the recovery key over the script-path sighash', () => {
      const { secretKey, recoveryKey } = freshRecovery();
      const keys = cohortKeys();
      const value = 100000n;
      const tx = buildRecoverySpend({
        cohortKeys         : keys,
        recoverySecretKey  : secretKey,
        recoveryKey,
        recoverySequence   : RECOVERY_SEQUENCE,
        network            : 'bitcoin',
        utxo               : { txid: '88'.repeat(32), vout: 0, value },
        destinationAddress : destination(),
        fee                : 400n,
      });

      // Recompute the BIP-341 script-path sighash for the recovery leaf and verify
      // the finalized witness signature against the recovery key. A wrong leaf,
      // tweak, or signing path would fail this.
      const script = tx.getInput(0).witnessUtxo!.script;
      const recoveryScript = buildRecoveryScript({ recoveryKey, recoverySequence: RECOVERY_SEQUENCE });
      const sighash = tx.preimageWitnessV1(0, [script], SigHash.DEFAULT, [value], undefined, recoveryScript, 0xc0);
      const sig = tx.getInput(0).finalScriptWitness![0].slice(0, 64);
      expect(schnorr.verify(sig, sighash, recoveryKey)).to.be.true;
    });
  });
});
