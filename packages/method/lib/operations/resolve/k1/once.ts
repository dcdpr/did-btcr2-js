import { BitcoinConnection } from '@did-btcr2/bitcoin';
import { DidBtcr2 } from '../../../../src/did-btcr2.js';
import type { ResolutionOptions } from '../../../../src/index.js';
import { BeaconSignalDiscovery } from '../../../../src/index.js';

const did = 'did:btcr2:k1q5psrwzjhw7nkxd0vshleh42lpk87tz80f24f2s6wjuntg8jpv8ykmqj7ec8p';
const resolutionOptions = {} as ResolutionOptions;
const resolver = DidBtcr2.resolve(did, resolutionOptions);
let state = resolver.resolve();
const bitcoin = BitcoinConnection.forNetwork('mutinynet');
while(state.status === 'action-required') {
  for(const need of state.needs) {
    switch(need.kind) {
      case 'NeedGenesisDocument':
        throw new Error(`Genesis document required but not in sidecar for ${did}`);

      case 'NeedBeaconSignals': {
        console.log(`  Fetching beacon signals for ${need.beaconServices.length} service(s) ...`);
        const signals = await BeaconSignalDiscovery.indexer(
          [...need.beaconServices], bitcoin
        );
        resolver.provide(need, signals);
        break;
      }

      case 'NeedCASAnnouncement':
        throw new Error(`CAS announcement not in sidecar: ${need.announcementHash}`);

      case 'NeedSignedUpdate':
        throw new Error(`Signed update not in sidecar: ${need.updateHash}`);
    }
  }
  state = resolver.resolve();
}

console.log(JSON.stringify(state, null, 2));