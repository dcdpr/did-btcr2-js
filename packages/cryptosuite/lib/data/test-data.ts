export default {
  did      : 'did:btcr2:regtest:k1qtwrw6r00e3rh6hv02ak42mweykcg0u7n478vl5ks4ugfppl9dfs7m3gyfg',
  document : {
    '@context' : [
      'https://www.w3.org/ns/did/v1',
      'https://did-btcr2/TBD/context'
    ],
    id                 : 'did:btcr2:regtest:k1qtwrw6r00e3rh6hv02ak42mweykcg0u7n478vl5ks4ugfppl9dfs7m3gyfg',
    verificationMethod : [
      {
        id                 : '#initialKey',
        type               : 'Multikey',
        controller         : 'did:btcr2:regtest:k1qtwrw6r00e3rh6hv02ak42mweykcg0u7n478vl5ks4ugfppl9dfs7m3gyfg',
        publicKeyMultibase : 'zQ3shcERTF2BZqz4v51hDdPdM4di9xFWNadCakCkQmNEZPdPt'
      }
    ],
    authentication : [
      '#initialKey'
    ],
    assertionMethod : [
      '#initialKey'
    ],
    capabilityInvocation : [
      '#initialKey'
    ],
    capabilityDelegation : [
      '#initialKey'
    ],
    service : [
      {
        type            : 'SingletonBeacon',
        id              : '#initialP2PKH',
        serviceEndpoint : 'bitcoin:mweefdk6gdeBXKEx9wFmqvjE4CRT9GjhRK'
      },
      {
        type            : 'SingletonBeacon',
        id              : '#initialP2WPKH',
        serviceEndpoint : 'bitcoin:bcrt1qkrm2qrqztrkv687avd8x20q67qlgg5dq06ymee'
      },
      {
        type            : 'SingletonBeacon',
        id              : '#initialP2TR',
        serviceEndpoint : 'bitcoin:bcrt1pd6wtgugutkvpga9m8268xlq38tms38pg73y29a4enh0vp8c6w3nqksa54w'
      }
    ]
  },
  keyPair : {
    secretKey : new Uint8Array([69, 112, 198, 176, 14, 103, 100, 73, 35, 179, 169, 83, 80, 213, 189, 190, 118, 200, 5, 43, 20, 46, 148, 60, 109, 37, 134, 164, 162, 174, 185, 201]),
    publicKey  : new Uint8Array([2, 220, 55, 104, 111, 126, 98, 59, 234, 236, 122, 187, 106, 171, 110, 201, 45, 132, 63, 158, 157, 124, 118, 126, 150, 133, 120, 132, 132, 63, 43, 83, 15])
  },
};