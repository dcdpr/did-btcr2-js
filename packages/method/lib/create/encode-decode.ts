import { bytesToHex } from '@noble/hashes/utils';
import { Identifier } from '../../src/index.js';

import { Logger } from '@did-btcr2/common';

for(const {did, identifierComponents: idcomps} of vectors) {
  Logger.log('Encoding', idcomps);
  const encoded = Identifier.encode(idcomps);
  if(encoded !== did){
    console.log(`encoded ${encoded} !== did ${did}`);
  }

  Logger.log('Decoding', encoded);
  const {version, network, genesisBytes} = Identifier.decode(encoded);
  console.log('genesisBytes', genesisBytes);
  if(version !== idcomps.version) {
    console.log(`decoded.version ${version} !== ${idcomps.version}`);
  }
  if(network !== idcomps.network) {
    console.log(`decoded.network ${network} === ${idcomps.network}`);
  }

  if(bytesToHex(genesisBytes) !== bytesToHex(idcomps.genesisBytes)) {
    console.log(`decoded.genesisBytes ${bytesToHex(genesisBytes)} !== ${bytesToHex(idcomps.genesisBytes)}`);
  }
  console.log('\n--------------------------------------------------');
}