import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeed } from '@scure/bip39';
import { BeaconCoordinator, BeaconParticipant, NostrAdapter } from '../../../src/index.js';
import { wordlist } from '@scure/bip39/wordlists/english';

const mnemonics = {
  alice   : generateMnemonic(wordlist, 128),
  bob     : generateMnemonic(wordlist, 128),
  charlie : generateMnemonic(wordlist, 128),
  dina    : generateMnemonic(wordlist, 128),
};

const nostr = new NostrAdapter();
const coordinator = new BeaconCoordinator(nostr, 'fred');

const aliceSeed = await mnemonicToSeed(mnemonics.alice);
const aliceHDKey = HDKey.fromMasterSeed(aliceSeed);
const alice = new BeaconParticipant(aliceHDKey.privateExtendedKey, nostr, 'alice');

// const bobSeed = await mnemonicToSeed(mnemonics.bob);
// const bobHDKey = HDKey.fromMasterSeed(bobSeed);
// const bob = new BeaconParticipant(bobHDKey.privateExtendedKey, nostr, 'bob');

// const charlieSeed = await mnemonicToSeed(mnemonics.charlie);
// const charlieHDKey = HDKey.fromMasterSeed(charlieSeed);
// const charlie = new BeaconParticipant(charlieHDKey.privateExtendedKey, nostr, 'charlie');

// const dinaSeed = await mnemonicToSeed(mnemonics.dina);
// const dinaHDKey = HDKey.fromMasterSeed(dinaSeed);
// const dina = new BeaconParticipant(dinaHDKey.privateExtendedKey, nostr, 'dina');

// Setup the coordinator
coordinator.setup();

// Setup the participants
alice.setup();
// bob.setup();
// charlie.setup();
// dina.setup();

// Subscribe participants to the coordinator
// await alice.subscribeToCoordinator(coordinator.did);
// await bob.subscribeToCoordinator(coordinator.did);
// await charlie.subscribeToCoordinator(coordinator.did);
// await dina.subscribeToCoordinator(coordinator.did);

// Announce the cohort
// await coordinator.announceNewCohort(4)

// Start the coordinator and participants listening for events
coordinator.start();
alice.start();
// bob.start();
// charlie.start();
// dina.start();