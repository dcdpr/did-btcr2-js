import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { LocalKeyManager } from '../src/index.js';

const keyPair = SchnorrKeyPair.generate();
const keyManager = new LocalKeyManager();
console.log('keyManager:', keyManager);

keyManager.importKey(keyPair);
console.log('keyManager.listKeys before removal', keyManager.listKeys().length);
console.log('keyManager.activeKeyId before removal', keyManager.activeKeyId);

keyManager.removeKey(keyPair.publicKey.hex);
console.log('keyManager.listKeys after removal', keyManager.listKeys().length);
console.log('keyManager.activeKeyId after removal', keyManager.activeKeyId);

keyManager.importKey(keyPair);
console.log('keyManager.listKeys before removal', keyManager.listKeys().length);
console.log('keyManager.activeKeyId before removal', keyManager.activeKeyId);

keyManager.removeKey(keyPair.publicKey.hex, { force: true });
console.log('keyManager.listKeys after removal', keyManager.listKeys().length);
console.log('keyManager.activeKeyId after removal', keyManager.activeKeyId);