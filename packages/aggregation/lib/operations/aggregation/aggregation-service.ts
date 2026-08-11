import { DidBtcr2, resolveBtcr2SenderPk } from '@did-btcr2/method';
/**
 * Aggregation Service - Standalone Process (Runner API)
 *
 * Runs an AggregationServiceRunner in its own process. Pairs with
 * `aggregation-participant.ts` running in separate terminals.
 *
 * Demonstrates production-realistic deployment: each actor runs independently,
 * unaware of other actors' processes, communicating only via the relay.
 *
 * Usage (in one terminal):
 *   RELAY=ws://localhost:7777 bun lib/operations/aggregation/aggregation-service.ts
 *
 * Then in two more terminals (one per participant):
 *   RELAY=ws://localhost:7777 SERVICE_DID=<did from above> bun lib/operations/aggregation/aggregation-participant.ts
 */
import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { Address, OutScript, Script, Transaction } from '@scure/btc-signer';
import {
  AggregationServiceRunner,
  NostrTransport,
} from '../../../src/index.js';

const RELAY = process.env.RELAY ?? 'ws://localhost:7777';
const MIN_PARTICIPANTS = Number(process.env.MIN_PARTICIPANTS ?? '2');
const NETWORK = getNetwork('mutinynet');

const serviceKeys = SchnorrKeyPair.fromSecret('cbd42da155c70d5a8806a1f68bfb802097e152f28230990d8e3c979e78e52d1d');
const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

// resolveSenderPk authenticates opt-in senders from their DIDs, so participants
// need no out-of-band key registration for discovery to bootstrap.
const transport = new NostrTransport({ relays: [RELAY], resolveSenderPk: resolveBtcr2SenderPk });
transport.registerActor(serviceDid, serviceKeys);
transport.start();

const service = new AggregationServiceRunner({
  transport,
  did     : serviceDid,
  keys    : serviceKeys,
  config  : { minParticipants: MIN_PARTICIPANTS, network: 'mutinynet', beaconType: 'CASBeacon', recoveryKey: bytesToHex(serviceKeys.publicKey.compressed.slice(1)), recoverySequence: 144 },

  // Auto-accept all opt-ins (default behavior, explicit here for clarity)
  onOptInReceived : async () => ({ accepted: true }),

  // Build a dummy beacon announcement tx (in production: query Bitcoin for the
  // cohort's funded UTXO and build from it). Participants verify the shape, so
  // the tx must spend the script-tree beacon output (the funded address's
  // scriptPubKey, NOT a tree-less p2tr of the aggregate key), return
  // self-change to the beacon script above the dust floor, and carry the
  // cohort's signal in a single zero-value OP_RETURN.
  onProvideTxData : async ({ cohortId, signalBytes }) => {
    const cohort = service.session.getCohort(cohortId)!;
    const script = OutScript.encode(Address(NETWORK).decode(cohort.beaconAddress));
    const prevOutValue = 100000n;
    const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
    tx.addInput({
      txid           : '00'.repeat(32),
      index          : 0,
      witnessUtxo    : { amount: prevOutValue, script },
      tapInternalKey : cohort.internalKey,
    });
    tx.addOutput({ script, amount: prevOutValue - 500n });
    tx.addOutput({ script: Script.encode(['RETURN', signalBytes]), amount: 0n });
    return { tx, prevOutScripts: [script], prevOutValues: [prevOutValue] };
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
console.log(`  RELAY=${RELAY} SERVICE_DID=${serviceDid} bun lib/operations/aggregation/aggregation-participant.ts`);
console.log('');
console.log('Waiting for participants...\n');

const result = await service.run();

console.log('\n══ COMPLETE ══');
console.log('Final signature:', bytesToHex(result.signature));
console.log('Beacon address:', service.session.getCohort(result.cohortId)!.beaconAddress);
console.log('Signed transaction:', bytesToHex(result.signedTx.toBytes()));
process.exit(0);
