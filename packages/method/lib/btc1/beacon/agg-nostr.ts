import { BeaconCoordinator, NostrAdapter } from '../../../src/index.js';

const nostr = new NostrAdapter();
const coordinator = new BeaconCoordinator(nostr);
await coordinator.protocol.start();