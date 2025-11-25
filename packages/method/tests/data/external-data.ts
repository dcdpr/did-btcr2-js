import { Canonicalization } from '@did-btcr2/common';

export default [
  {
    'did'             : 'did:btcr2:x1qr2qkklutnvsrnpzfq6vu85pc2n52a7wntxzg58xszvg84nvec6es50qxme',
    'network'         : 'bitcoin',
    'genesisBytes'    : Canonicalization.fromHex('d40b5bfc5cd901cc224834ce1e81c2a74577ce9acc2450e6809883d66cce3598'),
    'secretKey'       : 'cce7c5dbfc6675f79baf4a2bc0416f9bdd2a4e42b84c50795ee1990ce2cf685f',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/TR/did-1.1',
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
    'did'             : 'did:btcr2:x1qhg4zn3uhgua0vft2jlvfzmd0ptwjyjw2n40tc2edy8udsvrrmpdvq90fvk',
    'network'         : 'mutinynet',
    'genesisBytes'    : Canonicalization.fromHex('d1514e3cba39d7b12b54bec48b6d7856e9124e54eaf5e159690fc6c1831ec2d6'),
    'secretKey'       : '09b4d3303dd644a230431842fd63420fe049ae8958c8e31066674bc602f16dda',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/TR/did-1.1',
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
    'did'             : 'did:btcr2:x1qgqeq5dzura3ed8zcc86yvwdemhcgae42cu5fa5smske9ylsv7wr62hegar',
    'network'         : 'regtest',
    'genesisBytes'    : Canonicalization.fromHex('019051a2e0fb1cb4e2c60fa231cdceef847735563944f690dc2d9293f0679c3d'),
    'secretKey'       : 'a850d590e8e499b9860e97ab826fb94c1f1b91d7f4707b29f1a9bb9b5b68f4e0',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/TR/did-1.1',
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
    'did'             : 'did:btcr2:x1qy2nm3n6tpawv2m2z0z2qg696wwk4umc9xptu59mey7kwczhwl9qzvvadj3',
    'network'         : 'signet',
    'genesisBytes'    : Canonicalization.fromHex('153dc67a587ae62b6a13c4a02345d39d6af3782982be50bbc93d67605777ca01'),
    'secretKey'       : 'ab4884c90b11b5142120f0a9b315c9a0b177ce6cae036795450646c7b5d3eb9c',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/TR/did-1.1',
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
    'did'             : 'did:btcr2:x1q0ryu6z0gwyjksl8dgj5gpq20khuxy00dzm2f5eh83y43x9gc7wsw0gp2mh',
    'network'         : 'testnet3',
    'genesisBytes'    : Canonicalization.fromHex('c64e684f43892b43e76a2544040a7dafc311ef68b6a4d3373c495898a8c79d07'),
    'secretKey'       : '1d88c851de18e909caa15dcd01b2687c63e37b61a3c3f62c9c796f4690b0675a',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/TR/did-1.1',
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
    'did'             : 'did:btcr2:x1qshuft56xhzstmschcjmslts3y4kakdvv4gjr5dpghhuwu2s804fjycl9q9',
    'network'         : 'testnet4',
    'genesisBytes'    : Canonicalization.fromHex('2fc4ae9a35c505ee18be25b87d70892b6ed9ac655121d1a145efc771503bea99'),
    'secretKey'       : 'd2e0289f309fa8e68d2576e07864e2aafd4caebbfb6f26780da3c30c4b7bcffa',
    'genesisDocument' : {
      'id'       : 'did:btcr2:_',
      '@context' : [
        'https://www.w3.org/TR/did-1.1',
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