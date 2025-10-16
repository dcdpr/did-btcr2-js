import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import canonicalize from 'canonicalize';
import { base58btc } from 'multiformats/bases/base58';
import { Canonicalization } from '@did-btcr2/common';
const didDocument = {
  'id'       : 'did:btcr2:regtest:k1qdh2ef3aqne63sdhq8tr7c8zv9lyl5xy4llj8uw3ejfj5xsuhcacjq98ccc',
  '@context' : [
    'https://www.w3.org/ns/did/v1',
    'https://did-btcr2/TBD/context'
  ],
  'verificationMethod' : [
    {
      'id'                 : '#initialKey',
      'type'               : 'Multikey',
      'controller'         : 'did:btcr2:regtest:k1qdh2ef3aqne63sdhq8tr7c8zv9lyl5xy4llj8uw3ejfj5xsuhcacjq98ccc',
      'publicKeyMultibase' : 'zQ3shn68faoXE2EqCTtefQXNLgaTa7ZohG2ftZjgXphStJsGc'
    }
  ],
  'authentication' : [
    '#initialKey'
  ],
  'assertionMethod' : [
    '#initialKey'
  ],
  'capabilityInvocation' : [
    '#initialKey'
  ],
  'capabilityDelegation' : [
    '#initialKey'
  ],
  'service' : [
    {
      'id'              : '#initialP2PKH',
      'type'            : 'SingletonBeacon',
      'serviceEndpoint' : 'bitcoin:moFJwqLXBDmw4rnWQm9c3ag4kSdFxD5yiz'
    },
    {
      'id'              : '#initialP2WPKH',
      'type'            : 'SingletonBeacon',
      'serviceEndpoint' : 'bitcoin:bcrt1q2n9edlz3yehahctcj6p93lzznhz9m0kzp67ung'
    },
    {
      'id'              : '#initialP2TR',
      'type'            : 'SingletonBeacon',
      'serviceEndpoint' : 'bitcoin:bcrt1p6rs5tnq94rt4uu5edc9luahlkyphk30yk8smwfzurpc8ru06vcws8ylq7l'
    }
  ]
};
const updatePayload = {
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

const objects = [didDocument, updatePayload];

for (const obj of objects) {
  const canonicalPkg = canonicalize(obj);
  const canonicalHashPkg = sha256(canonicalPkg);
  const canonicalHashHexPkg = bytesToHex(canonicalHashPkg);
  const canonicalHashBase58Pkg = base58btc.encode(canonicalHashPkg);
  console.log('pkg: canonicalize - canonicalPkg=', canonicalPkg);
  console.log('pkg: canonicalize - canonicalHashPkg=', canonicalHashPkg);
  console.log('pkg: canonicalize - canonicalHashHexPkg=', canonicalHashHexPkg);
  console.log('pkg: canonicalize - canonicalHashBase58Pkg=', canonicalHashBase58Pkg);

  const canonicalCommon = new Canonicalization().jcs(obj);
  const canonicalHashCommon = sha256(canonicalCommon);
  const canonicalHasHexCommon = bytesToHex(canonicalHashCommon);
  const canonicalHashBase58Common = base58btc.encode(canonicalHashCommon);
  console.log('pkg: packages/common - canonicalCommon=', canonicalCommon);
  console.log('pkg: packages/common - canonicalHashCommon=', canonicalHashCommon);
  console.log('pkg: packages/common - canonicalHasHexCommon=', canonicalHasHexCommon);
  console.log('pkg: packages/common - canonicalHashBase58Common', canonicalHashBase58Common);

  console.log('canonicalPkg === canonicalCommon', canonicalPkg === canonicalCommon);
  console.log('canonicalHashPkg === canonicalHashCommon', canonicalHashPkg.join('') === canonicalHashCommon.join(''));
  console.log('canonicalHashHexPkg === canonicalHasHexCommon', canonicalHashHexPkg === canonicalHasHexCommon);
  console.log('canonicalHashBase58Pkg === canonicalHashBase58Common', canonicalHashBase58Pkg === canonicalHashBase58Common);
}