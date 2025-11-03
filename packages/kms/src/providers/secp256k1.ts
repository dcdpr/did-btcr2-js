import type { Algo } from '../types.js';
import { SchnorrKeyPair } from '@did-btcr2/keypair';

export interface AlgoProvider {
  algo: Algo;
  generate(): Promise<{ publicKey: Uint8Array; secret: Uint8Array }>;
  sign(secret: Uint8Array, msg: Uint8Array): Promise<Uint8Array>;
  verify(publicKey: Uint8Array, sig: Uint8Array, msg: Uint8Array): boolean;
}

export class Secp256k1SchnorrProvider implements AlgoProvider {
  algo: Algo = 'secp256k1-schnorr';
  async generate() {
    const kp = SchnorrKeyPair.generate();
    const secret = kp.secretKey!.bytes;
    const pub = kp.publicKey.compressed;
    return { publicKey: pub, secret };
  }

  async sign(secretKey: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
    const kp = new SchnorrKeyPair({ secretKey });
    const sig = kp.secretKey.sign(msg);
    return sig;
  }

  verify(publicKey: Uint8Array, sig: Uint8Array, msg: Uint8Array): boolean {
    const kp = new SchnorrKeyPair({ publicKey });
    return kp.publicKey.verify(sig, msg);
  }
}
