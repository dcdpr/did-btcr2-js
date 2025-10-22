import { NostrAdapter } from "../../src/core/beacons/aggregation/communication/adapter/nostr.js";
import { BeaconCoordinator } from "../../src/core/beacons/aggregation/coordinator.js";


const coordinatorDid = 'did:btc1:k1q5ptw8fs2twdezay2epc39ytv4d432487d6f0mclexyzn7gertwglpgkugx8t'
const coordinatiorKeys = {
  public: new Uint8Array([
      183,  29,  48,  82, 220, 220, 139,
    164,  86,  67, 136, 148, 139, 101,  91,
     88, 170, 167, 243, 116, 151, 239,  31,
    201, 136,  41, 249,  25,  26, 220, 143,
    133
  ]),
  secret: new Uint8Array([
    164, 141, 217, 43,  37,  19, 189,  15,
    122, 124, 145, 80, 186, 161, 126,  49,
    104,  57, 139, 80,  67, 104, 120,  33,
    210, 148,  41, 23, 169,  10,  11, 208
  ])
}
const nostr = new NostrAdapter();
console.log('nostr', nostr);
const coordinator = new BeaconCoordinator({
  keys: coordinatiorKeys,
  protocol: nostr,
  did: coordinatorDid,
  name: 'charlie'
});
console.log('coordinator', coordinator);

// Setup the coordinator
coordinator.start();

// Announce the cohort
// const cohort = await coordinator.advertiseCohort(4)
// console.log(`Cohort announced with ID: ${cohort.id}`, cohort);

// Start the coordinator and participants listening for events