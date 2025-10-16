import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { IntermediateDidDocument } from '../src/index.js';

/**
 * Create External Test Cases
 */
describe('Create External', () => {
  const expectedDidMap = new Map<string, string>([
    ['bitcoin', 'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w'],
    ['mutinynet', 'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s'],
    ['regtest', 'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw'],
    ['signet', 'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7'],
    ['testnet3', 'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme'],
    ['testnet4', 'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8']
  ]);
  const idType = 'EXTERNAL';
  const mainInterDoc = new IntermediateDidDocument({
    'id'         : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'controller' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    ],
    '@context' : [
      'https://www.w3.org/TR/did-1.1',
      'https://btcr2.dev/context/v1'
    ],
    'verificationMethod' : [
      {
        'id'                 : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0',
        'type'               : 'Multikey',
        'controller'         : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        'publicKeyMultibase' : 'zQ3shNEtFVr84D9d5xPCDRo6Z8Kr7PuNTAWG63hZgrbsRdwuE'
      }
    ],
    'authentication' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0'
    ],
    'assertionMethod' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0'
    ],
    'capabilityInvocation' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0'
    ],
    'capabilityDelegation' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0'
    ],
    'service' : [
      {
        'id'              : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#service-0',
        'type'            : 'SingletonBeacon',
        'serviceEndpoint' : 'bitcoin:1DNTBNvF7zeXSXe9UnNskw3BZvDwqrGpVZ'
      }
    ]
  });
  const nonMainInterDoc = new IntermediateDidDocument({
    'id'         : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'controller' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    ],
    '@context' : [
      'https://www.w3.org/TR/did-1.1',
      'https://btcr2.dev/context/v1'
    ],
    'verificationMethod' : [
      {
        'id'                 : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0',
        'type'               : 'Multikey',
        'controller'         : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        'publicKeyMultibase' : 'zQ3shNEtFVr84D9d5xPCDRo6Z8Kr7PuNTAWG63hZgrbsRdwuE'
      }
    ],
    'authentication' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0'
    ],
    'assertionMethod' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0'
    ],
    'capabilityInvocation' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0'
    ],
    'capabilityDelegation' : [
      'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#key-0'
    ],
    'service' : [
      {
        'id'              : 'did:btcr2:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx#service-0',
        'type'            : 'SingletonBeacon',
        'serviceEndpoint' : 'bitcoin:mstQUS1Dw25nDe7mCMMFarFWRupejRsMzb'
      }
    ]
  });

  it('should create new bitcoin DID and initial DID document',
    async () => {
      const network = 'bitcoin';
      const genesisBytes = await JSON.canonicalization.canonicalhash(mainInterDoc);
      const did = await DidBtcr2.create({ idType, genesisBytes, options: { network }});
      expect(did).to.equal(expectedDidMap.get(network));
    }
  );

  it('should create new mutinynet DID and initial DID Document',
    async () => {
      const network = 'mutinynet';
      const genesisBytes = await JSON.canonicalization.canonicalhash(nonMainInterDoc);
      const did = await DidBtcr2.create({ idType, genesisBytes, options: { network }});
      expect(did).to.equal(expectedDidMap.get(network));
    }
  );

  it('should create new regtest DID and initial DID Document',
    async () => {
      const network = 'regtest';
      const genesisBytes = await JSON.canonicalization.canonicalhash(nonMainInterDoc);
      const did = await DidBtcr2.create({ idType, genesisBytes, options: { network }});
      expect(did).to.equal(expectedDidMap.get(network));
    }
  );

  it('should create new signet DID and initial DID Document',
    async () => {
      const network = 'signet';
      const genesisBytes = await JSON.canonicalization.canonicalhash(nonMainInterDoc);
      const did = await DidBtcr2.create({ idType, genesisBytes, options: { network }});
      expect(did).to.equal(expectedDidMap.get(network));
    }
  );

  it('should create new testnet3 DID and initial DID Document',
    async () => {
      const network = 'testnet3';
      const genesisBytes = await JSON.canonicalization.canonicalhash(nonMainInterDoc);
      const did = await DidBtcr2.create({ idType, genesisBytes, options: { network }});
      expect(did).to.equal(expectedDidMap.get(network));
    }
  );

  it('should create new testnet4 DID and initial DID Document',
    async () => {
      const network = 'testnet4';
      const genesisBytes = await JSON.canonicalization.canonicalhash(nonMainInterDoc);
      const did = await DidBtcr2.create({ idType, genesisBytes, options: { network }});
      expect(did).to.equal(expectedDidMap.get(network));
    });
});