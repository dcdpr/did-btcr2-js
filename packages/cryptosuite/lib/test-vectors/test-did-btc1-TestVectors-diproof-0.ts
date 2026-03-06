import { SchnorrKeyPair, Secp256k1SecretKey } from '@did-btcr2/keypair';
import { DataIntegrityConfig, SchnorrMultikey } from '../../src/index.js';

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
const nEntropy = 52464508790539176856770556715241483442035423615466097401201513777400180778402n;
const config: DataIntegrityConfig = {
  '@context' : [
    'https://w3id.org/security/v2',
    'https://w3id.org/zcap/v1',
    'https://w3id.org/json-ld-patch/v1',
    'https://btcr2.dev/context/v1'
  ],
  type               : 'DataIntegrityProof',
  cryptosuite        : 'bip340-jcs-2025',
  verificationMethod : 'did:btcr2:k1q2ddta4gt5n7u6d3xwhdyua57t6awrk55ut82qvurfm0qnrxx5nw7vnsy65#initialKey',
  proofPurpose       : 'attestationMethod'
};

const secretKey = Secp256k1SecretKey.fromBigInt(nEntropy);
const keyPair = new SchnorrKeyPair({ secretKey });
const diProof = SchnorrMultikey.create({ id, controller, keyPair })
  .toCryptosuite()
  .toDataIntegrityProof();
const securedDocument = diProof.addProof(unsecuredDocument, config);
const verifiedProof = diProof.verifyProof(JSON.stringify(securedDocument), 'attestationMethod');
console.log(verifiedProof);