export default [
  {
    '@context'          : ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
    'id'                : 'http://university.example/credentials/58473',
    'type'              : ['VerifiableCredential', 'ExampleAlumniCredential'],
    'validFrom'         : '2020-01-01T00:00:00Z',
    'credentialSubject' : {
      'id'       : 'did:example:ebfeb1f712ebc6f1c276e12ec21',
      'alumniOf' : {
        'id'   : 'did:example:c276e12ec21ebfeb1f712ebc6f1',
        'name' : 'Example University'
      }
    },
    'issuer' : 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65',
    'proof'  : {
      'type'               : 'DataIntegrityProof',
      'cryptosuite'        : 'bip340-jcs-2025',
      'verificationMethod' : 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65#initialKey',
      'proofPurpose'       : 'attestationMethod',
      '@context'           : ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
      'proofValue'         : 'z5MrRrzz95QSXoTGrFtHnjDC1NKfMnXY1E6u3xb4Fto8ePYNojpLdMknHpnYhF1UaHxe7CG2EQCiq5B2BcVU7tKQp'}
  },

  {
    '@context'          : ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
    'id'                : 'http://university.example/credentials/58473',
    'type'              : ['VerifiableCredential', 'ExampleAlumniCredential'],
    'validFrom'         : '2020-01-01T00:00:00Z',
    'credentialSubject' : {
      'id'       : 'did:example:ebfeb1f712ebc6f1c276e12ec21',
      'alumniOf' : {
        'id'   : 'did:example:c276e12ec21ebfeb1f712ebc6f1',
        'name' : 'Example University'
      }
    }, 'issuer' : 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65'}
];