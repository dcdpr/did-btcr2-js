import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hexToBytes } from '@noble/hashes/utils';
import { Appendix, Identifier } from '../../../method/src/index.js';
import { SchnorrMultikey } from '../../src/index.js';

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
        id              : 'did:btcr2:k1qgp8lpuyxprky2kh24hdxlycrcyk56lkqmnuelpw70d3ay2gej6vhwgfqurtz#service-0',
        type            : 'SingletonBeacon',
        serviceEndpoint : 'bitcoin:bcrt1pj295gcqjudqk3hdgkmwygvr4hdgs6hy7vgeyvpa9jhyvvukwxgeq86t22u'
      }
    }
  ],
  sourceHash      : '56JfeGBfkrpcZLten821qiohFBLxJoGxTYwsKLcqgrvZ',
  targetHash      : '5291nuHCuJQYvkgL2vmzmCyWXfmjUBLt4FKVjKFS14Hd',
  targetVersionId : 2,
  proof           : {
    '@context'           : [
      'https://w3id.org/security/v2',
      'https://w3id.org/zcap/v1',
      'https://w3id.org/json-ld-patch/v1'
    ],
    type               : 'DataIntegrityProof',
    cryptosuite        : 'bip340-jcs-2025',
    verificationMethod : 'did:btcr2:k1qgp8lpuyxprky2kh24hdxlycrcyk56lkqmnuelpw70d3ay2gej6vhwgfqurtz#initialKey',
    proofPurpose       : 'capabilityInvocation',
    capability         : 'urn:zcap:root:did%3Abtc1%3Ak1qgp8lpuyxprky2kh24hdxlycrcyk56lkqmnuelpw70d3ay2gej6vhwgfqurtz',
    capabilityAction   : 'Write',
    proofValue         : 'z3pUfuu8dge6Yrf1ZDECadzYwdaHJEc9jx44rhxL6dBapWfX41D5J2LH2NrHFeNTdJKwXGwnLWNEJyJVWw5tLmL6e'
  }
};

const id = '#initialKey';
const controller = 'did:btcr2:k1qgp8lpuyxprky2kh24hdxlycrcyk56lkqmnuelpw70d3ay2gej6vhwgfqurtz';
const components = Identifier.decode(controller);
console.log('components:', components);
const publicKey = components.genesisBytes;
console.log('publicKey:', publicKey);
const keys = new SchnorrKeyPair({ publicKey });
const publicKeyJson = keys.publicKey.json();
console.log('publicKeyJson', publicKeyJson);
const diProof = SchnorrMultikey.initialize({ id, controller, keys })
  .toCryptosuite('bip340-jcs-2025')
  .toDataIntegrityProof();
const document = await JSON.canonicalization.canonicalize(securedDocument);
const verifiedProof = await diProof.verifyProof({ document, expectedPurpose: 'capabilityInvocation' });
console.log('verifiedProof', verifiedProof);