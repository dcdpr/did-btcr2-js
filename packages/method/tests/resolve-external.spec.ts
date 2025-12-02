import { expect } from 'chai';
import { DidBtcr2 } from '../src/did-btcr2.js';
import { SidecarData } from '../src/index.js';

/**
 * Resolve External Test Cases
 */
describe('Resolve External', () => {
  const externalDIDs: [string, string, any][] = [
    [
      'bitcoin',
      'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w',
      {
        'id'         : 'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w',
        'controller' : [
          'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w'
        ],
        '@context' : [
          'https://www.w3.org/TR/did-1.1',
          'https://btcr2.dev/context/v1'
        ],
        'verificationMethod' : [
          {
            'id'                 : 'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w#key-0',
            'type'               : 'Multikey',
            'controller'         : 'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w',
            'publicKeyMultibase' : 'zQ3shNEtFVr84D9d5xPCDRo6Z8Kr7PuNTAWG63hZgrbsRdwuE'
          }
        ],
        'authentication' : [
          'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w#key-0'
        ],
        'assertionMethod' : [
          'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w#key-0'
        ],
        'capabilityInvocation' : [
          'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w#key-0'
        ],
        'capabilityDelegation' : [
          'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w#key-0'
        ],
        'service' : [
          {
            'id'              : 'did:btcr2:x1qrn3k9ttngd7x6lgjlfpykz4aj03672675uw2gt2nj3m5vj680t8vaxz52w#service-0',
            'type'            : 'SingletonBeacon',
            'serviceEndpoint' : 'bitcoin:1DNTBNvF7zeXSXe9UnNskw3BZvDwqrGpVZ'
          }
        ]
      }
    ],
    [
      'mutinynet',
      'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s',
      {
        'id'         : 'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s',
        'controller' : [
          'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s'
        ],
        '@context' : [
          'https://www.w3.org/TR/did-1.1',
          'https://btcr2.dev/context/v1'
        ],
        'verificationMethod' : [
          {
            'id'                 : 'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s#key-0',
            'type'               : 'Multikey',
            'controller'         : 'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s',
            'publicKeyMultibase' : 'zQ3shNEtFVr84D9d5xPCDRo6Z8Kr7PuNTAWG63hZgrbsRdwuE'
          }
        ],
        'authentication' : [
          'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s#key-0'
        ],
        'assertionMethod' : [
          'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s#key-0'
        ],
        'capabilityInvocation' : [
          'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s#key-0'
        ],
        'capabilityDelegation' : [
          'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s#key-0'
        ],
        'service' : [
          {
            'id'              : 'did:btcr2:x1q5uu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wsswgwz3s#service-0',
            'type'            : 'SingletonBeacon',
            'serviceEndpoint' : 'bitcoin:mstQUS1Dw25nDe7mCMMFarFWRupejRsMzb'
          }
        ]
      }
    ],
    [
      'regtest',
      'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw',
      {
        'id'         : 'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw',
        'controller' : [
          'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw'
        ],
        '@context' : [
          'https://www.w3.org/TR/did-1.1',
          'https://btcr2.dev/context/v1'
        ],
        'verificationMethod' : [
          {
            'id'                 : 'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw#key-0',
            'type'               : 'Multikey',
            'controller'         : 'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw',
            'publicKeyMultibase' : 'zQ3shNEtFVr84D9d5xPCDRo6Z8Kr7PuNTAWG63hZgrbsRdwuE'
          }
        ],
        'authentication' : [
          'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw#key-0'
        ],
        'assertionMethod' : [
          'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw#key-0'
        ],
        'capabilityInvocation' : [
          'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw#key-0'
        ],
        'capabilityDelegation' : [
          'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw#key-0'
        ],
        'service' : [
          {
            'id'              : 'did:btcr2:x1qguu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss687dcw#service-0',
            'type'            : 'SingletonBeacon',
            'serviceEndpoint' : 'bitcoin:mstQUS1Dw25nDe7mCMMFarFWRupejRsMzb'
          }
        ]
      }
    ],
    [
      'signet',
      'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7',
      {
        'id'         : 'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7',
        'controller' : [
          'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7'
        ],
        '@context' : [
          'https://www.w3.org/TR/did-1.1',
          'https://btcr2.dev/context/v1'
        ],
        'verificationMethod' : [
          {
            'id'                 : 'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7#key-0',
            'type'               : 'Multikey',
            'controller'         : 'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7',
            'publicKeyMultibase' : 'zQ3shNEtFVr84D9d5xPCDRo6Z8Kr7PuNTAWG63hZgrbsRdwuE'
          }
        ],
        'authentication' : [
          'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7#key-0'
        ],
        'assertionMethod' : [
          'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7#key-0'
        ],
        'capabilityInvocation' : [
          'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7#key-0'
        ],
        'capabilityDelegation' : [
          'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7#key-0'
        ],
        'service' : [
          {
            'id'              : 'did:btcr2:x1qyuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssa0g9a7#service-0',
            'type'            : 'SingletonBeacon',
            'serviceEndpoint' : 'bitcoin:mstQUS1Dw25nDe7mCMMFarFWRupejRsMzb'
          }
        ]
      }
    ],
    [
      'testnet3',
      'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme',
      {
        'id'         : 'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme',
        'controller' : [
          'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme'
        ],
        '@context' : [
          'https://www.w3.org/TR/did-1.1',
          'https://btcr2.dev/context/v1'
        ],
        'verificationMethod' : [
          {
            'id'                 : 'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme#key-0',
            'type'               : 'Multikey',
            'controller'         : 'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme',
            'publicKeyMultibase' : 'zQ3shNEtFVr84D9d5xPCDRo6Z8Kr7PuNTAWG63hZgrbsRdwuE'
          }
        ],
        'authentication' : [
          'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme#key-0'
        ],
        'assertionMethod' : [
          'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme#key-0'
        ],
        'capabilityInvocation' : [
          'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme#key-0'
        ],
        'capabilityDelegation' : [
          'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme#key-0'
        ],
        'service' : [
          {
            'id'              : 'did:btcr2:x1qvuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wssqctjme#service-0',
            'type'            : 'SingletonBeacon',
            'serviceEndpoint' : 'bitcoin:mstQUS1Dw25nDe7mCMMFarFWRupejRsMzb'
          }
        ]
      }
    ],
    [
      'testnet4',
      'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8',
      {
        'id'         : 'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8',
        'controller' : [
          'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8'
        ],
        '@context' : [
          'https://www.w3.org/TR/did-1.1',
          'https://btcr2.dev/context/v1'
        ],
        'verificationMethod' : [
          {
            'id'                 : 'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8#key-0',
            'type'               : 'Multikey',
            'controller'         : 'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8',
            'publicKeyMultibase' : 'zQ3shNEtFVr84D9d5xPCDRo6Z8Kr7PuNTAWG63hZgrbsRdwuE'
          }
        ],
        'authentication' : [
          'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8#key-0'
        ],
        'assertionMethod' : [
          'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8#key-0'
        ],
        'capabilityInvocation' : [
          'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8#key-0'
        ],
        'capabilityDelegation' : [
          'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8#key-0'
        ],
        'service' : [
          {
            'id'              : 'did:btcr2:x1qsuu7xjnle255xwwvgqu6f8j0x3ztxjs4307z9t04s3jw9z0d7wss5hmaj8#service-0',
            'type'            : 'SingletonBeacon',
            'serviceEndpoint' : 'bitcoin:mstQUS1Dw25nDe7mCMMFarFWRupejRsMzb'
          }
        ]
      }
    ]
  ];

  it('should resolve each external key identifier to its correcponding did document',
    async () => {
      for(let [network, did, initialDocument] of externalDIDs) {
        const result = await DidBtcr2.resolve(
          did,
          {
            network,
            sidecarData : { initialDocument } as SidecarData
          }
        );
        expect(result).to.have.property('didDocument');
        expect(result).to.have.property('didResolutionMetadata');
        expect(result).to.have.property('didDocumentMetadata');
      }
    });
});