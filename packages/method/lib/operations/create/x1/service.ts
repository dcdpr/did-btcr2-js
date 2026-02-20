import { payments } from 'bitcoinjs-lib';
import { regtest } from 'bitcoinjs-lib/src/networks';
import { SchnorrKeyPair } from '../../../../../keypair/src/index.js';
import other from '../../../data/regtest/x1/q2pgxznc/other.json' with { type: 'json' };

const keypair = SchnorrKeyPair.fromSecret(other.genesisKeys.secret);
const address = payments.p2wpkh({ pubkey: keypair.publicKey.compressed, network: regtest })?.address;
const service = {
  id              : `did:btcr2:x1q2pgxzncswls2cs9n08n4dx8ps2fyr66ptz9ggmzan89rw9ulqafjd4n5wq#service-1`,
  serviceEndpoint : `bitcoin:${address}`,
  type            : 'SingletonBeacon',
};
console.log('service:', service);