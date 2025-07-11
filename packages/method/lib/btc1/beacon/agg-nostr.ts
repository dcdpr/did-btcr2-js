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
const coordinator = new BeaconCoordinator(nostr);

const aliceSeed = await mnemonicToSeed(mnemonics.alice);
const aliceHDKey = HDKey.fromMasterSeed(aliceSeed);
const alice = new BeaconParticipant(aliceHDKey.privateKey!, nostr, 'alice');

const bobSeed = await mnemonicToSeed(mnemonics.bob);
const bobHDKey = HDKey.fromMasterSeed(bobSeed);
const bob = new BeaconParticipant(bobHDKey.privateKey!, nostr, 'bob');

const charlieSeed = await mnemonicToSeed(mnemonics.charlie);
const charlieHDKey = HDKey.fromMasterSeed(charlieSeed);
const charlie = new BeaconParticipant(charlieHDKey.privateKey!, nostr, 'charlie');

const dinaSeed = await mnemonicToSeed(mnemonics.dina);
const dinaHDKey = HDKey.fromMasterSeed(dinaSeed);
const dina = new BeaconParticipant(dinaHDKey.privateKey!, nostr, 'dina');

coordinator.start();
alice.start();
bob.start();
charlie.start();
dina.start();