import { BitcoinNetworkNames } from '@did-btcr2/common';
import { SchnorrKeyPair } from '../src/pair.js';

const secretKey = new Uint8Array([
  189,  38, 143, 201, 181, 132,  46, 71,
  232,  89, 206, 136, 196, 208, 94, 153,
  101, 219, 165,  94, 235, 242, 29, 164,
  176, 161, 99, 193, 209,  97,  23, 158
]);
const keys = new SchnorrKeyPair({ secretKey });
const publicKey = keys.publicKey!;
const network = BitcoinNetworkNames.bitcoin;
const document = {
  publicKey,
  intermediateDocument : {
    '@context' : [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
      'https://github.com/dcdpr/did-btcr2'
    ],
    id                   : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    authentication       : ['#initialKey'],
    assertionMethod      : ['#initialKey'],
    capabilityInvocation : ['#initialKey'],
    capabilityDelegation : ['#initialKey'],
    verificationMethod   : [{
      id                 : '#initialKey',
      type               : 'Multikey',
      controller         : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      publicKeyMultibase : publicKey.multibase,
    }],
    service : [
      {
        id              : '#initialP2PKH',
        type            : 'SingletonBeacon',
        serviceEndpoint : `${network}:`
      },
      {
        id              : '#initialP2WPKH',
        type            : 'SingletonBeacon',
        serviceEndpoint : `${network}:`
      },
      {
        id              : '#initialP2TR',
        type            : 'SingletonBeacon',
        serviceEndpoint : `${network}:`
      }
    ]
  }
};

console.log('document', document.intermediateDocument);
