import { BitcoinNetworkNames } from '@did-btcr2/common';
import { Btc1Read } from '../../src/index.js';

const signals = await Btc1Read.findNextSignals({
  contemporaryBlockHeight : 4000,
  targetTime              : 1746015324,
  beacons                 : [
    {
      id              : '#initialP2WPKH',
      type            : 'SingletonBeacon',
      serviceEndpoint : 'bitcoin:bcrt1qlgq8mywrjff7ycan95j8cs3p3g8nd2v2ta4769',
      address         : 'bcrt1qlgq8mywrjff7ycan95j8cs3p3g8nd2v2ta4769'
    }
  ],
  network : BitcoinNetworkNames.regtest
});

console.log('signals', signals);