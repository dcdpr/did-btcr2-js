import { hex } from '@scure/base';

export default [
  {
    'did'             : 'did:btcr2:x1qqh89yza5ypfw2eud2r0c8rkdc9wcu0n5d09520evfpu637lynyjyj33xgn',
    'network'         : 'bitcoin',
    'genesisBytes'    : hex.decode('2e72905da102972b3c6a86fc1c766e0aec71f3a35e5a29f96243cd47df24c922'),
    'secretKey'       : 'cce7c5dbfc6675f79baf4a2bc0416f9bdd2a4e42b84c50795ee1990ce2cf685f',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/ns/did/v1.1',
        'https://btcr2.dev/context/v1'
      ],
      'verificationMethod' : [
        {
          'id'                 : 'did:btcr2:_#key-0',
          'type'               : 'Multikey',
          'controller'         : 'did:btcr2:_',
          'publicKeyMultibase' : 'zQ3shiAVyapkPizvsLJZ8mYqPZetmbNNjgLVWTe5CLKZjvs34'
        }
      ],
      'authentication' : [
        'did:btcr2:_#key-0'
      ],
      'assertionMethod' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityInvocation' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityDelegation' : [
        'did:btcr2:_#key-0'
      ],
      'service' : [
        {
          'id'              : 'did:btcr2:_#service-0',
          'serviceEndpoint' : 'bitcoin:12QG2GG9TWPD16SWyfWCsW4W3NhMFnnSFK',
          'type'            : 'SingletonBeacon'
        }
      ]
    }
  },
  {
    'did'             : 'did:btcr2:x1q4jzzjhqpua2rruh527cxxlap7y32wsf75fkhp7wfc4gsdut46r4qgs0q5t',
    'network'         : 'mutinynet',
    'genesisBytes'    : hex.decode('64214ae00f3aa18f97a2bd831bfd0f89153a09f5136b87ce4e2a88378bae8750'),
    'secretKey'       : '09b4d3303dd644a230431842fd63420fe049ae8958c8e31066674bc602f16dda',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/ns/did/v1.1',
        'https://btcr2.dev/context/v1'
      ],
      'verificationMethod' : [
        {
          'id'                 : 'did:btcr2:_#key-0',
          'type'               : 'Multikey',
          'controller'         : 'did:btcr2:_',
          'publicKeyMultibase' : 'zQ3shV9nmEgL68pVXfUGrT48bPHxwf1oPsNxhvLTETM4BhuzE'
        }
      ],
      'authentication' : [
        'did:btcr2:_#key-0'
      ],
      'assertionMethod' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityInvocation' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityDelegation' : [
        'did:btcr2:_#key-0'
      ],
      'service' : [
        {
          'id'              : 'did:btcr2:_#service-0',
          'serviceEndpoint' : 'bitcoin:mhME7XiWpho6Ft4pvT3U3h6X8hHtE58ZDJ',
          'type'            : 'SingletonBeacon'
        }
      ]
    }
  },
  {
    'did'             : 'did:btcr2:x1qt3ygxdusc6e0hncnyz6qyl5dm4dhk2ee9gz7vnr4eedna22mfu0quflere',
    'network'         : 'regtest',
    'genesisBytes'    : hex.decode('e24419bc863597de789905a013f46eeadbd959c9502f3263ae72d9f54ada78f0'),
    'secretKey'       : 'a850d590e8e499b9860e97ab826fb94c1f1b91d7f4707b29f1a9bb9b5b68f4e0',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/ns/did/v1.1',
        'https://btcr2.dev/context/v1'
      ],
      'verificationMethod' : [
        {
          'id'                 : 'did:btcr2:_#key-0',
          'type'               : 'Multikey',
          'controller'         : 'did:btcr2:_',
          'publicKeyMultibase' : 'zQ3shqQpWkrPtkqj8hELGDbQ1EWY2hXJ1MvYXSnQvdBxDTw69'
        }
      ],
      'authentication' : [
        'did:btcr2:_#key-0'
      ],
      'assertionMethod' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityInvocation' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityDelegation' : [
        'did:btcr2:_#key-0'
      ],
      'service' : [
        {
          'id'              : 'did:btcr2:_#service-0',
          'serviceEndpoint' : 'bitcoin:mqTxx2aK3Ay3cDk5xM5E5wT6J4QoT6f8vT',
          'type'            : 'SingletonBeacon'
        }
      ]
    }
  },
  {
    'did'             : 'did:btcr2:x1qya6vknk7z39cf3h4m3cpnj92n2exmwe4h29putcjd5tkrrxf5qrqzx200h',
    'network'         : 'signet',
    'genesisBytes'    : hex.decode('3ba65a76f0a25c2637aee380ce4554d5936dd9add450f1789368bb0c664d0030'),
    'secretKey'       : 'ab4884c90b11b5142120f0a9b315c9a0b177ce6cae036795450646c7b5d3eb9c',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/ns/did/v1.1',
        'https://btcr2.dev/context/v1'
      ],
      'verificationMethod' : [
        {
          'id'                 : 'did:btcr2:_#key-0',
          'type'               : 'Multikey',
          'controller'         : 'did:btcr2:_',
          'publicKeyMultibase' : 'zQ3shbsnA4NgHdgpfGHXDoXKL3y8KsfQLwSyv6hZ6iRVWkqsy'
        }
      ],
      'authentication' : [
        'did:btcr2:_#key-0'
      ],
      'assertionMethod' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityInvocation' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityDelegation' : [
        'did:btcr2:_#key-0'
      ],
      'service' : [
        {
          'id'              : 'did:btcr2:_#service-0',
          'serviceEndpoint' : 'bitcoin:moMmq18Ftz8pR55KHmxLM6yeEwWaeevzZr',
          'type'            : 'SingletonBeacon'
        }
      ]
    }
  },
  {
    'did'             : 'did:btcr2:x1qdmddq885hv9r590s8ep97s0cu9vm4qfn57h53exx4hcxhlzsjwqgmgm0zu',
    'network'         : 'testnet3',
    'genesisBytes'    : hex.decode('76d680e7a5d851d0af81f212fa0fc70acdd4099d3d7a4726356f835fe2849c04'),
    'secretKey'       : '1d88c851de18e909caa15dcd01b2687c63e37b61a3c3f62c9c796f4690b0675a',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/ns/did/v1.1',
        'https://btcr2.dev/context/v1'
      ],
      'verificationMethod' : [
        {
          'id'                 : 'did:btcr2:_#key-0',
          'type'               : 'Multikey',
          'controller'         : 'did:btcr2:_',
          'publicKeyMultibase' : 'zQ3shQ65ey4yGmtUKXjf65wm5sK45bNpBSg6iW2cna2BTPgxD'
        }
      ],
      'authentication' : [
        'did:btcr2:_#key-0'
      ],
      'assertionMethod' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityInvocation' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityDelegation' : [
        'did:btcr2:_#key-0'
      ],
      'service' : [
        {
          'id'              : 'did:btcr2:_#service-0',
          'serviceEndpoint' : 'bitcoin:msAqzLRBfzWWcRWfcGgcNpREa792T6xptt',
          'type'            : 'SingletonBeacon'
        }
      ]
    }
  },
  {
    'did'             : 'did:btcr2:x1q379mhzgt5764yccdq9jx0a5fths38j2ngrly3tfcsa9sax0xgpe2n9d70x',
    'network'         : 'testnet4',
    'genesisBytes'    : hex.decode('7c5ddc485d3daa9318680b233fb44aef089e4a9a07f24569c43a5874cf320395'),
    'secretKey'       : 'd2e0289f309fa8e68d2576e07864e2aafd4caebbfb6f26780da3c30c4b7bcffa',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/ns/did/v1.1',
        'https://btcr2.dev/context/v1'
      ],
      'verificationMethod' : [
        {
          'id'                 : 'did:btcr2:_#key-0',
          'type'               : 'Multikey',
          'controller'         : 'did:btcr2:_',
          'publicKeyMultibase' : 'zQ3shYAzXGv2P1WdUoAQhesKcpY3zHCd2gMpwVNvXc3RathPx'
        }
      ],
      'authentication' : [
        'did:btcr2:_#key-0'
      ],
      'assertionMethod' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityInvocation' : [
        'did:btcr2:_#key-0'
      ],
      'capabilityDelegation' : [
        'did:btcr2:_#key-0'
      ],
      'service' : [
        {
          'id'              : 'did:btcr2:_#service-0',
          'serviceEndpoint' : 'bitcoin:mgUaB6JY9JWo2gGVxpwdwGUW2FNEDFEkJs',
          'type'            : 'SingletonBeacon'
        }
      ]
    }
  }
];