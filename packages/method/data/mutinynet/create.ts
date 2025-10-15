import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { writeFile } from 'fs/promises';
import { DidBtcr2 } from '../../src/did-btcr2.js';
import { IntermediateDidDocument } from '../../src/index.js';

const network = 'mutinynet';
const keypair = SchnorrKeyPair.generate();
const args = process.argv.slice(2);
console.log('args:', args);
let idType: 'KEY' | 'EXTERNAL' = args.includes('-i') ? 'KEY' : 'EXTERNAL';

let genesisBytes = await createGenesisBytes(idType);

async function createGenesisBytes(idType: 'KEY' | 'EXTERNAL') {
  switch(idType) {
    case 'KEY':
      return keypair.publicKey.compressed;
    case 'EXTERNAL': {
      return await JSON.canonicalization.canonicalhash(
        IntermediateDidDocument.fromPublicKey(
          keypair.publicKey.compressed,
          network
        )
      );
    }
    default:
      throw new Error(`Unsupported idType: ${idType}`);
  }
}

const did = await DidBtcr2.create({ idType, genesisBytes, options: { network } });
const resolution = await DidBtcr2.resolve(did);

await writeFile('./data/mutinynet/initial-did-document.json', JSON.stringify(resolution.didDocument, null, 2), 'utf-8');
await writeFile('./data/mutinynet/initial-key-pair.json', JSON.stringify(keypair.hex, null, 2), 'utf-8');