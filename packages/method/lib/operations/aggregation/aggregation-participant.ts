/**
 * Aggregation Participant — Standalone Process (Runner API)
 *
 * Runs an AggregationParticipantRunner in its own process. Pairs with
 * `aggregation-service.ts` running in another terminal.
 *
 * Uses the convenience static helper {@link AggregationParticipantRunner.joinFirst}
 * to wait for the first matching cohort, drive it to completion, and exit.
 *
 * Usage:
 *   RELAY=ws://localhost:7777 SERVICE_DID=<did> npx tsx lib/operations/aggregation/aggregation-participant.ts
 */
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import {
  AggregationParticipantRunner,
  DidBtcr2,
  NostrTransport,
  Resolver,
  Updater,
} from '../../../src/index.js';

const RELAY = process.env.RELAY ?? 'ws://localhost:7777';
const SERVICE_DID = process.env.SERVICE_DID;

if(!SERVICE_DID) {
  console.error('SERVICE_DID env var is required. Run aggregation-service.ts first and copy the DID.');
  process.exit(1);
}

const myKeys = SchnorrKeyPair.generate();
const myDid = DidBtcr2.create(myKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const transport = new NostrTransport({ relays: [RELAY] });
transport.registerActor(myDid, myKeys);
transport.start();

console.log('══ Aggregation Participant ══');
console.log('My DID:', myDid);
console.log('Service DID:', SERVICE_DID);
console.log('Relay:', RELAY);
console.log('\nWaiting for cohort advert...\n');

const result = await AggregationParticipantRunner.joinFirst({
  transport,
  did  : myDid,
  keys : myKeys,

  // Filter: only join cohorts from the configured service
  shouldJoin : async (advert) => {
    if(advert.serviceDid !== SERVICE_DID) return false;
    console.log(`[discovered] ${advert.cohortId}`);
    return true;
  },

  // Build a signed update that adds the cohort's beacon address as a CASBeacon service
  onProvideUpdate : async ({ beaconAddress }) => {
    console.log(`[joined] beacon address: ${beaconAddress}`);
    const doc = Resolver.deterministic({
      genesisBytes : myKeys.publicKey.compressed,
      hrp          : 'k',
      idType       : 'KEY',
      version      : 1,
      network      : 'mutinynet',
    });
    const vm = doc.verificationMethod![0];
    const unsigned = Updater.construct(doc, [{
      op    : 'add', path  : '/service/-', value : {
        id              : `${myDid}#beacon-cas`,
        type            : 'CASBeacon',
        serviceEndpoint : `bitcoin:${beaconAddress}`,
      }
    }], 1);
    return Updater.sign(myDid, unsigned, vm, myKeys.raw.secret!);
  },
});

console.log('\n══ COMPLETE ══');
console.log('Beacon address (add to DID document as CASBeacon serviceEndpoint):');
console.log(`  bitcoin:${result.beaconAddress}`);
console.log('My DID:', myDid);
console.log('My pubkey:', bytesToHex(myKeys.publicKey.compressed));

process.exit(0);
