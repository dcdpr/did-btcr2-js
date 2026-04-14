/**
 * Aggregation Service — Standalone Process (Runner API)
 *
 * Runs an AggregationServiceRunner in its own process. Pairs with
 * `aggregation-participant.ts` running in separate terminals.
 *
 * Demonstrates production-realistic deployment: each actor runs independently,
 * unaware of other actors' processes, communicating only via the relay.
 *
 * Usage (in one terminal):
 *   RELAY=ws://localhost:7777 npx tsx lib/operations/aggregation/aggregation-service.ts
 *
 * Then in two more terminals (one per participant):
 *   RELAY=ws://localhost:7777 SERVICE_DID=<did from above> npx tsx lib/operations/aggregation/aggregation-participant.ts
 */
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { p2tr, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import {
  AggregationServiceRunner,
  DidBtcr2,
  NostrTransport,
} from '../../../src/index.js';

const RELAY = process.env.RELAY ?? 'ws://localhost:7777';
const MIN_PARTICIPANTS = Number(process.env.MIN_PARTICIPANTS ?? '2');

const serviceKeys = SchnorrKeyPair.fromSecret('cbd42da155c70d5a8806a1f68bfb802097e152f28230990d8e3c979e78e52d1d');
const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const transport = new NostrTransport({ relays: [RELAY] });
transport.registerActor(serviceDid, serviceKeys);
transport.start();

const service = new AggregationServiceRunner({
  transport,
  did     : serviceDid,
  keys    : serviceKeys,
  config  : { minParticipants: MIN_PARTICIPANTS, network: 'mutinynet', beaconType: 'CASBeacon' },

  // Auto-accept all opt-ins (default behavior — explicit here for clarity)
  onOptInReceived : async () => ({ accepted: true }),

  // Build a dummy P2TR transaction (in production: query Bitcoin for UTXO + build tx)
  onProvideTxData : async ({ beaconAddress }) => {
    void beaconAddress;
    const cohort = service.session.cohorts[0];
    const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
    const payment = p2tr(aggPk);
    const prevOutValue = 100000n;
    const tx = new Transaction({ version: 2 });
    tx.addInput({
      txid        : '00'.repeat(32),
      index       : 0,
      witnessUtxo : { amount: prevOutValue, script: payment.script },
    });
    tx.addOutput({ script: payment.script, amount: prevOutValue - 500n });
    return { tx, prevOutScripts: [payment.script], prevOutValues: [prevOutValue] };
  },
});

service.on('cohort-advertised', ({ cohortId }) => console.log(`[advertised] ${cohortId}`));
service.on('opt-in-received', (optIn) => console.log(`[opt-in] ${optIn.participantDid}`));
service.on('participant-accepted', ({ participantDid }) => console.log(`[accepted] ${participantDid}`));
service.on('keygen-complete', ({ beaconAddress }) => console.log(`[keygen] ${beaconAddress}`));
service.on('update-received', ({ participantDid }) => console.log(`[update] from ${participantDid}`));
service.on('data-distributed', () => console.log('[distributed]'));
service.on('validation-received', ({ participantDid, approved }) => console.log(`[validation] ${participantDid} ${approved ? 'approved' : 'rejected'}`));
service.on('signing-complete', ({ signature }) => console.log(`[signed] ${bytesToHex(signature)}`));
service.on('error', (err) => console.error('[error]', err.message));

console.log('══ Aggregation Service ══');
console.log('Service DID:', serviceDid);
console.log('Relay:', RELAY);
console.log('Min participants:', MIN_PARTICIPANTS);
console.log('');
console.log('Run participants in other terminals with:');
console.log(`  RELAY=${RELAY} SERVICE_DID=${serviceDid} npx tsx lib/operations/aggregation/aggregation-participant.ts`);
console.log('');
console.log('Waiting for participants...\n');

const result = await service.run();

console.log('\n══ COMPLETE ══');
console.log('Final signature:', bytesToHex(result.signature));
console.log('Beacon address:', service.session.getCohort(result.cohortId)!.beaconAddress);

process.exit(0);
