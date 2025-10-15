import { DidBtcr2 } from '../../src/did-btcr2.js';

const resolution = await DidBtcr2.resolve('did:btcr2:k1q5pua0p3syhn3p3kpvuqkx7sxd9ndv6uffwvuv008n4nq6fdwv22x5q4qfp5h', {
  'sidecarData' : {
    'did'             : 'did:btcr2:k1q5pua0p3syhn3p3kpvuqkx7sxd9ndv6uffwvuv008n4nq6fdwv22x5q4qfp5h',
    'signalsMetadata' : {
      '2910c61eff717307e13f2f150156f566bacb96dccbad5f8959874c4d7ac94faf' : {
        'didUpdate' : {
          '@context' : [
            'https://w3id.org/security/v2',
            'https://w3id.org/zcap/v1',
            'https://w3id.org/json-ld-patch/v1'
          ],
          'patch' : [
            {
              'op'    : 'add',
              'path'  : '/service/3',
              'value' : {
                'type'            : 'SingletonBeacon',
                'id'              : 'did:btcr2:k1q5pua0p3syhn3p3kpvuqkx7sxd9ndv6uffwvuv008n4nq6fdwv22x5q4qfp5h#initialP2PKH',
                'serviceEndpoint' : 'bitcoin:mx1d72m2yzbJiTCdjrJKJNDtANURL3BGDD'
              }
            }
          ],
          'targetHash'      : '2Lj51vMAcfaXWF6Hfm8gTac4PPUzT1m45AadqLeVbF5W',
          'targetVersionId' : 2,
          'sourceHash'      : '34LDxujTRru6QRHZFEnN1i9sFvPiCexFSdCucVauEyFH',
          'proof'           : {
            'cryptosuite'        : 'bip340-jcs-2025',
            'type'               : 'DataIntegrityProof',
            'verificationMethod' : 'did:btcr2:k1q5pua0p3syhn3p3kpvuqkx7sxd9ndv6uffwvuv008n4nq6fdwv22x5q4qfp5h#initialKey',
            'proofPurpose'       : 'capabilityInvocation',
            'capability'         : 'urn:zcap:root:did%3Abtcr2%3Ak1q5pua0p3syhn3p3kpvuqkx7sxd9ndv6uffwvuv008n4nq6fdwv22x5q4qfp5h',
            'capabilityAction'   : 'Write',
            '@context'           : [
              'https://w3id.org/security/v2',
              'https://w3id.org/zcap/v1',
              'https://w3id.org/json-ld-patch/v1'
            ],
            'proofValue' : 'z5BPFwuLAjnJmY7h2nPNFCneXHzxyusufNSfmw7a8SiwbiHxUyXVXaJyV5fL6ZPd397uuAVVF8f7F9syX2aYyXsQR'
          }
        }
      }
    }
  }
});

console.log('resolution', JSON.stringify(resolution, null, 2));