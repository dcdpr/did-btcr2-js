import type { ResolutionOptions } from '../../../../src/index.js';
import { DidBtcr2 } from '../../../../src/index.js';

const input = {
  did               : 'did:btcr2:x1qkel9rl0ltz6w5m3rypnsa4tncu5yst45qdsmwtms94zx6wm7cc2q8nnfh7',
  resolutionOptions : {
    'sidecar' : {
      'genesisDocument' : {
        'verificationMethod' : [
          {
            'type'               : 'Multikey',
            'id'                 : '#initialKey',
            'publicKeyMultibase' : 'zQ3shQvp7YmdxSZMHYWvfD5GvoavZz4REJ5P4Snw6Qy2PVN1o',
            'controller'         : 'did:btcr2:_'
          }
        ],
        'service' : [
          {
            'id'              : '#didcomm',
            'type'            : 'DIDCommMessaging',
            'serviceEndpoint' : 'http://example.com/didcomm'
          },
          {
            'type'            : 'SingletonBeacon',
            'id'              : '#initialP2PKH',
            'serviceEndpoint' : 'bitcoin:mwSrpBnrNZp1uWat1hf2dynpWKs7JWF518'
          },
          {
            'type'            : 'SingletonBeacon',
            'id'              : '#initialP2WPKH',
            'serviceEndpoint' : 'bitcoin:tb1q46auvxdypkjt75ny4n99v97j95hz592g675nyq'
          },
          {
            'type'            : 'SingletonBeacon',
            'id'              : '#initialP2TR',
            'serviceEndpoint' : 'bitcoin:tb1pj70k34zj0fnf7wlqdvpm93aesyg496kjaws9cyemaqhnggp8cp9qx7c4je'
          }
        ],
        'assertionMethod' : [
          '#initialKey'
        ],
        'capabilityDelegation' : [
          '#initialKey'
        ],
        'capabilityInvocation' : [
          '#initialKey'
        ],
        'authentication' : [
          '#initialKey'
        ],
        'id'       : 'did:btcr2:_',
        '@context' : [
          'https://www.w3.org/ns/did/v1.1',
          'https://btcr2.dev/context/v1'
        ]
      },
      'updates' : [
        {
          '@context' : [
            'https://btcr2.dev/context/v1',
            'https://w3id.org/json-ld-patch/v1',
            'https://w3id.org/zcap/v1',
            'https://w3id.org/security/data-integrity/v2'
          ],
          'patch' : [
            {
              'op'    : 'add',
              'path'  : '/service/4',
              'value' : {
                'id'              : '#dwn',
                'type'            : 'DecentralizedWebNode',
                'serviceEndpoint' : 'http://example.com/dwn'
              }
            }
          ],
          'sourceHash'      : 'AC_466VA2q_trSzux771a0a1a9ynBc2LT7Nf8m0Zido',
          'targetHash'      : 'jqdZFDnOP9Ftu4lOhBRwPINoneKy7p6vLnhwlLjHQmI',
          'targetVersionId' : 2,
          'proof'           : {
            'type'               : 'DataIntegrityProof',
            'cryptosuite'        : 'bip340-jcs-2025',
            'verificationMethod' : 'did:btcr2:x1qkel9rl0ltz6w5m3rypnsa4tncu5yst45qdsmwtms94zx6wm7cc2q8nnfh7#initialKey',
            'proofPurpose'       : 'capabilityInvocation',
            'capability'         : 'urn:zcap:root:did%3Abtcr2%3Ax1qkel9rl0ltz6w5m3rypnsa4tncu5yst45qdsmwtms94zx6wm7cc2q8nnfh7',
            'capabilityAction'   : 'Write',
            'proofValue'         : 'z3XzDFYWd3jNgVGPf1Hk2JXJZA1JE4aBE5GHrurgsAisp5AgLapXPdLvmXok7YJrXWEaCLe9TTyYNrnimGkUPoqU9'
          }
        }
      ]
    }
  }
};


const did = input.did;
const resolutionOptions = input.resolutionOptions as ResolutionOptions;

const resolution = DidBtcr2.resolve(did, resolutionOptions);

console.log(resolution);