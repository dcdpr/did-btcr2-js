import { CURVE } from '@did-btc1/common';
import { PublicKey, SecretKey } from '@did-btc1/keypair';
import { sha256 } from '@noble/hashes/sha2';
import { script as bjsScript, opcodes } from 'bitcoinjs-lib';
import { randomBytes } from 'crypto';
import * as tinysecp from 'tiny-secp256k1';

// Helper: convert big-endian bytes to BigInt
function bigEndianToInt(bytes: Uint8Array): bigint {
  return bytes.reduce((num, b) => (num << 8n) + BigInt(b), 0n);
}

// Helper: convert BigInt to big-endian Uint8Array of specified length
function intToBigEndian(xInit: bigint, length: number): Uint8Array {
  let x = xInit;
  const result = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    result[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return result;
}

// Uniform random integer in [0, mod)
function randBelow(mod: bigint): bigint {
  const byteLen = Math.ceil(mod.toString(2).length / 8);
  let r: bigint;
  do {
    const buf = randomBytes(byteLen);
    r = bigEndianToInt(buf);
  } while (r >= mod);
  return r;
}

// Concatenate multiple Uint8Arrays
function concat(...buffers: Uint8Array[]): Uint8Array {
  const totalLen = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const b of buffers) {
    out.set(b, pos);
    pos += b.length;
  }
  return out;
}

// Wrapper for PublicKey for additional secp256k1 point operations
export class S256Point {
  public readonly pk: PublicKey;
  constructor(pk: PublicKey) {
    this.pk = pk;
  }

  static parseXOnly(xbytes: Uint8Array): S256Point {
    if (xbytes.length !== 32) {
      throw new Error('Invalid x-only length');
    }
    // BIP340 assumes even Y, prefix 0x02
    const comp = new Uint8Array(33);
    comp[0] = 0x02;
    comp.set(xbytes, 1);
    return new S256Point(new PublicKey(comp));
  }

  static combine(points: S256Point[]): S256Point {
    if (points.length === 0) {
      throw new Error('No points to combine');
    }
    let acc = points[0].pk.compressed;
    for (let i = 1; i < points.length; i++) {
      const next = points[i].pk.compressed;
      const added = tinysecp.pointAdd(acc, next);
      if (!added) throw new Error('Point addition failed');
      acc = added;
    }
    return new S256Point(new PublicKey(acc));
  }

  multiply(scalar: bigint): S256Point {
    const scalarBytes = intToBigEndian(scalar, 32);
    const res = tinysecp.pointMultiply(this.pk.compressed, scalarBytes);
    if (!res) throw new Error('Point multiply failed');
    return new S256Point(new PublicKey(res));
  }

  sec(): Uint8Array {
    return this.pk.compressed;
  }

  xonly(): Uint8Array {
    // 32-byte x-coordinate
    return this.pk.compressed.slice(1, 33);
  }

  get parity(): boolean {
    // true if odd Y (prefix 0x03)
    return this.pk.compressed[0] === 0x03;
  }

  // BIP341 tweak: Q = P + t*G
  tweak(merkleRoot: Uint8Array): Uint8Array {
    const h = sha256(concat(this.xonly(), merkleRoot));
    return new Uint8Array(h);
  }

  tweakedKey(merkleRoot: Uint8Array): S256Point {
    const t = bigEndianToInt(this.tweak(merkleRoot));
    // G = PublicKey.fromSecretKey(1)
    const G = PublicKey.fromSecretKey(intToBigEndian(1n, 32));
    const Gpt = new S256Point(G).multiply(t);
    const sum = S256Point.combine([this, Gpt]);
    return sum;
  }

  evenPoint(): S256Point {
    // Ensure Y is even: if odd, flip the prefix
    if (!this.parity) return this;
    const comp = this.pk.compressed;
    const newComp = new Uint8Array(comp);
    newComp[0] = 0x02;
    return new S256Point(new PublicKey(newComp));
  }
}

// Generator point and group order
const Gpt = new S256Point(PublicKey.fromSecretKey(intToBigEndian(1n, 32)));
const N = CURVE.n;

/**
 * MuSig Taproot script helper
 */
export class MuSigTapScript {
  public readonly points: S256Point[];
  public readonly commitment: Uint8Array;
  public readonly coefs: bigint[];
  private coefLookup: Map<string, bigint>;
  public readonly point: S256Point;
  public commands: (Uint8Array | number)[];

