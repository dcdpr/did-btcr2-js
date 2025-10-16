import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { KeyManager } from '../../../method/src/index.js';

const secretKey = new Uint8Array([
  159,  79, 128, 155, 191, 173,  89, 197,
  77, 153,  66, 245, 104,  93, 212, 152,
  14, 174,   1,  99,  18,  32,  32,  87,
  255, 108, 254,  69, 207, 106, 115,  41
]);
console.log('secretKey', secretKey);
const keys = new SchnorrKeyPair({ secretKey });
console.log('keys', keys);
const keyManager = new KeyManager({ keys });
console.log(keyManager);