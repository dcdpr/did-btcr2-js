// import * as btc from '@scure/btc-signer';
// import { hex } from '@scure/base';

import { Musig2Cohort } from '../../../src/index.js';


// const PubKey = hex.decode('0101010101010101010101010101010101010101010101010101010101010101');
// const PubKey2 = hex.decode('0202020202020202020202020202020202020202020202020202020202020202');
// const PubKey3 = hex.decode('1212121212121212121212121212121212121212121212121212121212121212');

// const trMusig = hex.encode(btc.p2tr_ns(3, [PubKey, PubKey2, PubKey3])[0].script);
// const script = '200101010101010101010101010101010101010101010101010101010101010101ad200202020202020202020202020202020202020202020202020202020202020202ad201212121212121212121212121212121212121212121212121212121212121212ac';

// console.log('trMusig === Script:', trMusig === script);

const cohort = new Musig2Cohort({
  id              : 'cohort-1',
  coordinatorDid  : 'did:example:coordinator',
  minParticipants : 3,
  status          : 'ADVERTISED',
  network         : 'testnet',
});

console.log('cohort.json()', cohort.json());