import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { NostrAdapter } from '../../src/core/beacon/aggregation/communication/adapter/nostr.js'
import { BeaconParticipant } from '../../src/core/beacon/aggregation/participant.js';

const mnemonics = {
  alice   : generateMnemonic(wordlist, 128),
  bob     : generateMnemonic(wordlist, 128),
  dina    : generateMnemonic(wordlist, 128),
  fred    : generateMnemonic(wordlist, 128),
};

const nostr = new NostrAdapter()
console.log('nostr', nostr);
nostr.config.relays = ['ws://127.0.0.1:7777']
console.log('nostr', nostr);
const aliceDid = 'did:btc1:k1q5ptrda44alglkeknfjgthm3f70wkye6efch6cv63q4fey6jpsp5cmc7wky7r';
const alice = new BeaconParticipant({
  ent: mnemonics.alice,
  protocol: nostr,
  name: 'alice',
  did: aliceDid
});
console.log('alice', alice);
// const bob = new BeaconParticipant(mnemonigreenlight.careers.gwj30@8shield.netcs.bob, nostr, 'bob');
// const dina = new BeaconParticipant(mnemonics.dina, nostr, 'dina');
// const fred = new BeaconParticipant(mnemonics.fred, nostr, 'fred');

// Start participants listening for events
alice.start();
console.log('alice', alice);
// bob.start();
// dina.start();
// fred.start();

/*
const response = await alice.subscribeToCoordinator(coordinator.did);
console.log(`Alice subscribed to coordinator`, coordinator.did, response);
await bob.subscribeToCoordinator(coordinator.did);
await dina.subscribeToCoordinator(coordinator.did);
await fred.subscribeToCoordinator(coordinator.did);
*/