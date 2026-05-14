
import { Identifier } from '../../../src/index.js';

const xdid = 'did:btcr2:x1q20n602dgh7awm6akhgne0mjcmfpnjpc9jrqnrzuuexglrmklzm6u98hgvp';
const xdecoded = Identifier.decode(xdid);
console.log('xdecoded:', xdecoded);

const kdid = 'did:btcr2:k1q5ppmnfjqp0qe5klmnll9tazz9jd5ds43x5xfsr3hu9jdgaldu0d3jgs0vj4r';
const kdecoded = Identifier.decode(kdid);
console.log('kdecoded:', kdecoded);