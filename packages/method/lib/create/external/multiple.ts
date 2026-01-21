import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { canonicalization, DidBtcr2 } from '../../../src/did-btcr2.js';
import { GenesisDocument, ID_PLACEHOLDER_VALUE } from '../../../src/index.js';
import { payments } from 'bitcoinjs-lib';
import { writeFile } from 'fs/promises';

const key0 = SchnorrKeyPair.fromPrivateKey(Buffer.from('3a5c2ce1f1e245fd3dbe109033aa16b0938212edb384d3ab0d8c1342e59ab5b9', 'hex'));

for(const network of ['bitcoin', 'signet', 'regtest', 'testnet3', 'testnet4', 'mutinynet']) {
  const address = payments.p2pkh({ pubkey: key0.publicKey.compressed, network: getNetwork(network) }).address!;
  const id = `${ID_PLACEHOLDER_VALUE}#service-0`;
  const service = { id, serviceEndpoint: `bitcoin:${address}`, type: 'SingletonBeacon' };

  const relationships = {
    authentication       : [`${ID_PLACEHOLDER_VALUE}#key-0`],
    assertionMethod      : [`${ID_PLACEHOLDER_VALUE}#key-0`],
    capabilityInvocation : [`${ID_PLACEHOLDER_VALUE}#key-0`],
    capabilityDelegation : [`${ID_PLACEHOLDER_VALUE}#key-0`]
  };

  const verificationMethod = [
    {
      id                 : `${ID_PLACEHOLDER_VALUE}#key-0`,
      type               : 'Multikey',
      controller         : ID_PLACEHOLDER_VALUE,
      publicKeyMultibase : key0.publicKey.multibase.encoded,
    }
  ];

  const genesisDocument = GenesisDocument.create(verificationMethod, relationships, [service]);
  const genesisBytes = canonicalization.canonicalhash(genesisDocument);

  const response = await DidBtcr2.create(genesisBytes, { idType: 'EXTERNAL', version: 1, network });
  await writeFile(`${network}.json`, JSON.stringify({did: response, genesisDocument}));
}