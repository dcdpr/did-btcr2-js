import { ID_PLACEHOLDER_VALUE } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { DidBtcr2 } from "../../../src/did-btcr2.js";
import { BeaconUtils, IntermediateDidDocument } from '../../../src/index.js';
import { getNetwork } from '@did-btcr2/bitcoin';

const key0 = SchnorrKeyPair.generate();
const service0 = SchnorrKeyPair.generate();

for(const network of ['bitcoin', 'signet', 'regtest', 'testnet3', 'testnet4', 'mutinynet']) {
  const service = BeaconUtils.generateBeaconService({
    id          : `${ID_PLACEHOLDER_VALUE}#service-0`,
    publicKey   : service0.publicKey.compressed,
    network     : getNetwork(network),
    addressType : 'p2pkh',
    type        : 'SingletonBeacon',
  });

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
  const intermediateDocument = IntermediateDidDocument.create(verificationMethod, relationships, [service]);
  const genesisBytes = await JSON.canonicalization.canonicalhash(intermediateDocument);

  const response = await DidBtcr2.create({ idType: 'EXTERNAL', genesisBytes, options: { version: 1, network } });
  console.log(`${network}-x`, JSON.stringify(response, null, 2));
}