import { bytesToHex } from '@noble/hashes/utils';
import { Identifier } from '../../../src/index.js';

const genesisBytes = Buffer.from('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000', 'hex');
const components = {
  idType  : 'KEY',
  version : 1,
  network : 'regtest'
};

const did = Identifier.encode(genesisBytes, components);

console.log('DID:', did);

const components2 = Identifier.decode(did);
const result = {
  ...components2,
  genesisBytes : bytesToHex(components2.genesisBytes)
};
console.log('result:', result);