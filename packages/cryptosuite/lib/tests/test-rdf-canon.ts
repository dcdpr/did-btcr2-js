import * as rdfc from 'rdf-canonize';
import { JsonLdDocumentLoader } from 'jsonld-document-loader';

const unsecured = {
  '@context' : [
    'https://www.w3.org/ns/credentials/v2',
    'https://www.w3.org/ns/credentials/examples/v2',
    {
      'issuer'            : 'https://example.org/vocab#issuer',
      'credentialSubject' : 'https://example.org/vocab#credentialSubject',
      'alumniOf'          : 'https://example.org/vocab#alumniOf',
      'name'              : 'https://example.org/vocab#name',
      'validFrom'         : 'https://example.org/vocab#validFrom'
    }
  ],
  '@id'               : 'http://university.example/credentials/58473',
  '@type'             : ['VerifiableCredential', 'ExampleAlumniCredential'],
  'validFrom'         : '2020-01-01T00:00:00Z',
  'credentialSubject' : {
    '@id'      : 'did:example:ebfeb1f712ebc6f1c276e12ec21',
    'alumniOf' : {
      '@id'  : 'did:example:c276e12ec21ebfeb1f712ebc6f1',
      'name' : 'Example University'
    }
  },
  'issuer' : 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65'
};

const secured = {
  '@context' : [
    'https://www.w3.org/ns/credentials/v2',
    'https://www.w3.org/ns/credentials/examples/v2',
    {
      'issuer'             : 'https://example.org/vocab#issuer',
      'credentialSubject'  : 'https://example.org/vocab#credentialSubject',
      'alumniOf'           : 'https://example.org/vocab#alumniOf',
      'name'               : 'https://example.org/vocab#name',
      'validFrom'          : 'https://example.org/vocab#validFrom',
      'proof'              : 'https://w3id.org/security#proof',
      'cryptosuite'        : 'https://w3id.org/security#cryptosuite',
      'proofValue'         : 'https://w3id.org/security#proofValue',
      'verificationMethod' : 'https://w3id.org/security#verificationMethod',
      'proofPurpose'       : 'https://w3id.org/security#proofPurpose'
    }
  ],
  '@id'               : 'http://university.example/credentials/58473',
  '@type'             : ['VerifiableCredential', 'ExampleAlumniCredential'],
  'validFrom'         : '2020-01-01T00:00:00Z',
  'credentialSubject' : {
    '@id'      : 'did:example:ebfeb1f712ebc6f1c276e12ec21',
    'alumniOf' : {
      '@id'  : 'did:example:c276e12ec21ebfeb1f712ebc6f1',
      'name' : 'Example University'
    }
  },
  'issuer' : 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65',
  'proof'  : {
    '@type'              : 'DataIntegrityProof',
    'cryptosuite'        : 'bip340-rdfc-2025',
    'verificationMethod' : 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65#initialKey',
    'proofPurpose'       : 'attestationMethod',
    '@context'           : [
      'https://www.w3.org/ns/credentials/v2',
      'https://www.w3.org/ns/credentials/examples/v2'
    ],
    'proofValue' : 'z5DMfd9jG19NMNCLYrwvVfSFUfkAfakujoPerW1hVjHCVmonaewAGPeWTNUA5NPKGDb7XsTpoRanCNvXGQseKbHN2'
  }
};

const jdl = new JsonLdDocumentLoader();
jdl.addDocuments({documents: [unsecured, secured]});
// For a single credential object:
const unsecuredcanonical = await rdfc.canonize(unsecured, { algorithm: 'RDFC-1.0' });
console.log('unsecuredcanonical', unsecuredcanonical);

const securedcanonical = await rdfc.canonize(secured, { algorithm: 'RDFC-1.0' });
console.log('securedcanonical', securedcanonical);
