import { DidBtcr2 } from '../../../src/did-btcr2.js';

const updates = [
  {
    '@context' : [
      'https://w3id.org/security/v2',
      'https://w3id.org/zcap/v1',
      'https://w3id.org/json-ld-patch/v1',
      'https://btcr2.dev/context/v1'
    ],
    'patch' : [
      {
        'op'    : 'add',
        'path'  : '/service/3',
        'value' : [
          {
            'id'              : 'did:btcr2:k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f#newP2PKH',
            'type'            : 'SingletonBeacon',
            'serviceEndpoint' : 'bitcoin:mwfn3W9cBjRNSPbNsYaDSykrrM42kYUgFd'
          }
        ]
      }
    ],
    'targetHash'      : 'DaX1VMV1CRwt6xBWQfxL22pjpDwCeRwrBvWkFoMnP3c3',
    'targetVersionId' : 2,
    'sourceHash'      : '2ExVhTJcrDTyHHbG1Sq155T9AQX6jDYvGwa1z4MVcGHg',
    'proof'           : {
      '@context' : [
        'https://w3id.org/security/v2',
        'https://w3id.org/zcap/v1',
        'https://w3id.org/json-ld-patch/v1',
        'https://btcr2.dev/context/v1'
      ],
      'cryptosuite'        : 'bip340-jcs-2025',
      'type'               : 'DataIntegrityProof' as const,
      'verificationMethod' : 'did:btcr2:k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f#initialKey',
      'proofPurpose'       : 'capabilityInvocation',
      'capability'         : 'urn:zcap:root:did%3Abtcr2%3Ak1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f',
      'capabilityAction'   : 'Write',
      'proofValue'         : 'z34Jdi2eWmj61pWbv6hwsfRkRsU7y9QwMgcLmZejvKR5CurWnDUMxY1hE7H6yZU1ybfg57qzmCgPrsXndSbribTQP'
    }
  }
];

const resolution = await DidBtcr2.resolve(
  'did:btcr2:k1qgpkyr20hr2ugzcdctulmprrdkz5slj3an64l0x4encgc6kpfz7g5ds4tgr4f',
  { drivers: {}, sidecar: { updates }}
);
console.log(JSON.stringify(resolution, null, 2));