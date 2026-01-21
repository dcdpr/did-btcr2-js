import { BeaconUtils } from '../../src/index.js';

const currentDocument = {
  'id'         : 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r',
  'controller' : [
    'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r'
  ],
  '@context' : [
    'https://www.w3.org/TR/did-1.1',
    'https://btcr2.dev/context/v1'
  ],
  'verificationMethod' : [
    {
      'id'                 : 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialKey',
      'type'               : 'Multikey',
      'controller'         : 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r',
      'publicKeyMultibase' : 'zQ3shmErrWMPe8mMpTEkzJW23YYh3xSFdP1uAkPfoHHAZ64Qm'
    }
  ],
  'authentication' : [
    'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialKey'
  ],
  'assertionMethod' : [
    'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialKey'
  ],
  'capabilityInvocation' : [
    'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialKey'
  ],
  'capabilityDelegation' : [
    'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialKey'
  ],
  'service' : [
    {
      'type'            : 'SingletonBeacon',
      'id'              : 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialP2PKH',
      'serviceEndpoint' : 'bitcoin:1H88u4QooyH8nQa62M4Yq9paenYkho8SQw'
    },
    {
      'type'            : 'SingletonBeacon',
      'id'              : 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialP2WPKH',
      'serviceEndpoint' : 'bitcoin:bc1qkrdcgnhztushvx7jvgtcejkfk6fjs7gv0cg80f'
    },
    {
      'type'            : 'SingletonBeacon',
      'id'              : 'did:btcr2:k1qqpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5dsaaw53r#initialP2TR',
      'serviceEndpoint' : 'bitcoin:bc1p6cz4t2zmy26tzllrn75slx3urpaquzr3emd7990sh2dcceal3vdsnsc9ft'
    }
  ]
};

const beacons = currentDocument.service
  .filter(BeaconUtils.isBeaconService)
  .map(BeaconUtils.parseBeaconServiceEndpoint);

console.log('beacons', beacons);