import { Secp256k1SecretKey } from '@did-btcr2/keypair';
import { keyAggExport, keyAggregate } from '@scure/btc-signer/musig2';

const PubKey = Secp256k1SecretKey.generate().computePublicKey().compressed;
const PubKey2 = Secp256k1SecretKey.generate().computePublicKey().compressed;
const PubKey3 = Secp256k1SecretKey.generate().computePublicKey().compressed;

const aggregateKeys = keyAggregate([PubKey, PubKey2, PubKey3])
console.log('Aggregate Keys:', aggregateKeys);
const aggExport = keyAggExport(aggregateKeys);
console.log('Aggregate Keys Export:', aggExport);