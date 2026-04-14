import { getNetwork } from '@did-btcr2/bitcoin';
import { p2wpkh } from '@scure/btc-signer';
import { SchnorrKeyPair } from '../../../../../keypair/src/index.js';
import other from '../../../data/regtest/x1/q2pgxznc/other.json' with { type: 'json' };

const keypair = SchnorrKeyPair.fromSecret(other.genesisKeys.secret);
const address = p2wpkh(keypair.publicKey.compressed, getNetwork('regtest')).address;
const service = {
  id              : `did:btcr2:x1q2pgxzncswls2cs9n08n4dx8ps2fyr66ptz9ggmzan89rw9ulqafjd4n5wq#service-1`,
  serviceEndpoint : `bitcoin:${address}`,
  type            : 'SingletonBeacon',
};
console.log('service:', service);
