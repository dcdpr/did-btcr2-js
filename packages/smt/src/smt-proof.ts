import { BITS, HASH_BIT_LENGTH, HASH_BYTE_LENGTH, OUTER_BIT } from './constants.js';
import {
  bigIntToBase64, bigIntToHash, bigIntToHex,
  base64ToBigInt, base64ToHash,
  blockHash, hashesEqual, hashToBigInt,
  hashToBase64, hashToHex,
  hexToBigInt, hexToHash,
} from './hash.js';

/** A candidate for batch proof validation. */
export interface SMTProofCandidate<TAdditional = unknown> {
  readonly index : bigint;
  readonly hash  : Uint8Array;
  readonly proof : SMTProof;
  readonly additional? : TAdditional;
}

/** Result emitted by {@link SMTProof.isValidBatch}. */
export interface SMTProofResult<TAdditional = unknown> {
  readonly index      : bigint;
  readonly valid      : boolean;
  readonly additional : TAdditional | undefined;
}

/** Internal validation state for early-exit in batch mode. */
const enum ValidationState { Pending, Valid, Invalid }

/** Cached partial proof used by batch validation. */
interface PartialProof {
  readonly hash     : Uint8Array;
  readonly converge : bigint;
  readonly hashes   : readonly Uint8Array[];
}

/**
 * An optimized Sparse Merkle Tree proof.
 *
 * Contains a **converge bitmap** indicating which levels of the 256-bit path
 * have a non-empty sibling, and the **sibling hashes** at those levels.
 * Levels without a sibling use depth-byte padding instead.
 */
export class SMTProof {
  readonly #converge: bigint;
  readonly #hashes: readonly Uint8Array[];

  constructor(converge: bigint, hashes: readonly Uint8Array[]) {
    this.#converge = converge;
    this.#hashes   = hashes;
  }

