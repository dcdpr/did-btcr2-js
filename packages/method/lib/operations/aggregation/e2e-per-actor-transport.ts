/**
 * E2E Demo: Per-Actor Nostr Transports (Runner API)
 *
 * Demonstrates the full Aggregate Beacon protocol with each actor running its
 * own NostrTransport instance, all in one process, all connecting to the same
 * relay. Uses the Runner API for clean orchestration.
 *
 * Requires a running Nostr relay (default: ws://localhost:7777).
 *
 * Usage:
 *   RELAY=ws://localhost:7777 npx tsx lib/operations/aggregation/e2e-per-actor-transport.ts
 */
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { p2tr, Transaction } from '@scure/btc-signer';
import * as musig2 from '@scure/btc-signer/musig2';
import type {
  Transport} from '../../../src/index.js';
import {
  AggregationParticipantRunner,
  AggregationServiceRunner,
  DidBtcr2,
  NostrTransport,
  Resolver,
  Updater,
} from '../../../src/index.js';

const RELAY = process.env.RELAY ?? 'ws://localhost:7777';

const serviceKeys = SchnorrKeyPair.generate();
const serviceDid = DidBtcr2.create(serviceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const aliceKeys = SchnorrKeyPair.generate();
const aliceDid = DidBtcr2.create(aliceKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const bobKeys = SchnorrKeyPair.generate();
const bobDid = DidBtcr2.create(bobKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const serviceTransport = new NostrTransport({ relays: [RELAY] });
const aliceTransport = new NostrTransport({ relays: [RELAY] });
const bobTransport = new NostrTransport({ relays: [RELAY] });

serviceTransport.registerActor(serviceDid, serviceKeys);
aliceTransport.registerActor(aliceDid, aliceKeys);
bobTransport.registerActor(bobDid, bobKeys);

serviceTransport.start();
aliceTransport.start();
bobTransport.start();

// Pre-register peer keys (in production, exchanged via the protocol's COHORT_ADVERT/OPT_IN handshake)
serviceTransport.registerPeer(aliceDid, aliceKeys.publicKey.compressed);
serviceTransport.registerPeer(bobDid, bobKeys.publicKey.compressed);
aliceTransport.registerPeer(serviceDid, serviceKeys.publicKey.compressed);
bobTransport.registerPeer(serviceDid, serviceKeys.publicKey.compressed);

function buildSignedUpdate(did: string, kp: SchnorrKeyPair, beaconAddress: string) {
  const doc = Resolver.deterministic({
    genesisBytes : kp.publicKey.compressed,
    hrp          : 'k',
    idType       : 'KEY',
    version      : 1,
    network      : 'mutinynet',
  });
  const vm = doc.verificationMethod![0];
  const unsigned = Updater.construct(doc, [{
    op    : 'add', path  : '/service/-', value : {
      id              : `${did}#beacon-cas`,
      type            : 'CASBeacon',
      serviceEndpoint : `bitcoin:${beaconAddress}`,
    }
  }], 1);
  return Updater.sign(did, unsigned, vm, kp.raw.secret!);
}

const service = new AggregationServiceRunner({
  transport : serviceTransport,
  did       : serviceDid,
  keys      : serviceKeys,
  config    : { minParticipants: 2, network: 'mutinynet', beaconType: 'CASBeacon' },

  onProvideTxData : async () => {
    const cohort = service.session.getCohort(service.session.cohorts[0].id)!;
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

service.on('cohort-advertised', ({ cohortId }) => console.log(`[service] cohort ${cohortId} advertised`));
service.on('opt-in-received', (optIn) => console.log(`[service] opt-in from ${optIn.participantDid}`));
service.on('keygen-complete', ({ beaconAddress }) => console.log(`[service] keygen complete: ${beaconAddress}`));
service.on('signing-complete', ({ signature }) => console.log(`[service] signature: ${bytesToHex(signature)}`));
service.on('error', (err) => console.error('[service] error:', err.message));

function makeParticipantRunner(name: string, did: string, keys: SchnorrKeyPair, transport: Transport) {
  const runner = new AggregationParticipantRunner({
    transport,
    did,
    keys,
    shouldJoin      : async () => true,
    onProvideUpdate : async ({ beaconAddress }) => buildSignedUpdate(did, keys, beaconAddress),
  });

  runner.on('cohort-discovered', (advert) => console.log(`[${name}] discovered cohort ${advert.cohortId}`));
  runner.on('cohort-joined', () => console.log(`[${name}] joined`));
  runner.on('cohort-ready', ({ beaconAddress }) => console.log(`[${name}] ready: ${beaconAddress}`));
  runner.on('cohort-complete', ({ beaconAddress }) => console.log(`[${name}] complete: ${beaconAddress}`));
  runner.on('error', (err) => console.error(`[${name}] error:`, err.message));

  return runner;
}

const alice = makeParticipantRunner('alice', aliceDid, aliceKeys, aliceTransport);
const bob = makeParticipantRunner('bob', bobDid, bobKeys, bobTransport);

console.log(`\n══ Connecting to relay: ${RELAY} ══\n`);

await alice.start();
await bob.start();
const result = await service.run();

console.log('\n══ Result ══');
console.log(`Beacon address: ${service.session.getCohort(result.cohortId)!.beaconAddress}`);
console.log(`Signature: ${bytesToHex(result.signature)}`);

process.exit(0);
