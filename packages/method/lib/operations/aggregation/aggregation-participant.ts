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
 * sk0: e2eff26f785dad3a906aa8f783c33cf7b100d57307d2d5a9ce68e21fb94ad4fd
 * sk1: b63f58809f3f3dba7e5718ea08495b9d40ea9fd5fc498f9e0702c83c4669a4f2
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
const SECRET_KEY = process.env.SECRET_KEY;

if(!SERVICE_DID) {
  console.error('SERVICE_DID env var is required. Run aggregation-service.ts first and copy the DID.');
  process.exit(1);
}

if(!SECRET_KEY) {
  console.error('SECRET_KEY env var is required. Generate a random 32-byte hex string (e.g. `openssl rand -hex 32`) and set it to a unique value for each participant.');
  process.exit(1);
}
const myKeys = SchnorrKeyPair.fromSecret(SECRET_KEY);
const myDid = DidBtcr2.create(myKeys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });

const transport = new NostrTransport({ relays: [RELAY] });
transport.registerActor(myDid, myKeys);
transport.start();

console.log('══ Aggregation Participant ══');
console.log('My DID:', myDid);
console.log('Service DID:', SERVICE_DID);
console.log('Relay:', RELAY);
console.log('\nWaiting for cohort advert...\n');

const participant = new AggregationParticipantRunner({
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
participant.once('cohort-complete', (result) => {
  participant.stop();
  console.log('\n══ COMPLETE ══');
  console.log('Beacon address (add to DID document as CASBeacon serviceEndpoint):');
  console.log(`  bitcoin:${result.beaconAddress}`);
  console.log('My DID:', myDid);
  console.log('My pubkey:', bytesToHex(myKeys.publicKey.compressed));

  // Persist the cohort's sidecar data — required for future DID resolution.
  // For CAS beacons this is the DID → update-hash map that anchors the aggregated
  // announcement; for SMT beacons it is this participant's Merkle inclusion proof.
  if(result.casAnnouncement) {
    console.log('\nCAS Announcement (keep as sidecar data):');
    console.log(JSON.stringify(result.casAnnouncement, null, 2));
  }
  if(result.smtProof) {
    console.log('\nSMT Proof (keep as sidecar data):');
    console.log(JSON.stringify(result.smtProof, null, 2));
  }

  process.exit(0);
});
participant.on('error', (err) => console.error('[error]', err.message));
participant.start();
