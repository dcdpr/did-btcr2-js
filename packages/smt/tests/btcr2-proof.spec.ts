import { randomBytes } from '@noble/curves/utils.js';
import { base64urlnopad } from '@scure/base';
import { expect } from 'chai';
import {
  base64UrlToHash,
  bigIntToHash,
  blockHash,
  BTCR2MerkleTree,
  CACHED_ZERO,
  deserializeProof,
  generateZeroHashProof,
  HASH_BYTE_LENGTH,
  hashToBase64Url, hashToBigInt,
  serializeProof,
  verifyProof,
  verifySerializedProof,
  zeroHashRoot,
  type SerializedSMTProof,
  type ZeroHashEntry,
} from '../src/index.js';

/** base64url (no padding) length of a 32-byte hash, and its charset. */
const HASH_B64URL_LENGTH = 43;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function randomHash(): Uint8Array {
  return randomBytes(HASH_BYTE_LENGTH);
}

function randomBigInt(): bigint {
  return hashToBigInt(randomHash());
}

/** Build a zero-hash tree with `size` random leaves and return its parts. */
function buildTree(size = 5): { entries: ZeroHashEntry[]; root: Uint8Array } {
  const seen = new Set<bigint>();
  const entries: ZeroHashEntry[] = [];
  while (entries.length < size) {
    const index = randomBigInt();
    if (seen.has(index)) continue;
    seen.add(index);
    entries.push({ index, leaf: randomHash() });
  }
  return { entries, root: zeroHashRoot(entries) };
}

/**
 * The subtree of one leaf whose index bits 1 to 255 are all clear: the leaf
 * hangs left at every level under the root, so each level hashes the running
 * value with the zero subtree of that height on the right.
 */
function foldLeft(leaf: Uint8Array): Uint8Array {
  let acc = leaf;
  for (let h = 0; h <= 254; h++) acc = blockHash(acc, CACHED_ZERO[h]!);
  return acc;
}

/** The levels `n` whose `collapsed` bit `255 - n` is set: the levels with an empty sibling. */
function collapsedLevels(proof: SerializedSMTProof): number[] {
  const collapsed = hashToBigInt(base64UrlToHash(proof.collapsed));
  const levels: number[] = [];
  for (let n = 0; n < 256; n++) if ((collapsed >> BigInt(n)) & 1n) levels.push(n);
  return levels;
}

/**
 * The proof with the empty sibling of level `n` in `hashes`: bit `255 - n` of
 * `collapsed` clear, and `cachedZero[n]` at its leaf-to-root position.
 */
function uncollapse(proof: SerializedSMTProof, n: number): SerializedSMTProof {
  const levels = collapsedLevels(proof);
  if (!levels.includes(n)) throw new Error(`level ${n} has no empty sibling`);
  // The entries of `hashes` below level n: one for each level without an empty sibling.
  const position = n - levels.filter(level => level < n).length;
  const hashes = [...proof.hashes];
  hashes.splice(position, 0, hashToBase64Url(CACHED_ZERO[n]!));
  const collapsed = hashToBigInt(base64UrlToHash(proof.collapsed)) & ~(1n << BigInt(n));
  return { ...proof, collapsed: hashToBase64Url(bigIntToHash(collapsed)), hashes };
}

