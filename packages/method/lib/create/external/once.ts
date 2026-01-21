import { canonicalization, DidBtcr2, ID_PLACEHOLDER_VALUE } from '@did-btcr2/method';

const options = { idType: 'EXTERNAL', version: 1, network: 'mutinynet' };
const genesisDocument = {
  'id'         : ID_PLACEHOLDER_VALUE,
  'controller' : [ID_PLACEHOLDER_VALUE],
  '@context'   : [
    'https://www.w3.org/TR/did-1.1',
    'https://btcr2.dev/context/v1'
  ],
  'verificationMethod' : [
    {
      'id'                 : `${ID_PLACEHOLDER_VALUE}#key-0`,
      'type'               : 'Multikey',
      'controller'         : ID_PLACEHOLDER_VALUE,
      'publicKeyMultibase' : 'zQ3shpvj4d9W1cDWhT93RLwAtjfQQ3CRLNsjjZKLsXa1AtvCf'
    }
  ],
  'authentication' : [
    `${ID_PLACEHOLDER_VALUE}#key-0`
  ],
  'assertionMethod' : [
    `${ID_PLACEHOLDER_VALUE}#key-0`
  ],
  'capabilityInvocation' : [
    `${ID_PLACEHOLDER_VALUE}#key-0`
  ],
  'capabilityDelegation' : [
    `${ID_PLACEHOLDER_VALUE}#key-0`
  ],
  'service' : [
    {
      'id'              : `${ID_PLACEHOLDER_VALUE}#key-0`,
      'type'            : 'SingletonBeacon',
      'serviceEndpoint' : 'bitcoin:1HG3YPxx91k92Qcjgsdz6SG7yhMTwq3XLx'
    }
  ]
};

const genesisBytes = canonicalization.canonicalhash(genesisDocument);
const res = await DidBtcr2.create(genesisBytes, options);
console.log(res);