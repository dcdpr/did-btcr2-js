import { Canonicalization } from '../src/canonicalization.js';

const sourceDocument = {
  'id'       : 'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte',
  '@context' : [
    'https://www.w3.org/TR/did-1.1',
    'https://btcr2.dev/context/v1'
  ],
  'verificationMethod' : [
    {
      'id'                 : 'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte#initialKey',
      'type'               : 'Multikey',
      'controller'         : 'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte',
      'publicKeyMultibase' : 'zQ3shRNR6T6f48eQa9EsQoeji27vdgjhCGJUThDUxkCqWhvyC'
    }
  ],
  'authentication' : [
    'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte#initialKey'
  ],
  'assertionMethod' : [
    'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte#initialKey'
  ],
  'capabilityInvocation' : [
    'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte#initialKey'
  ],
  'capabilityDelegation' : [
    'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte#initialKey'
  ],
  'service' : [
    {
      'id'              : 'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte#initialP2PKH',
      'type'            : 'SingletonBeacon',
      'serviceEndpoint' : 'bitcoin:mqc8aAYxy8AhrXraahrKETYM4g3QP4YXzr'
    },
    {
      'id'              : 'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte#initialP2WPKH',
      'type'            : 'SingletonBeacon',
      'serviceEndpoint' : 'bitcoin:bcrt1qd64743arzm5jyk2smgmqw3t5yg7qnhjulg8aen'
    },
    {
      'id'              : 'did:btcr2:k1qgpr45cheptyjekl3cex80xfnkwhxnlclecwwf92gvdjrszm2uwhzlcxu5xte#initialP2TR',
      'type'            : 'SingletonBeacon',
      'serviceEndpoint' : 'bitcoin:bcrt1pyq85ntejerpngakny9d6cv67p2kqpkw3rxgzf9smjk9fc3tangnqdurvfn'
    }
  ]
};
const canonicalhash = Canonicalization.process(sourceDocument, { encoding: 'base64url' });
console.log('canonicalhash:', canonicalhash);