import type { NetworkName } from '@did-btcr2/api';
import { DEFAULT_CAS_GATEWAY, DidBtcr2Api } from '@did-btcr2/api';

const did = 'did:btcr2:k1q5prr73dxh76el6tfl09skfm49uqxxqra8cqxszy9yntqt852ulecrsrxkp82';
const resolutionOptions = {
  'sidecar' : {
    'updates' : [
      {
        '@context' : [
          'https://w3id.org/security/v2',
          'https://w3id.org/zcap/v1',
          'https://w3id.org/json-ld-patch/v1',
          'https://btcr2.dev/context/v1',
          'https://w3id.org/security/data-integrity/v2'
        ],
        'patch' : [
          {
            'op'    : 'add',
            'path'  : '/service/0',
            'value' : {
              'id'              : 'did:btcr2:k1q5prr73dxh76el6tfl09skfm49uqxxqra8cqxszy9yntqt852ulecrsrxkp82#service-1',
              'type'            : 'MyService',
              'serviceEndpoint' : 'https://localhost:1234/'
            }
          }
        ],
        'sourceHash'      : 'l7zFAm7uHNMCDDOXqm0GXJqsN1QZd5JpI4J-aM5hpiI=',
        'targetHash'      : '9izUOyujZSsOpEoMBqmAZ7GSJuQWNs56APNzGz7FlCg=',
        'targetVersionId' : 2,
        'proof'           : {
          'type'               : 'DataIntegrityProof',
          'cryptosuite'        : 'bip340-jcs-2025',
          'verificationMethod' : 'did:btcr2:k1q5prr73dxh76el6tfl09skfm49uqxxqra8cqxszy9yntqt852ulecrsrxkp82#initialKey',
          'proofPurpose'       : 'capabilityInvocation',
          'capability'         : 'urn:zcap:root:did%3Abtcr2%3Ak1q5prr73dxh76el6tfl09skfm49uqxxqra8cqxszy9yntqt852ulecrsrxkp82',
          'capabilityAction'   : 'Write',
          'proofValue'         : 'z5zXkHkNjVarQqTq74Ut9sDt3MYpD8UMnY4MSZgjWiTopefxqbDoQARru8SRA55SqZDdcqbBYdfn4w218F1YaywyE'
        }
      }
    ]
  }
};
const apiConfig = { btc: { network: 'mutinynet' as NetworkName }, cas: { gateway: DEFAULT_CAS_GATEWAY } };
const api = new DidBtcr2Api(apiConfig);
const resolutionResult = await api.resolveDid(did, resolutionOptions as any);
console.log('resolutionResult', JSON.stringify(resolutionResult, null, 2));