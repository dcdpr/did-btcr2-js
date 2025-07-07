import { Musig2Cohort } from '../../../src/index.js';
const cohortKey = [new Uint8Array([
  3, 230,  27,  10, 255, 139, 156, 184,
  201, 255, 160, 158, 108,  93,  82, 141,
  62, 163, 106, 244, 149,  30, 206,  28,
  244,  84,  37, 214, 170, 179, 255, 101,
  251
]),
new Uint8Array([
  2, 109, 132,  71, 154, 250, 102,  73,
  206, 144, 112,  42,  34,  65, 238, 171,
  2, 181, 124, 254, 120, 117, 240, 253,
  20,  49,  72, 180, 245,   8, 157, 161,
  182
]),
new Uint8Array([
  2,  88,  94, 151,  13, 189,  23, 124,
  241, 132, 176,  29, 251,  59, 251,  42,
  50, 253, 116, 214,  91, 155,  82,  45,
  133, 120, 100, 229, 112,  52, 220,  86,
  136
])];
const cohort = new Musig2Cohort({
  id              : 'cohort-1',
  coordinatorDid  : 'did:example:coordinator',
  minParticipants : 3,
  status          : 'ADVERTISED',
  network         : 'testnet',
});
console.log('cohort.json()', cohort.json());
cohort.cohortKeys = cohortKey;
const beaconAddr = cohort.calulateBeaconAddress();
console.log(beaconAddr);