  constructor(pubkeys: Uint8Array[], locktime?: number, sequence?: number) {
    if (locktime !== undefined && sequence !== undefined) {
      throw new Error('Only one of locktime or sequence allowed');
    }
    if (pubkeys.length === 0) {
      throw new Error('Need at least one public key');
    }
    // sort x-only keys lexicographically
    const xonlys = pubkeys.map(b => b.slice(-32)).sort(Buffer.compare);
    this.points = xonlys.map(x => S256Point.parseXOnly(x));
    this.commitment = sha256(concat(...xonlys));
    // coefficients
    this.coefs = xonlys.map(x => bigEndianToInt(sha256(concat(this.commitment, x))));
    if (this.coefs.length > 1) this.coefs[1] = 1n;
    this.coefLookup = new Map();
    xonlys.forEach((x, i) => this.coefLookup.set(Buffer.from(x).toString('hex'), this.coefs[i]));
    // aggregate public key
    const weighted = this.points.map((pt, i) => pt.multiply(this.coefs[i]));
    this.point = S256Point.combine(weighted);
    // build script commands
    this.commands = [];
    if (locktime !== undefined) {
      this.commands.push(bjsScript.number.encode(locktime));
      this.commands.push(opcodes.OP_CHECKLOCKTIMEVERIFY);
      this.commands.push(opcodes.OP_DROP);
    } else if (sequence !== undefined) {
      this.commands.push(bjsScript.number.encode(sequence));
      this.commands.push(opcodes.OP_CHECKSEQUENCEVERIFY);
      this.commands.push(opcodes.OP_DROP);
    }
    this.commands.push(this.point.xonly(), opcodes.OP_CHECKSIG);
  }

  generateNonces(): { secrets: [bigint, bigint]; points: [S256Point, S256Point] } {
    const k1 = randBelow(N);
    const k2 = randBelow(N);
    const r1 = Gpt.multiply(k1);
    const r2 = Gpt.multiply(k2);
    return { secrets: [k1, k2], points: [r1, r2] };
  }

  nonceSums(pairs: [S256Point, S256Point][]): [S256Point, S256Point] {
    const r1 = S256Point.combine(pairs.map(p => p[0]));
    const r2 = S256Point.combine(pairs.map(p => p[1]));
    return [r1, r2];
  }

  computeCoefficient(nonceSums: [S256Point, S256Point], sigHash: Uint8Array): bigint {
    const data = concat(nonceSums[0].sec(), nonceSums[1].sec(), this.point.xonly(), sigHash);
    return bigEndianToInt(sha256(data));
  }

  computeK(nSecrets: [bigint, bigint], nonceSums: [S256Point, S256Point], sigHash: Uint8Array): bigint {
    const h = this.computeCoefficient(nonceSums, sigHash);
    return (nSecrets[0] + h * nSecrets[1]) % N;
  }

  computeR(nonceSums: [S256Point, S256Point], sigHash: Uint8Array): S256Point {
    const h = this.computeCoefficient(nonceSums, sigHash);
    return S256Point.combine([nonceSums[0], nonceSums[1].multiply(h)]);
  }

  sign(
    skBytes: Uint8Array,
    k: bigint,
    r: S256Point,
    sigHash: Uint8Array,
    merkleRoot: Uint8Array = new Uint8Array()
  ): bigint {
    // compute external pubkey
    const ext = merkleRoot.length
      ? this.point.tweakedKey(merkleRoot)
      : this.point.evenPoint();
    const msg = concat(r.xonly(), ext.xonly(), sigHash);
    const e = bigEndianToInt(sha256(msg)) % N;
    const xhex = Buffer.from(PublicKey.fromSecretKey(skBytes).x).toString('hex');
    const h_i = this.coefLookup.get(xhex);
    if (h_i === undefined) throw new Error('Key not in MuSig set');
    const c_i = (h_i * e) % N;
    const kReal = r.parity === ext.parity ? k : (N - k) % N;
    const sk = new SecretKey(skBytes);
    const sKey = sk.computePublicKey(); // public key bytes
    const secret = this.point.parity === (new PublicKey(sKey).parity === 3) ? sk.seed : (N - sk.seed) % N;
    return (kReal + c_i * secret) % N;
  }

  getSignature(
    sSum: bigint,
    r: S256Point,
    sigHash: Uint8Array,
    merkleRoot: Uint8Array = new Uint8Array()
  ): Uint8Array {
    let ext: S256Point;
    let s: bigint;
    if (merkleRoot.length) {
      ext = this.point.tweakedKey(merkleRoot);
      const tweak = bigEndianToInt(this.point.tweak(merkleRoot));
      const msg = concat(r.xonly(), ext.xonly(), sigHash);
      const e = bigEndianToInt(sha256(msg)) % N;
      s = ext.parity ? (N - sSum - e * tweak) % N : (sSum + e * tweak) % N;
    } else {
      ext = this.point.evenPoint();
      s = sSum % N;
    }
    const sig = concat(r.xonly(), intToBigEndian(s, 32));
    if (!tinysecp.verifySchnorr(sig, sigHash, ext.sec())) {
      throw new Error('Invalid signature');
    }
    return sig;
  }
}
