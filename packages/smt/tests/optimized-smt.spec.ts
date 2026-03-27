import { expect } from 'chai';
import {
  OptimizedSMT, SMTProof, hashToBigInt, NULL_HASH,
  HASH_BYTE_LENGTH,
} from '../src/index.js';

function randomHash(): Uint8Array {
  const buf = new Uint8Array(HASH_BYTE_LENGTH);
  crypto.getRandomValues(buf);
  return buf;
}

function randomBigInt(): bigint {
  return hashToBigInt(randomHash());
}

const SIZES = [0, 1, 2, 3, 4, 8, 16, 100, 1000, 10000];

for (const allowNonInclusion of [false, true]) {
  describe(`OptimizedSMT (allowNonInclusion=${allowNonInclusion})`, () => {

    for (const size of SIZES) {
      describe(`size=${size}`, () => {
        let smt: OptimizedSMT;
        let indexes: bigint[];
        let hashes: Uint8Array[];

        beforeEach(() => {
          smt = new OptimizedSMT(allowNonInclusion);
          indexes = [];
          hashes  = [];

          const indexSet = new Set<bigint>();
          while (indexSet.size < size) {
            indexSet.add(randomBigInt());
          }
          indexes = [...indexSet];

          if (size > 0) {
            smt.add(indexes);
            hashes = indexes.map(() => randomHash());
            for (let i = 0; i < size; i++) {
              smt.setHash(indexes[i], hashes[i]);
            }
            smt.finalize();
          }
        });

        if (size === 0) {
          it('finalizes to NULL_HASH for empty tree', () => {
            smt.finalize();
            expect(smt.rootHash).to.deep.equal(NULL_HASH);
          });
          return;
        }

        it('produces a 32-byte root hash', () => {
          expect(smt.rootHash).to.have.lengthOf(HASH_BYTE_LENGTH);
        });

        it('generates valid proofs for every leaf', () => {
          for (let i = 0; i < size; i++) {
            const proof = smt.proof(indexes[i]);
            expect(proof.isValid(indexes[i], hashes[i], smt.rootHash)).to.be.true;
          }
        });

        it('detects tampered candidate hash', () => {
          const proof = smt.proof(indexes[0]);
          const tampered = randomHash();
          expect(proof.isValid(indexes[0], tampered, smt.rootHash)).to.be.false;
        });

        it('detects wrong root hash', () => {
          const proof = smt.proof(indexes[0]);
          expect(proof.isValid(indexes[0], hashes[0], randomHash())).to.be.false;
        });

        it('batch validation succeeds for all proofs', () => {
          const candidates = indexes.map((idx, i) => ({
            index : idx,
            hash  : hashes[i],
            proof : smt.proof(idx),
          }));
          const results = [...SMTProof.isValidBatch(candidates, smt.rootHash)];
          expect(results).to.have.lengthOf(size);
          for (const r of results) {
            expect(r.valid).to.be.true;
          }
        });

        it('batch validation detects corrupted proof', () => {
          const corruptIdx = Math.floor(Math.random() * size);
          const candidates = indexes.map((idx, i) => ({
            index : idx,
            hash  : i === corruptIdx ? randomHash() : hashes[i],
            proof : smt.proof(idx),
          }));
          const results = [...SMTProof.isValidBatch(candidates, smt.rootHash)];
          expect(results[corruptIdx].valid).to.be.false;
        });

        it('reset allows re-finalization with new hashes', () => {
          const oldRoot = new Uint8Array(smt.rootHash);
          smt.reset();
          const newHashes = indexes.map(() => randomHash());
          for (let i = 0; i < size; i++) {
            smt.setHash(indexes[i], newHashes[i]);
          }
          smt.finalize();
          // Root should differ (overwhelmingly likely)
          expect(smt.rootHash).to.not.deep.equal(oldRoot);
          // New proofs should be valid
          for (let i = 0; i < size; i++) {
            const proof = smt.proof(indexes[i]);
            expect(proof.isValid(indexes[i], newHashes[i], smt.rootHash)).to.be.true;
          }
        });
      });
    }

    it('throws on duplicate index', () => {
      const smt = new OptimizedSMT(allowNonInclusion);
      const idx = randomBigInt();
      smt.add([idx]);
      expect(() => smt.add([idx])).to.throw(RangeError, /Duplicate/i);
    });

    it('throws on out-of-range index', () => {
      const smt = new OptimizedSMT(allowNonInclusion);
      expect(() => smt.add([-1n])).to.throw(RangeError);
      expect(() => smt.add([1n << 256n])).to.throw(RangeError);
    });

    it('throws on rootHash before finalize', () => {
      const smt = new OptimizedSMT(allowNonInclusion);
      expect(() => smt.rootHash).to.throw(RangeError);
    });

    it('throws on add after finalize', () => {
      const smt = new OptimizedSMT(allowNonInclusion);
      smt.finalize();
      expect(() => smt.add([randomBigInt()])).to.throw(/finalized/i);
    });

    it('throws on setHash after finalize', () => {
      const smt = new OptimizedSMT(allowNonInclusion);
      const idx = randomBigInt();
      smt.add([idx]);
      smt.setHash(idx, randomHash());
      smt.finalize();
      expect(() => smt.setHash(idx, randomHash())).to.throw(/finalized/i);
    });

    it('throws on proof for unknown index', () => {
      const smt = new OptimizedSMT(allowNonInclusion);
      const idx = randomBigInt();
      smt.add([idx]);
      smt.setHash(idx, randomHash());
      smt.finalize();
      // Request proof for a different index that was never added.
      expect(() => smt.proof(randomBigInt())).to.throw(RangeError);
    });
  });
}

describe('OptimizedSMT non-inclusion specifics', () => {
  it('allowNonInclusion=false throws when hash not set', () => {
    const smt = new OptimizedSMT(false);
    smt.add([randomBigInt()]);
    expect(() => smt.finalize()).to.throw(RangeError, /Hash missing/i);
  });

  it('allowNonInclusion=true sets NULL_HASH for missing leaves', () => {
    const smt = new OptimizedSMT(true);
    const idx = randomBigInt();
    smt.add([idx]);
    smt.finalize();
    const proof = smt.proof(idx);
    expect(proof.isValid(idx, NULL_HASH, smt.rootHash)).to.be.true;
  });
});

describe('OptimizedSMT security: depth-byte padding', () => {
  it('prevents index substitution attack', () => {
    // Create a tree with two leaves that differ only in the last bit.
    const baseIndex = randomBigInt() & ~1n; // clear last bit
    const idxA = baseIndex;
    const idxB = baseIndex | 1n;
    const hashA = randomHash();
    const hashB = randomHash();

    const smt = new OptimizedSMT(false);
    smt.add([idxA, idxB]);
    smt.setHash(idxA, hashA);
    smt.setHash(idxB, hashB);
    smt.finalize();

    const proofA = smt.proof(idxA);

    // proofA should NOT validate with idxB's hash at idxB's position.
    expect(proofA.isValid(idxB, hashB, smt.rootHash)).to.be.false;

    // But should validate correctly for its own index.
    expect(proofA.isValid(idxA, hashA, smt.rootHash)).to.be.true;
  });
});
