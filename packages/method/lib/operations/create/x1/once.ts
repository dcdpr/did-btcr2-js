import { hex } from '@scure/base';
import { DidBtcr2, GenesisDocument } from '../../../../src/index.js';

const genesisBytes = GenesisDocument.toGenesisBytes({
  'id'       : 'did:btcr2:_',
  '@context' : [
    'https://www.w3.org/ns/did/v1.1',
    'https://btcr2.dev/context/v1'
  ],
  'verificationMethod' : [
    {
      'id'                 : 'did:btcr2:_#key-0',
      'type'               : 'Multikey',
      'controller'         : 'did:btcr2:_',
      'publicKeyMultibase' : 'zQ3shq6AYR71SUYTkQ7wWBQwy2pCSQ7pZjNbGVRAeDtnHMeGg'
    }
  ],
  'authentication' : [
    'did:btcr2:_#key-0'
  ],
  'assertionMethod' : [
    'did:btcr2:_#key-0'
  ],
  'capabilityInvocation' : [
    'did:btcr2:_#key-0'
  ],
  'capabilityDelegation' : [
    'did:btcr2:_#key-0'
  ],
  'service' : [
    {
      'id'              : 'did:btcr2:_#service-0',
      'serviceEndpoint' : 'bitcoin:n3CS3eUYzvbM1SVrjDmYJ6AA4QuuCJ4noJ',
      'type'            : 'SingletonBeacon'
    }
  ]
});
const genesisHex = hex.encode(genesisBytes);
const did = DidBtcr2.create(genesisBytes, {
  idType  : 'EXTERNAL',
  network : 'bitcoin'
});
console.log('DID:', did);
console.log('Genesis Hex:', genesisHex);
console.log('Genesis Bytes:', genesisBytes);