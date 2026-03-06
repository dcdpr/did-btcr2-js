import { bytesToHex } from '@noble/hashes/utils';
import { Identifier } from '../../../src/index.js';
import { Logger } from '@did-btcr2/common';
import data from '../../../tests/data/encode-data.js';

for(const {did, components} of data) {
  Logger.log('Encoding', components);
  const encoded = Identifier.encode(components);
  if(encoded !== did){
    console.log(`encoded ${encoded} !== did ${did}`);
  }

  Logger.log('Decoding', encoded);
  const {version, network, genesisBytes} = Identifier.decode(encoded);
  console.log('genesisBytes', genesisBytes);
  if(version !== components.version) {
    console.log(`decoded.version ${version} !== ${components.version}`);
  }
  if(network !== components.network) {
    console.log(`decoded.network ${network} === ${components.network}`);
  }

  if(bytesToHex(genesisBytes) !== bytesToHex(components.genesisBytes)) {
    console.log(`decoded.genesisBytes ${bytesToHex(genesisBytes)} !== ${bytesToHex(components.genesisBytes)}`);
  }
  console.log('\n--------------------------------------------------');
}