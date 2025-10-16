import { ProofOptions } from '@did-btcr2/common';
import { SchnorrKeyPair, SecretKey } from '@did-btcr2/keypair';
import { Cryptosuite, DataIntegrityProof, SchnorrMultikey } from '../../src/index.js';

const unsecuredDocument = {
  '@context' : [
    'https://www.w3.org/ns/credentials/v2',
    'https://www.w3.org/ns/credentials/examples/v2',
  ],
  id                : 'http://university.example/credentials/58473',
  type              : ['VerifiableCredential', 'ExampleAlumniCredential'],
  validFrom         : '2020-01-01T00:00:00Z',
  issuer            : 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65',
  credentialSubject : {
    id       : 'did:example:ebfeb1f712ebc6f1c276e12ec21',
    alumniOf : {
      id   : 'did:example:c276e12ec21ebfeb1f712ebc6f1',
      name : 'Example University',
    },
  },
} as any;
const id = '#initialKey';
const controller = 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65';
const SECRET = 52464508790539176856770556715241483442035423615466097401201513777400180778402n;
const options: ProofOptions = {
  type               : 'DataIntegrityProof',
  cryptosuite        : 'bip340-jcs-2025',
  verificationMethod : 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65#initialKey',
  proofPurpose       : 'attestationMethod'
};

const secretKey = SecretKey.fromSecret(SECRET);
const keys = new SchnorrKeyPair({ secretKey });
const multikey = new SchnorrMultikey({ id, controller, keys });
const cryptosuite = new Cryptosuite({ cryptosuite: 'bip340-jcs-2025', multikey });
const diProof = new DataIntegrityProof(cryptosuite);
const securedDocument = await diProof.addProof({ document: unsecuredDocument, options });

const verifiedProof = await diProof.verifyProof({
  document        : JSON.stringify(securedDocument),
  expectedPurpose : 'attestationMethod',
  mediaType       : 'application/json'
});

console.log(verifiedProof);