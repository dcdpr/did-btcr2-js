import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { BeaconCoordinator } from '../../src/core/beacon/aggregation/coordinator.js';
import { DidBtcr2, NostrAdapter } from '../../src/index.js';

const kp = SchnorrKeyPair.generate();
const did = await DidBtcr2.create({ idType: 'KEY', genesisBytes: kp.publicKey.compressed })
const keys = kp.raw;
const protocol = new NostrAdapter();

const coordinator = new BeaconCoordinator({ protocol, did, keys });
coordinator.protocol.start();