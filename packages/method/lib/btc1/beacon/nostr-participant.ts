import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { BeaconParticipant, NostrAdapter } from '../../../src/index.js';

const mnemonics = {
  alice   : generateMnemonic(wordlist, 128),
  bob     : generateMnemonic(wordlist, 128),
  charlie : generateMnemonic(wordlist, 128),
  dina    : generateMnemonic(wordlist, 128),
};

const nostr = new NostrAdapter();
nostr.config.relays = ['ws://127.0.0.1:7777']

const alice = new BeaconParticipant(mnemonics.alice, nostr, 'alice');
const bob = new BeaconParticipant(mnemonics.bob, nostr, 'bob');
const charlie = new BeaconParticipant(mnemonics.charlie, nostr, 'charlie');
const dina = new BeaconParticipant(mnemonics.dina, nostr, 'dina');

// Setup the participants
alice.setup();
bob.setup();
charlie.setup();
dina.setup();

// Start participants listening for events
alice.start();
bob.start();
charlie.start();
dina.start();

const response = await alice.subscribeToCoordinator('coordinator.did');
/*
const response = await alice.subscribeToCoordinator(coordinator.did);
console.log(`Alice subscribed to coordinator`, coordinator.did, response);
await bob.subscribeToCoordinator(coordinator.did);
await charlie.subscribeToCoordinator(coordinator.did);
await dina.subscribeToCoordinator(coordinator.did);
*/