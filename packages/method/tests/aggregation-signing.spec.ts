import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { p2tr, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import { expect } from 'chai';
import {
  AggregationCohort,
  BeaconSigningSession,
} from '../src/index.js';

function buildDummyTx(outputScript: Uint8Array, prevOutValue: bigint): Transaction {
  const tx = new Transaction({ version: 2 });
  tx.addInput({
    txid        : '00'.repeat(32),
    index       : 0,
    witnessUtxo : { amount: prevOutValue, script: outputScript },
  });
  tx.addOutput({ script: outputScript, amount: prevOutValue - 500n });
  return tx;
}

describe('Aggregation signing regressions', () => {

  describe('T1.4: secretNonce zeroization', () => {
    it('clears secretNonce after generatePartialSignature', () => {
      const kp1 = SchnorrKeyPair.generate();
      const kp2 = SchnorrKeyPair.generate();
      const cohort = new AggregationCohort({ minParticipants: 2, network: 'mainnet' });
      cohort.participants.push('did:btcr2:alice', 'did:btcr2:bob');
      cohort.participantKeys.set('did:btcr2:alice', kp1.publicKey.compressed);
      cohort.participantKeys.set('did:btcr2:bob', kp2.publicKey.compressed);
      cohort.cohortKeys = [kp1.publicKey.compressed, kp2.publicKey.compressed];
      cohort.computeBeaconAddress();

      const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
      const payment = p2tr(aggPk);
      const tx = buildDummyTx(payment.script, 100000n);

      // Drive a single participant session through sign()
      const p1 = new BeaconSigningSession({
        cohort,
        pendingTx      : tx,
        prevOutScripts : [payment.script],
        prevOutValues  : [100000n],
      });
      const p2 = new BeaconSigningSession({
        cohort,
        pendingTx      : tx,
        prevOutScripts : [payment.script],
        prevOutValues  : [100000n],
      });
      p1.generateNonceContribution(kp1.publicKey.compressed, kp1.secretKey.bytes);
      expect(p1.secretNonce).to.be.instanceOf(Uint8Array);

      // Fake an aggregated nonce so generatePartialSignature can run
      const nonce1 = p1.generateNonceContribution(kp1.publicKey.compressed, kp1.secretKey.bytes);
      const nonce2 = p2.generateNonceContribution(kp2.publicKey.compressed, kp2.secretKey.bytes);
      const agg = musig2.nonceAggregate([nonce1, nonce2]);
      p1.aggregatedNonce = agg;

      p1.generatePartialSignature(kp1.secretKey.bytes);
      expect(p1.secretNonce).to.be.undefined;
    });
  });

  describe('T3.2: partial-sig pre-verification', () => {
    it('generateFinalSignature throws BAD_PARTIAL_SIG on a corrupted contribution', () => {
      const kp1 = SchnorrKeyPair.generate();
      const kp2 = SchnorrKeyPair.generate();
      const cohort = new AggregationCohort({ minParticipants: 2, network: 'mainnet' });
      cohort.participants.push('did:btcr2:alice', 'did:btcr2:bob');
      cohort.participantKeys.set('did:btcr2:alice', kp1.publicKey.compressed);
      cohort.participantKeys.set('did:btcr2:bob', kp2.publicKey.compressed);
      cohort.cohortKeys = [kp1.publicKey.compressed, kp2.publicKey.compressed];
      cohort.computeBeaconAddress();

      const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
      const payment = p2tr(aggPk);
      const tx = buildDummyTx(payment.script, 100000n);

      const service = new BeaconSigningSession({
        cohort,
        pendingTx      : tx,
        prevOutScripts : [payment.script],
        prevOutValues  : [100000n],
      });
      const p1 = new BeaconSigningSession({
        cohort,
        pendingTx      : tx,
        prevOutScripts : [payment.script],
        prevOutValues  : [100000n],
      });
      const p2 = new BeaconSigningSession({
        cohort,
        pendingTx      : tx,
        prevOutScripts : [payment.script],
        prevOutValues  : [100000n],
      });
      const n1 = p1.generateNonceContribution(kp1.publicKey.compressed, kp1.secretKey.bytes);
      const n2 = p2.generateNonceContribution(kp2.publicKey.compressed, kp2.secretKey.bytes);

      service.addNonceContribution('did:btcr2:alice', n1);
      service.addNonceContribution('did:btcr2:bob',   n2);
      const agg = service.generateAggregatedNonce();
      p1.aggregatedNonce = agg;
      p2.aggregatedNonce = agg;

      const goodSig = p1.generatePartialSignature(kp1.secretKey.bytes);
      const goodSig2 = p2.generatePartialSignature(kp2.secretKey.bytes);

      // Corrupt Alice's partial signature
      const badSig = new Uint8Array(goodSig);
      badSig[0] ^= 0xff;

      service.addPartialSignature('did:btcr2:alice', badSig);
      service.addPartialSignature('did:btcr2:bob',   goodSig2);

      expect(() => service.generateFinalSignature()).to.throw(/Bad partial signature from did:btcr2:alice|BAD_PARTIAL_SIG/);
    });
  });
});