  /** Converge bitmap: bit `i` set means a sibling hash exists at depth `256 - i - 1`. */
  get converge(): bigint { return this.#converge; }

  /** Sibling hashes at converge points, ordered leaf-to-root. */
  get hashes(): readonly Uint8Array[] { return this.#hashes; }

  /**
   * Verify this proof for a single leaf.
   *
   * @param index         - Leaf index in the 256-bit key space.
   * @param candidateHash - Expected leaf hash.
   * @param rootHash      - Expected root hash.
   * @returns `true` if the proof is valid.
   */
  isValid(index: bigint, candidateHash: Uint8Array, rootHash: Uint8Array): boolean {
    return this.#validate(index, candidateHash, rootHash);
  }

  /**
   * Batch-validate multiple proofs against the same root hash.
   *
   * Caches intermediate (partial) proofs so that subsequent candidates
   * sharing an ancestor path can short-circuit once a cached match is found.
   *
   * @yields One {@link SMTProofResult} per candidate.
   */
  static* isValidBatch<TAdditional = unknown>(
    candidates: Iterable<SMTProofCandidate<TAdditional>>,
    rootHash: Uint8Array
  ): Generator<SMTProofResult<TAdditional>> {
    const cache = new Map<bigint, PartialProof>();

    for (const candidate of candidates) {
      const added: bigint[] = [];
      const { index } = candidate;

      const valid = candidate.proof.#validate(
        index | OUTER_BIT,
        candidate.hash,
        rootHash,
        (nodeIndex, partial) => {
          const cached = cache.get(nodeIndex);
          if (cached === undefined) {
            cache.set(nodeIndex, partial);
            added.push(nodeIndex);
            return ValidationState.Pending;
          }
          // Compare with known-valid partial proof for early exit.
          if (
            hashesEqual(partial.hash, cached.hash) &&
            partial.converge === cached.converge &&
            partial.hashes.length === cached.hashes.length &&
            partial.hashes.every((h, i) => hashesEqual(h, cached.hashes[i]))
          ) {
            return ValidationState.Valid;
          }
          return ValidationState.Invalid;
        }
      );

      if (!valid) {
        for (const key of added) cache.delete(key);
      }

      yield { index, valid, additional: candidate.additional };
    }
  }

  /**
   * Export to JSON.
   * @param base64  - Use base64 encoding instead of hex (default: `false`).
   * @param compact - Omit whitespace (default: `true`).
   */
  toJSON(base64 = false, compact = true): string {
    const convergeStr = base64
      ? bigIntToBase64(this.#converge, false)
      : bigIntToHex(this.#converge, false);
    const hashStrs = this.#hashes.map(h => base64 ? hashToBase64(h) : hashToHex(h));
    const obj = { converge: convergeStr, hashes: hashStrs };
    return JSON.stringify(obj, null, compact ? 0 : 2);
  }

  /**
   * Import from JSON.
   * @param json   - JSON string.
   * @param base64 - Parse base64 instead of hex (default: `false`).
   */
  static fromJSON(json: string, base64 = false): SMTProof {
    const raw = JSON.parse(json) as { converge?: string; hashes?: string[] };
    if (typeof raw?.converge !== 'string' || !Array.isArray(raw.hashes)) {
      throw new RangeError('Invalid SMTProof JSON: expected { converge, hashes }');
    }
    const converge = base64
      ? base64ToBigInt(raw.converge, false)
      : hexToBigInt(raw.converge, false);
    const hashes = raw.hashes.map(h => base64 ? base64ToHash(h) : hexToHash(h));
    return new SMTProof(converge, hashes);
  }

  /**
   * Export to compact binary format.
   *
   * Layout: `[convergeZeroCount : 1] [truncatedConverge : 32-zc] [hashCount : 1] [hashes : N*32]`
   */
  toBinary(): Uint8Array {
    const convergeBin = bigIntToHash(this.#converge);
    let zc = 0;
    while (zc < HASH_BYTE_LENGTH && convergeBin[zc] === 0x00) zc++;

    const truncated  = convergeBin.slice(zc);
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

    const zc = (await readBytes(1))[0];
    const convergeBin = new Uint8Array(HASH_BYTE_LENGTH);
    convergeBin.set(await readBytes(HASH_BYTE_LENGTH - zc), zc);

    const hashCount = (await readBytes(1))[0];
    const hashes: Uint8Array[] = new Array(hashCount);
    for (let i = 0; i < hashCount; i++) {
      hashes[i] = await readBytes(HASH_BYTE_LENGTH);
    }

    return new SMTProof(hashToBigInt(convergeBin), hashes);
  }

  #validate(
    index: bigint,
    candidateHash: Uint8Array,
    rootHash: Uint8Array,
    onMerge?: (nodeIndex: bigint, partial: PartialProof) => ValidationState
  ): boolean {
    let nodeIndex = index;
    let nodeHash  = candidateHash;
    let remaining = this.#converge;
    const hashes  = this.#hashes;
    let hi = 0;

    const leftPad: number[]  = [];
    const rightPad: number[] = [];

    const finalizePadding = (): void => {
      if (leftPad.length > 0 || rightPad.length > 0) {
        nodeHash = blockHash(new Uint8Array(leftPad), nodeHash, new Uint8Array(rightPad));
        leftPad.length  = 0;
        rightPad.length = 0;
      }
    };

    let state = ValidationState.Pending;

    for (let i = 0; state === ValidationState.Pending && i < HASH_BIT_LENGTH; i++) {
      const isLeft = (nodeIndex & 1n) === 0n;
      nodeIndex >>= 1n;

      const bit = BITS[i];

      if ((remaining & bit) !== 0n) {
        remaining ^= bit;
        finalizePadding();

        if (hi >= hashes.length) {
          state = ValidationState.Invalid;
        } else {
          const peer = hashes[hi++];
          nodeHash = isLeft ? blockHash(nodeHash, peer) : blockHash(peer, nodeHash);

          if (onMerge !== undefined) {
            state = onMerge(nodeIndex, {
              hash     : nodeHash,
              converge : remaining,
              hashes   : hashes.slice(hi),
            });
          }
        }
      } else {
        const depth = HASH_BIT_LENGTH - i - 1;
        if (isLeft) {
          rightPad.push(depth);
        } else {
          leftPad.unshift(depth);
        }
      }
    }

    finalizePadding();

    if (state === ValidationState.Pending) {
      state = hi === hashes.length && hashesEqual(nodeHash, rootHash)
        ? ValidationState.Valid
        : ValidationState.Invalid;
    }

    return state === ValidationState.Valid;
  }
}
