import { BeaconCoordinator } from '../../src/core/beacon/aggregation/coordinator.js';
import { NostrAdapter } from '../../src/core/beacon/aggregation/protocol/nostr.js';

const nostr = new NostrAdapter();
const coordinator = new BeaconCoordinator(nostr);
await coordinator.protocol.start();