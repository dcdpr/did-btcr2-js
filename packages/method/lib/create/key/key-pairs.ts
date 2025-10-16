import { KeyPairUtils } from '@did-btcr2/keypair';
import { writeFile } from 'fs/promises';
import path from 'path';

const cwd = process.cwd();
const network = process.argv.slice(2)[0] || 'regtest';
const latestdir = `${cwd}/data/${network}/latest`;
console.log(`Generating keys for ${network} ...`);

const genesisKey = KeyPairUtils.generate();
const replacementKey = KeyPairUtils.generate();

const keys = {
  genesisKey : {
    sk : genesisKey.privateKey.hex,
    pk : genesisKey.publicKey.hex,
  },
  tbd : {
    sk : replacementKey.privateKey.hex,
    pk : replacementKey.publicKey.hex,
  }
};
const keysPath = path.join(latestdir, 'keys.json');
await writeFile(keysPath, JSON.stringify(keys, null, 4), { encoding: 'utf-8' });
console.log(`Created keys: ${keysPath}`);