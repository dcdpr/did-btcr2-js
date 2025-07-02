import crypto from 'crypto';

export class KeyPairUtils {
  // Helper: convert big-endian bytes to BigInt
  public static bigEndianToInt(bytes: Uint8Array): bigint {
    return bytes.reduce((num, b) => (num << 8n) + BigInt(b), 0n);
  }

  // Helper: convert BigInt to big-endian Uint8Array of specified length
  public static intToBigEndian(xInit: bigint, length: number): Uint8Array {
    let x = xInit;
    const result = new Uint8Array(length);
    for (let i = length - 1; i >= 0; i--) {
      result[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return result;
  }

  // Helper: uniform random integer in [0, mod)
  public static randBelow(mod: bigint): bigint {
    const byteLen = Math.ceil(mod.toString(2).length / 8);
    let r: bigint;
    do {
      const buf = crypto.randomBytes(byteLen);
      r = this.bigEndianToInt(buf);
    } while (r >= mod);
    return r;
  }
}