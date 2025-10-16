// NOTE: Does not verify due to bad input data!

import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { Identifier } from '../../../method/src/index.js';
import { SchnorrMultikey } from '../../src/index.js';

const initialDocument = {
  '@context' : [
    'https://www.w3.org/ns/did/v1',
    'https://did-btcr2/TBD/context'
  ],
  id                 : 'did:btcr2:regtest:k1qdh2ef3aqne63sdhq8tr7c8zv9lyl5xy4llj8uw3ejfj5xsuhcacjq98ccc',
  verificationMethod : [
    {
      id                 : '#initialKey',
      type               : 'Multikey',
      controller         : 'did:btcr2:regtest:k1qdh2ef3aqne63sdhq8tr7c8zv9lyl5xy4llj8uw3ejfj5xsuhcacjq98ccc',
      publicKeyMultibase : 'zQ3shn68faoXE2EqCTtefQXNLgaTa7ZohG2ftZjgXphStJsGc'
    }
  ],
  authentication : [
    '#initialKey'
  ],
  assertionMethod : [
    '#initialKey'
  ],
  capabilityInvocation : [
    '#initialKey'
  ],
  capabilityDelegation : [
    '#initialKey'
  ],
  service : [
    {
      id              : '#initialP2PKH',
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:moFJwqLXBDmw4rnWQm9c3ag4kSdFxD5yiz'
    },
    {
      id              : '#initialP2WPKH',
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:bcrt1q2n9edlz3yehahctcj6p93lzznhz9m0kzp67ung'
    },
    {
      id              : '#initialP2TR',
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:bcrt1p6rs5tnq94rt4uu5edc9luahlkyphk30yk8smwfzurpc8ru06vcws8ylq7l'
    }
  ]
};
const securedDocument = {
  '@context' : [
    'https://w3id.org/security/v2',
    'https://w3id.org/zcap/v1',
    'https://w3id.org/json-ld-patch/v1'
  ],
  patch : [
    {
      op    : 'add',
      path  : '/service/3',
      value : {
        id              : '#linked-domain',
        type            : 'LinkedDomains',
        serviceEndpoint : 'https://contact-me.com'
      }
    }
  ],
  sourceHash      : '9kSA9j3z2X3a26yAdJi6nwg31qyfaHMCU1u81ZrkHirM',
  targetHash      : 'C45TsdfkLZh5zL6pFfRmK93X4EdHusbCDwvt8d7Xs3dP',
  targetVersionId : 2,
  proof           : {
    type               : 'DataIntegrityProof',
    cryptosuite        : 'bip340-jcs-2025',
    verificationMethod : 'did:btcr2:regtest:k1qdh2ef3aqne63sdhq8tr7c8zv9lyl5xy4llj8uw3ejfj5xsuhcacjq98ccc#initialKey',
    proofPurpose       : 'capabilityInvocation',
    capability         : 'urn:zcap:root:did%3Abtc1%3Aregtest%3Ak1qdh2ef3aqne63sdhq8tr7c8zv9lyl5xy4llj8uw3ejfj5xsuhcacjq98ccc',
    capabilityAction   : 'Write',
    '@context'         : [
      'https://w3id.org/security/v2',
      'https://w3id.org/zcap/v1',
      'https://w3id.org/json-ld-patch/v1'
    ],
    proofValue : 'z3yfzVGdoDF4s8y4Bk8JeV9XuZw1nMeMtNW3x5brEm7DNtmWZkNBPbCLzUBJRpctBj9QJL1dydm94ZNsPxosPnkPP'
  }
};

const vm = initialDocument.verificationMethod[0];
const id = vm.id;
const controller = vm.controller;
const components = Identifier.decode(controller);
console.log('components:', components);
const publicKey = components.genesisBytes;
console.log('publicKey:', publicKey);
const keys = new SchnorrKeyPair({ publicKey });
const publicKeyMultibase = keys.publicKey.multibase;
console.log('publicKeyMultibase', publicKeyMultibase);
const diProof = SchnorrMultikey.initialize({ id, controller, keys })
  .toCryptosuite('bip340-jcs-2025')
  .toDataIntegrityProof();
const document = await JSON.canonicalization.canonicalize(securedDocument);
const verifiedProof = await diProof.verifyProof({ document, expectedPurpose: 'capabilityInvocation' });
console.log(verifiedProof);