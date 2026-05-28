import { HASH_BIT_LENGTH, HASH_BYTE_LENGTH } from './constants.js';
import {
  base64ToBigInt, base64ToHash,
  bigIntToBase64, bigIntToHash, bigIntToHex,
  blockHash, hashesEqual,
  hashToBase64, hashToHex,
  hexToBigInt, hexToHash,
} from './hash.js';

/**
 * An optimized Sparse Merkle Tree proof, per
 * {@link https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html | did:btcr2 spec — Optimized SMT}.
 *
 * The proof contains:
 * - a **collapsed bitmap** read LSB-first, where a `1` bit marks a level that
 *   was collapsed away (no merge, candidate hash unchanged) and a `0` bit marks
 *   a level where the candidate must be merged with the next sibling;
 * - the **sibling hashes** at the un-collapsed levels, ordered leaf-to-root.
 */
export class SMTProof {
  readonly #collapsed: bigint;
  readonly #hashes: readonly Uint8Array[];

  constructor(collapsed: bigint, hashes: readonly Uint8Array[]) {
    this.#collapsed = collapsed;
    this.#hashes    = hashes;
  }

  /** Collapsed bitmap (read LSB-first): bit `i` set means level `i` from the leaf is collapsed. */
  get collapsed(): bigint { return this.#collapsed; }

  /** Sibling hashes at the un-collapsed levels, ordered leaf-to-root. */
  get hashes(): readonly Uint8Array[] { return this.#hashes; }

  /**
   * Verify this proof for a single leaf.
   *
   * Implements the spec verification walk verbatim:
   *
   *   for each collapsed bit from the right:
   *     if bit == 1: skip this index bit; candidate unchanged
   *     if bit == 0: consume next sibling
   *       index bit == 0: candidate = hash(candidate || sibling)
   *       index bit == 1: candidate = hash(sibling || candidate)
   *   assert candidate == rootHash
   *
   * @param index         - Leaf index in the 256-bit key space (`int(hash(did))`).
   * @param candidateHash - Initial leaf hash (`hash(hash(nonce) + updateId)`).
   * @param rootHash      - Expected root hash.
   * @returns `true` if the proof is valid.
   */
  isValid(index: bigint, candidateHash: Uint8Array, rootHash: Uint8Array): boolean {
    let candidate = candidateHash;
    let indexBits = index;
    let bitmap    = this.#collapsed;
    let hi        = 0;
    let step      = 0;

    while (bitmap !== 0n || hi < this.#hashes.length) {
      if (step >= HASH_BIT_LENGTH) return false; // overflowed the key space

      const collapsedBit = bitmap & 1n;
      bitmap >>= 1n;

      if (collapsedBit === 1n) {
        // Skip: this index bit doesn't apply; candidate unchanged.
        indexBits >>= 1n;
      } else {
        if (hi >= this.#hashes.length) return false;
        const sibling  = this.#hashes[hi++]!;
        const indexBit = indexBits & 1n;
        indexBits >>= 1n;
        candidate = indexBit === 0n
          ? blockHash(candidate, sibling)
          : blockHash(sibling, candidate);
      }
      step++;
    }

    return hashesEqual(candidate, rootHash);
  }

  /**
   * Export to JSON.
   * @param base64  - Use base64 encoding instead of hex (default: `false`).
   * @param compact - Omit whitespace (default: `true`).
   */
  toJSON(base64 = false, compact = true): string {
    const collapsedStr = base64
      ? bigIntToBase64(this.#collapsed, false)
      : bigIntToHex(this.#collapsed, false);
    const hashStrs = this.#hashes.map(h => base64 ? hashToBase64(h) : hashToHex(h));
    const obj = { collapsed: collapsedStr, hashes: hashStrs };
    return JSON.stringify(obj, null, compact ? 0 : 2);
  }

  /**
   * Import from JSON.
   * @param json   - JSON string.
   * @param base64 - Parse base64 instead of hex (default: `false`).
   */
  static fromJSON(json: string, base64 = false): SMTProof {
    const raw = JSON.parse(json) as { collapsed?: string; hashes?: string[] };
    if (typeof raw?.collapsed !== 'string' || !Array.isArray(raw.hashes)) {
      throw new RangeError('Invalid SMTProof JSON: expected { collapsed, hashes }');
    }
    const collapsed = base64
      ? base64ToBigInt(raw.collapsed, false)
      : hexToBigInt(raw.collapsed, false);
    const hashes = raw.hashes.map(h => base64 ? base64ToHash(h) : hexToHash(h));
    return new SMTProof(collapsed, hashes);
  }

  /**
   * Export to compact binary format.
   *
   * Layout: `[collapsedZeroCount : 1] [truncatedCollapsed : 32-zc] [hashCount : 1] [hashes : N*32]`
   */
  toBinary(): Uint8Array {
    const collapsedBin = bigIntToHash(this.#collapsed);
    let zc = 0;
    while (zc < HASH_BYTE_LENGTH && collapsedBin[zc] === 0x00) zc++;

    const truncated  = collapsedBin.slice(zc);
    const hashCount  = this.#hashes.length;
    const totalBytes = 1 + truncated.length + 1 + hashCount * HASH_BYTE_LENGTH;
    const out = new Uint8Array(totalBytes);

    let pos = 0;
    out[pos++] = zc;
    out.set(truncated, pos); pos += truncated.length;
    out[pos++] = hashCount;
    for (const h of this.#hashes) {
      out.set(h, pos);
      pos += HASH_BYTE_LENGTH;
    }
    return out;
  }

  /**
   * Import from compact binary format.
   * Accepts any sync or async byte iterable (e.g. `Uint8Array`, `ReadableStream`).
   */
  static async fromBinary(source: Iterable<number> | AsyncIterable<number>): Promise<SMTProof> {
    const iter: Iterator<number> | AsyncIterator<number> =
      Symbol.iterator in source
        ? (source as Iterable<number>)[Symbol.iterator]()
        : (source as AsyncIterable<number>)[Symbol.asyncIterator]();

    async function readBytes(n: number): Promise<Uint8Array> {
      const buf = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const r = await iter.next();
        if (r.done) throw new Error('Unexpected end of binary source');
        buf[i] = r.value;
      }
      return buf;
    }

    const zc = (await readBytes(1))[0]!;
    const collapsedBin = new Uint8Array(HASH_BYTE_LENGTH);
    collapsedBin.set(await readBytes(HASH_BYTE_LENGTH - zc), zc);

    let collapsed = 0n;
    for (const b of collapsedBin) collapsed = (collapsed << 8n) | BigInt(b);

    const hashCount = (await readBytes(1))[0]!;
    const hashes: Uint8Array[] = new Array(hashCount);
    for (let i = 0; i < hashCount; i++) {
      hashes[i] = await readBytes(HASH_BYTE_LENGTH);
    }

    return new SMTProof(collapsed, hashes);
  }
}
