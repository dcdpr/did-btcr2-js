import { bytesToHex } from '@noble/hashes/utils';
import { Identifier } from '../../../src/index.js';
import data from '../../../tests/data/encode-data.js';

for(const {did, genesisBytes, options} of data) {
  console.log('Encoding', options);
  const encoded = Identifier.encode(genesisBytes, options);
  if(encoded !== did){
    console.log(`encoded ${encoded} !== did ${did}`);
  }

  console.log('Decoding', encoded);
  const response = Identifier.decode(encoded);
  console.log('genesisBytes', genesisBytes);
  if(response.version !== options.version) {
    console.log(`decoded.version ${response.version} !== ${options.version}`);
  }
  if(response.network !== options.network) {
    console.log(`decoded.network ${response.network} === ${options.network}`);
  }

  if(bytesToHex(genesisBytes) !== bytesToHex(response.genesisBytes)) {
    console.log(`decoded.genesisBytes ${bytesToHex(genesisBytes)} !== ${bytesToHex(response.genesisBytes)}`);
  }
  console.log('\n--------------------------------------------------');
}