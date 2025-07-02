import { SecretKey } from '@did-btc1/keypair';
import { keyAggExport, keyAggregate } from '@scure/btc-signer/musig2';

const PubKey = SecretKey.generate().computePublicKey();
const PubKey2 = SecretKey.generate().computePublicKey();
const PubKey3 = SecretKey.generate().computePublicKey();

const aggregateKeys = keyAggregate([PubKey, PubKey2, PubKey3])
console.log('Aggregate Keys:', aggregateKeys);
const aggExport = keyAggExport(aggregateKeys);
console.log('Aggregate Keys Export:', aggExport);
