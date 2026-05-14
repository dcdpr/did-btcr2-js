import { Identifier } from '../../../src/index.js';

const networks = ['bitcoin', 'mutinynet', 'regtest', 'signet', 'testnet3', 'testnet4'];

const kdata = [];
for(const network of networks) {
  const genesisBytes = Buffer.from('02cb42563b126085e1fea427331583bd69ed87057ea9524a6221272469c8d4c000', 'hex');
  const components = {
    idType       : 'KEY',
    version      : 1,
    network
  };
  const did = Identifier.encode(genesisBytes, components);
  kdata.push({ did, components });
}

const xdata = [];
for(const network of networks) {
  const genesisBytes = Buffer.from('be0db3aeee89da24d50112af74f40c6a27f84fd3ef1a280647f5448f4daf11b1', 'hex');
  const components = {
    idType       : 'EXTERNAL',
    version      : 1,
    network
  };
  const did = Identifier.encode(genesisBytes, components);
  xdata.push({ did, components });
}
console.log('kdata', kdata);
console.log('xdata', xdata);