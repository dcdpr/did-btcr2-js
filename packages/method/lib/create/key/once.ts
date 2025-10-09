import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2 } from '../../../src/did-btcr2.js';

const kp = SchnorrKeyPair.generate();
// for(const network of ['bitcoin', 'signet', 'regtest', 'testnet3', 'testnet4', 'mutinynet']) {

//     await writeFile(`./data/${network}-k.json`, JSON.stringify(data, null, 2));
// }
const did = await DidBtcr2.create({
  idType       : 'KEY',
  genesisBytes : kp.publicKey.compressed,
  options      : { version: 1, network: 'bitcoin' }
});
const data = { did, keyPair: kp.hex };

console.log(data);