describe('btcr2-proof (zero-hash)', () => {

  describe('serializeProof / deserializeProof', () => {
    it('round-trips collapsed, hashes, root, nonce, updateId', () => {
      const { entries, root } = buildTree();
      const proof = generateZeroHashProof(entries, entries[0]!.index);
      const nonce = randomHash();
      const updateId = randomHash();

      const serialized = serializeProof(root, proof, { nonce, updateId });
      const result = deserializeProof(serialized);

      expect(result.collapsed).to.equal(proof.collapsed);
      expect(result.hashes).to.have.lengthOf(proof.hashes.length);
      expect(result.rootHash).to.deep.equal(root);
      expect(result.nonce).to.deep.equal(nonce);
      expect(result.updateId).to.deep.equal(updateId);
    });

    it('handles missing nonce and updateId', () => {
      const { entries, root } = buildTree();
      const proof = generateZeroHashProof(entries, entries[0]!.index);
      const result = deserializeProof(serializeProof(root, proof));

      expect(result.nonce).to.be.undefined;
      expect(result.updateId).to.be.undefined;
    });

    it('round-trips a 16-byte nonce', () => {
      const { entries, root } = buildTree();
      const proof = generateZeroHashProof(entries, entries[0]!.index);
      const nonce = randomBytes(16);

      const serialized = serializeProof(root, proof, { nonce });
      expect(serialized.nonce).to.have.lengthOf(22);
      expect(deserializeProof(serialized).nonce).to.deep.equal(nonce);
    });

    it('throws RangeError for an updateId that is not 32 bytes', () => {
      const { entries, root } = buildTree();
      const proof = generateZeroHashProof(entries, entries[0]!.index);
      expect(() => serializeProof(root, proof, { updateId: randomBytes(31) })).to.throw(RangeError);
    });
  });

  describe('serialized format', () => {
    it('id field is 43-char base64url', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      expect(serialized.id).to.have.lengthOf(HASH_B64URL_LENGTH);
      expect(serialized.id).to.match(B64URL_RE);
    });

    it('collapsed field is a full 256-bit bitmap (43-char base64url)', () => {
      const { entries, root } = buildTree(2);
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      // collapsed is the empty-sibling bitmap, encoded as a full 32-byte value.
      expect(serialized.collapsed).to.have.lengthOf(HASH_B64URL_LENGTH);
      expect(serialized.collapsed).to.match(B64URL_RE);
    });

    it('hashes are 43-char base64url', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      for (const h of serialized.hashes) {
        expect(h).to.have.lengthOf(HASH_B64URL_LENGTH);
        expect(h).to.match(B64URL_RE);
      }
    });

    it('nonce and updateId are 43-char base64url when present', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index), {
        nonce    : randomHash(),
        updateId : randomHash(),
      });
      expect(serialized.nonce).to.have.lengthOf(HASH_B64URL_LENGTH);
      expect(serialized.updateId).to.have.lengthOf(HASH_B64URL_LENGTH);
    });

    it('properties come in the order of the SMT Proof data structure', () => {
      const { entries, root } = buildTree();
      const proof = generateZeroHashProof(entries, entries[0]!.index);
      const full = serializeProof(root, proof, { nonce: randomHash(), updateId: randomHash() });
      expect(Object.keys(full)).to.deep.equal(['id', 'nonce', 'updateId', 'collapsed', 'hashes']);
      expect(Object.keys(serializeProof(root, proof))).to.deep.equal(['id', 'collapsed', 'hashes']);
    });
  });

  describe('the bit sequence of the specification', () => {
    // bitAt(0) is the most significant bit of the first byte and selects the
    // child of the root. bitAt(255) is the least significant bit of the last
    // byte and selects the leaf.
    const MSB = 1n << 255n;

    it('a single leaf with the most significant index bit set hangs under the right child of the root', () => {
      const leaf = randomHash();
      const root = zeroHashRoot([{ index: MSB, leaf }]);
      expect(root).to.deep.equal(blockHash(CACHED_ZERO[255]!, foldLeft(leaf)));
    });

    it('a single leaf at index 0 hangs under the left child of the root', () => {
      const leaf = randomHash();
      const root = zeroHashRoot([{ index: 0n, leaf }]);
      expect(root).to.deep.equal(blockHash(foldLeft(leaf), CACHED_ZERO[255]!));
    });

    it('two leaves at 0 and 1 << 255 diverge at the root level only', () => {
      const leaves: ZeroHashEntry[] = [{ index: 0n, leaf: randomHash() }, { index: MSB, leaf: randomHash() }];
      const root = zeroHashRoot(leaves);

      for (const [target, other] of [[leaves[0]!, leaves[1]!], [leaves[1]!, leaves[0]!]] as const) {
        const serialized = serializeProof(root, generateZeroHashProof(leaves, target.index));
        // Bit 0 (the root level) clear, bits 1 to 255 set: byte 0 is 0x7f.
        expect(serialized.collapsed).to.equal('f' + '_'.repeat(41) + '8');
        expect(serialized.hashes).to.have.lengthOf(1);
        // The one real sibling is the zero-folded subtree of the other leaf, not the bare leaf.
        expect(serialized.hashes[0]).to.equal(hashToBase64Url(foldLeft(other.leaf)));
        expect(verifySerializedProof(serialized, target.index, target.leaf)).to.be.true;
      }
    });
  });

  describe('verifySerializedProof (authoritative zero-hash walk)', () => {
    it('returns true for a valid proof', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      expect(verifySerializedProof(serialized, entries[0]!.index, entries[0]!.leaf)).to.be.true;
    });

    it('returns false for a tampered candidate leaf', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      expect(verifySerializedProof(serialized, entries[0]!.index, randomHash())).to.be.false;
    });

    it('returns false for the wrong index', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      expect(verifySerializedProof(serialized, randomBigInt(), entries[0]!.leaf)).to.be.false;
    });

    it('returns false for a tampered root hash', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      serialized.id = hashToBase64Url(randomHash());
      expect(verifySerializedProof(serialized, entries[0]!.index, entries[0]!.leaf)).to.be.false;
    });

    it('returns false, not a throw, for an id that is not 32 bytes', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      serialized.id = base64urlnopad.encode(randomBytes(31));
      expect(serialized.id).to.have.lengthOf(42);
      expect(verifySerializedProof(serialized, entries[0]!.index, entries[0]!.leaf)).to.be.false;
    });

    it('returns false for an empty sibling in hashes at each level', () => {
      const { entries, root } = buildTree();
      const serialized = serializeProof(root, generateZeroHashProof(entries, entries[0]!.index));
      const levels = collapsedLevels(serialized);
      expect(levels).to.not.be.empty;
      for (const n of levels) {
        expect(verifySerializedProof(uncollapse(serialized, n), entries[0]!.index, entries[0]!.leaf), `level ${n}`).to.be.false;
      }
    });
  });

  describe('verifyProof (SMT Proof Verification for a DID)', () => {
    const DID = 'did:btcr2:k1qverify';
    const OTHER = 'did:btcr2:k1qother';

    function memberProof(): SerializedSMTProof {
      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: DID, nonce: randomHash(), updateId: randomHash() }, { did: OTHER, nonce: randomHash() }]);
      tree.finalize();
      return tree.proof(DID);
    }

    it('returns true for the proof of a member', () => {
      expect(verifyProof(memberProof(), DID)).to.be.true;
    });

    it('returns false for another DID', () => {
      expect(verifyProof(memberProof(), OTHER)).to.be.false;
    });

    it('returns false for a tampered nonce', () => {
      const proof = memberProof();
      proof.nonce = base64urlnopad.encode(randomBytes(16));
      expect(verifyProof(proof, DID)).to.be.false;
    });

    it('returns false for a removed updateId', () => {
      const proof = memberProof();
      delete proof.updateId;
      expect(verifyProof(proof, DID)).to.be.false;
    });

    it('returns false for an empty leaf-level sibling in hashes', () => {
      const proof = memberProof();
      expect(verifyProof(proof, DID)).to.be.true;
      // The same tree and root: only the encoding of the empty sibling changes.
      expect(verifyProof(uncollapse(proof, 0), DID)).to.be.false;
    });

    describe('returns false, never throws', () => {
      it('for an updateId that is not 32 bytes', () => {
        const proof = memberProof();
        proof.updateId = base64urlnopad.encode(randomBytes(31));
        expect(proof.updateId).to.have.lengthOf(42);
        expect(verifyProof(proof, DID)).to.be.false;
      });

      it('for a collapsed that is not 32 bytes', () => {
        const proof = memberProof();
        proof.collapsed = base64urlnopad.encode(randomBytes(31));
        expect(verifyProof(proof, DID)).to.be.false;
      });

      it('for a hashes entry that is not 32 bytes', () => {
        const proof = memberProof();
        proof.hashes = [base64urlnopad.encode(randomBytes(31)), ...proof.hashes.slice(1)];
        expect(verifyProof(proof, DID)).to.be.false;
      });

      it('for a hashes array with one entry too many', () => {
        const proof = memberProof();
        proof.hashes = [...proof.hashes, hashToBase64Url(randomHash())];
        expect(verifyProof(proof, DID)).to.be.false;
      });

      it('for a hashes array with one entry too few', () => {
        const proof = memberProof();
        proof.hashes = [];
        expect(verifyProof(proof, DID)).to.be.false;
      });

      it('for a collapsed that is not base64url', () => {
        const proof = memberProof();
        proof.collapsed = '!'.repeat(43);
        expect(verifyProof(proof, DID)).to.be.false;
      });

      it('for a hashes value that is not an array', () => {
        const proof = memberProof();
        (proof as unknown as { hashes: string }).hashes = 'not-an-array';
        expect(verifyProof(proof, DID)).to.be.false;
      });
    });
  });
});
