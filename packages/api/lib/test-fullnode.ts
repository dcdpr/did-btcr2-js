/**
 * Resolves a regtest DID through the full node signal-discovery path.
 *
 * `signalDiscovery: 'fullnode'` scans every block over Bitcoin Core RPC instead of
 * reading an Esplora index. Drop the field (or set 'indexer') to compare: both paths
 * must resolve the same document and versionId from the same chain.
 *
 * Usage: bun lib/test-fullnode.ts
 */

import type { ResolutionOptions } from '@did-btcr2/method';
import { DidBtcr2Api } from '../src/api.js';
import type { ApiConfig } from '../src/types.js';

const did = 'did:btcr2:k1qgppexmyqqlce9netky3h4ur2j9dur83j7m7vva497kfhdgsq2t9nxgqj3x0s';

const apiConfig: ApiConfig = {
  btc : {
    network         : 'regtest',
    rpc             : { host: 'http://localhost:18443', username: 'polaruser', password: 'polarpass' },
    signalDiscovery : 'fullnode',
  },
};

const context = [
  'https://w3id.org/security/v2',
  'https://w3id.org/zcap/v1',
  'https://w3id.org/json-ld-patch/v1',
  'https://btcr2.dev/context/v1'
];

// The signed update whose hash is anchored in the beacon signal on chain.
const resolutionOptions: ResolutionOptions = {
  sidecar : {
    updates : [
      {
        '@context' : context,
        patch      : [
          {
            op    : 'replace',
            path  : '/service/0/serviceEndpoint',
            value : 'bitcoin:mmBCLTLMZqUFhiG4vhhaM7EbLRN6h7sCfG'
          }
        ],
        targetHash      : 'hduKs2Pj2VpUueLkvWLSR5MeSjTYgKPO02H9zrqjUKw',
        targetVersionId : 2,
        sourceHash      : 'AHcGbJ3OGSIrjVTIHFbIc2OEA25EDtMOM1uXBlw2qDQ',
        proof           : {
          '@context'         : context,
          cryptosuite        : 'bip340-jcs-2025',
          type               : 'DataIntegrityProof',
          verificationMethod : `${did}#initialKey`,
          proofPurpose       : 'capabilityInvocation',
          capability         : `urn:zcap:root:${encodeURIComponent(did)}`,
          capabilityAction   : 'Write',
          proofValue         : 'z4uLUfMjfUufPGgeXa9ZgJ1DR7bnH7FAkHVf83ebT1C4iwFtiJPPNgStUrT9cpV2h8PKdN6RH4TFJgrRd7APPBqWA'
        }
      }
    ]
  }
};

const api = new DidBtcr2Api(apiConfig);

const resolutionResult = await api.resolveDid(did, resolutionOptions);
console.log('resolutionResult', JSON.stringify(resolutionResult, null, 2));
