import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { BeaconCoordinator, BeaconParticipant, NostrAdapter } from '../../../src/index.js';

const mnemonics = {
  alice   : generateMnemonic(wordlist, 128),
  // bob     : generateMnemonic(wordlist, 128),
  // charlie : generateMnemonic(wordlist, 128),
  // dina    : generateMnemonic(wordlist, 128),
};

const nostr = new NostrAdapter();
const coordinator = new BeaconCoordinator(nostr, 'fred');

const alice = new BeaconParticipant(mnemonics.alice, nostr, 'alice');
// const bob = new BeaconParticipant(mnemonics.bob, nostr, 'bob');
// const charlie = new BeaconParticipant(mnemonics.charlie, nostr, 'charlie');
// const dina = new BeaconParticipant(mnemonics.dina, nostr, 'dina');

// Setup the coordinator
coordinator.setup();

// Setup the participants
alice.setup();
// bob.setup();
// charlie.setup();
// dina.setup();

// Subscribe participants to the coordinator
await alice.subscribeToCoordinator(coordinator.did);
// await bob.subscribeToCoordinator(coordinator.did);
// await charlie.subscribeToCoordinator(coordinator.did);
// await dina.subscribeToCoordinator(coordinator.did);

// Announce the cohort
await coordinator.announceNewCohort(4)

// Start the coordinator and participants listening for events
coordinator.start();
alice.start();
// bob.start();
// charlie.start();
// dina.start();