import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { writeFile } from 'fs/promises';
import { DidBtcr2 } from '../../src/did-btcr2.js';

const kp = SchnorrKeyPair.generate();
const did = await DidBtcr2.create({
  idType       : 'KEY',
  genesisBytes : kp.publicKey.compressed,
  options      : { network: 'regtest' }
});
const resolution = await DidBtcr2.resolve(did);
const updateKp = SchnorrKeyPair.generate();

await writeFile('./data/regtest/initial-did-document.json', JSON.stringify(resolution.didDocument, null, 2), 'utf-8');
await writeFile('./data/regtest/initial-key-pair.json', JSON.stringify(kp.hex, null, 2), 'utf-8');
await writeFile('./data/regtest/update-key-pair.json', JSON.stringify(updateKp.hex, null, 2), 'utf-8');
