import { Canonicalization } from '@did-btcr2/common';
import { DidBtcr2, GenesisDocument } from '../../../../src/index.js';

const genesisBytes = GenesisDocument.toGenesisBytes({
  'id'       : 'did:btcr2:_',
  '@context' : [
    'https://www.w3.org/TR/did-1.1',
    'https://btcr2.dev/context/v1'
  ],
  'verificationMethod' : [
    {
      'id'                 : 'did:btcr2:_#key-0',
      'type'               : 'Multikey',
      'controller'         : 'did:btcr2:_',
      'publicKeyMultibase' : 'zQ3shU1YDA8iT1PTxtFVjVy4ZggMgd63JJ5cM9AvceSbKLVw7'
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
      'serviceEndpoint' : 'bitcoin:149c5YUddc2DMKySbrw1eDGjZKAZFRJGQf',
      'type'            : 'SingletonBeacon'
    }
  ]
});
const genesisHex = Canonicalization.toHex(genesisBytes);
const did = DidBtcr2.create(genesisBytes, {
  idType  : 'EXTERNAL',
  network : 'bitcoin'
});
console.log('DID:', did);
console.log('Genesis Hex:', genesisHex);
console.log('Genesis Bytes:', genesisBytes);