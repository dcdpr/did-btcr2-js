import { SchnorrKeyPair } from "@did-btcr2/keypair";
import { Kms } from "../src/index.js";

const keyPair = SchnorrKeyPair.generate();
const kms = new Kms();
console.log('kms:', kms);

await kms.importKey(keyPair);
console.log('kms.listKeys before removal', kms.listKeys().length);
console.log('kms.activeKeyId before removal', kms.activeKeyId);

await kms.removeKey(keyPair.publicKey.hex).catch((e) => {
  console.error(e);
});
    
await kms.removeKey(keyPair.publicKey.hex, { force: true });
console.log('kms.listKeys after removal', kms.listKeys().length);
console.log('kms.activeKeyId after removal', kms.activeKeyId);