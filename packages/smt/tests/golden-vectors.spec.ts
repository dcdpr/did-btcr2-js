import { expect } from 'chai';
import {
  BTCR2MerkleTree,
  didToIndex,
  hexToHash,
  inclusionLeafHash,
  nonInclusionLeafHash,
  verifySerializedProof,
  verifyZeroHash,
  ZeroHashTree,
  type SerializedSMTProof,
} from '../src/index.js';

/**
 * Golden vectors for the zero-hash Sparse Merkle Tree.
 *
 * Every expected value below is a FROZEN golden literal, generated once from a
 * known-good implementation and then recomputed independently from the spec
 * construction (SHA-256 only: cachedZero chain, leaf-hash construction, the
 * MSB-first verification walk) before being frozen here. Their purpose is to
 * catch tree/proof regressions even when the implementation and its
 * differential oracles drift together: a change that alters any root, bitmap,
 * or sibling hash fails this spec no matter how self-consistent it is.
 *
 * Construction recap (did:btcr2 SMT): the tree is full-depth (256 levels);
 * cachedZero[0] = SHA-256(0x00*32 || 0x00*32) and cachedZero[h] =
 * SHA-256(cachedZero[h-1] || cachedZero[h-1]); an empty subtree at height h
 * contributes cachedZero[h]; every level is hashed. Leaves are
 * SHA-256(SHA-256(nonce) || SHA-256(update)) for inclusion and
 * SHA-256(SHA-256(nonce)) for non-inclusion. Index = SHA-256(did) big-endian;
 * the root splits on the least-significant index bit.
 */

/** Fixed vector inputs (hex). */
const DID1 = 'did:btcr2:k1q5ptvjpcgt0jfgvddau2fllfcpxwa5qtw2umkafp5xqwqr72a7xanvcjf324y';
const DID2 = 'did:btcr2:k1q5pcyz9x806tq82vysz6tde0lpge4frgmuxx33dxz6zxtkx7ljwg78q7n2tc4';
const NONCE1 = hexToHash('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
const NONCE2 = hexToHash('ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100');
/** SHA-256 of the empty string, standing in for canonical signed-update bytes. */
const UPDATE1 = hexToHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

/** Deep-shared-prefix indices: all share the low 250 bits (only bit 0 set). */
const IDX_A = 1n;
const IDX_B = (1n << 250n) | 1n;
const IDX_C = (1n << 251n) | 1n;

const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('golden vectors (frozen)', () => {
  describe('single-leaf tree', () => {
    it('reproduces the frozen index, leaf, root, and serialized proof', () => {
      expect(didToIndex(DID1).toString(16).padStart(64, '0')).to.equal(
        '5e5dcf1d51ee54d1bdb6c7d1b512f923fbe2f3a492506f0b6baa35b5a8b02e34'
      );
      expect(hexOf(inclusionLeafHash(NONCE1, UPDATE1))).to.equal(
        'd1eee1c59d47515f001d3ce90d70764f1e1f9104e78bfaf35287339c69722ff5'
      );

      const tree = new BTCR2MerkleTree();
      tree.addEntries([{ did: DID1, nonce: NONCE1, signedUpdate: UPDATE1 }]);
      tree.finalize();

      expect(hexOf(tree.rootHash)).to.equal(
        '083ed55f1a960f229b8bf98d919e42db7e2135f9382b4b7b59f5d339cff73c2a'
      );

      // A lone leaf has an empty sibling at every level: collapsed is all 256
      // bits set (base64url of 32 0xff bytes) and hashes is empty.
      const proof = tree.proof(DID1);
      const expected: SerializedSMTProof = {
        id        : 'CD7VXxqWDyKbi_mNkZ5C234hNfk4K0t7WfXTOc_3PCo',
        collapsed : '__________________________________________8',
        hashes    : [],
        nonce     : 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
        updateId  : 'Xfbg4nYTWdMKgnUFjimfzAOBU0VF9Vz0PkGYP11MlFY',
      };
      expect(proof).to.deep.equal(expected);
      expect(
        verifySerializedProof(proof, didToIndex(DID1), inclusionLeafHash(NONCE1, UPDATE1))
      ).to.equal(true);
    });
  });

  describe('two-leaf tree at a deep shared prefix (fork at bit 250)', () => {
    const leaves = [
      { index: IDX_A, leaf: inclusionLeafHash(NONCE1, UPDATE1) },
      { index: IDX_B, leaf: inclusionLeafHash(NONCE2, UPDATE1) },
    ];
    const tree = ZeroHashTree.fromLeaves(leaves);
    const ROOT = '8ddeaea140844ac5912b0323822590362a20ce5a02505e6dc41919486daaee6b';
    // One non-empty sibling (the other leaf's subtree) at the fork level
    // h = 6: collapsed is all bits set except bit 250.
    const COLLAPSED = 'fbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    it('reproduces the frozen root and inclusion proofs', () => {
      expect(hexOf(tree.root)).to.equal(ROOT);

      const proofA = tree.proof(IDX_A);
      expect(proofA.collapsed.toString(16)).to.equal(COLLAPSED);
      expect(proofA.hashes.map(hexOf)).to.deep.equal(
        ['e0999a61dcabf22f9e491c57638744d42fc664f71a869f99fa6bff7ed91509db']
      );
      expect(verifyZeroHash(proofA.collapsed, proofA.hashes, IDX_A, leaves[0].leaf, tree.root)).to.equal(true);

      const proofB = tree.proof(IDX_B);
      expect(proofB.collapsed.toString(16)).to.equal(COLLAPSED);
      expect(proofB.hashes.map(hexOf)).to.deep.equal(
        ['e300de339036e41b5ef072bbe23ff0c792a2bbfa0f33dc1bcefdf04e030fd09d']
      );
      expect(verifyZeroHash(proofB.collapsed, proofB.hashes, IDX_B, leaves[1].leaf, tree.root)).to.equal(true);
    });

    it('reproduces the frozen non-inclusion proof for an absent index', () => {
      // Index 0 diverges at the lowest bit, above the whole tree: the entire
      // tree is the single sibling at the root level (collapsed bit 0 clear).
      const absent = tree.proof(0n);
      expect(absent.collapsed.toString(16)).to.equal(
        'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe'
      );
      expect(absent.hashes.map(hexOf)).to.deep.equal(
        ['d55af4e9d1422671bfe167f673f7d778f59a7056835f58e1934ab278cbfa5b30']
      );
      // The proof describes an empty path: it must NOT verify any leaf.
      expect(
        verifyZeroHash(absent.collapsed, absent.hashes, 0n, nonInclusionLeafHash(NONCE1), tree.root)
      ).to.equal(false);
    });
  });

  describe('three-leaf tree at a deep shared prefix (forks at bits 250 and 251)', () => {
    const leaves = [
      { index: IDX_A, leaf: inclusionLeafHash(NONCE1, UPDATE1) },
      { index: IDX_B, leaf: inclusionLeafHash(NONCE2, UPDATE1) },
      { index: IDX_C, leaf: nonInclusionLeafHash(NONCE1) },
    ];
    const tree = ZeroHashTree.fromLeaves(leaves);
    // Two non-empty siblings per proof (fork levels h = 5 and h = 6):
    // collapsed is all bits set except bits 250 and 251.
    const COLLAPSED = 'f3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

    it('reproduces the frozen root and inclusion proofs', () => {
      expect(hexOf(tree.root)).to.equal(
        '5955172ae3fc77a2da19c11546ff98eef4ac9a1360b4d4106de1c655a480bd44'
      );

      const proofA = tree.proof(IDX_A);
      expect(proofA.collapsed.toString(16)).to.equal(COLLAPSED);
      expect(proofA.hashes.map(hexOf)).to.deep.equal([
        'b76bcde675b5ade47453e61097d196badd1bdfea7c349b4b8a364bd4b0d369d3',
        'e0999a61dcabf22f9e491c57638744d42fc664f71a869f99fa6bff7ed91509db',
      ]);
      expect(verifyZeroHash(proofA.collapsed, proofA.hashes, IDX_A, leaves[0].leaf, tree.root)).to.equal(true);

      // C carries a non-inclusion leaf: its proof verifies against
      // SHA-256(SHA-256(nonce)) and fails against any updateId candidate.
      const proofC = tree.proof(IDX_C);
      expect(proofC.collapsed.toString(16)).to.equal(COLLAPSED);
      expect(proofC.hashes.map(hexOf)).to.deep.equal([
        '0eaba246bac7ab76735ef1fd7cba73fb8f4c7119fa9c0481ef3c689bff65ee76',
        'e0999a61dcabf22f9e491c57638744d42fc664f71a869f99fa6bff7ed91509db',
      ]);
      expect(verifyZeroHash(proofC.collapsed, proofC.hashes, IDX_C, leaves[2].leaf, tree.root)).to.equal(true);
      expect(
        verifyZeroHash(proofC.collapsed, proofC.hashes, IDX_C, inclusionLeafHash(NONCE1, UPDATE1), tree.root)
      ).to.equal(false);
    });
  });

  describe('btcr2 tree with inclusion and non-inclusion entries', () => {
    it('reproduces the frozen root and both serialized proofs', () => {
      const tree = new BTCR2MerkleTree();
      tree.addEntries([
        { did: DID1, nonce: NONCE1, signedUpdate: UPDATE1 },
        { did: DID2, nonce: NONCE2 },
      ]);
      tree.finalize();

      expect(hexOf(tree.rootHash)).to.equal(
        '0cf663fd64780cd862ab75bad00e8db242ddbe3297c336a19f3bb7cd9e8e0e56'
      );
      expect(didToIndex(DID2).toString(16).padStart(64, '0')).to.equal(
        '55982336d38135c3ea132486fcf533151e1df2f612a287cf9e3e314dae5cab5b'
      );
      expect(hexOf(nonInclusionLeafHash(NONCE2))).to.equal(
        'b75306f67bf19e03b8ac0877f9cbfda8f7044c2a26e3e5487a97744ca949671d'
      );

      const proof1 = tree.proof(DID1);
      const expected1: SerializedSMTProof = {
        id        : 'DPZj_WR4DNhiq3W60A6NskLdvjKXwzahnzu3zZ6ODlY',
        collapsed : '__________________________________________4',
        hashes    : ['c9rSqtPSdn9gNvnvADf--gQe4W6fbsssXokcotlM5TQ'],
        nonce     : 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
        updateId  : 'Xfbg4nYTWdMKgnUFjimfzAOBU0VF9Vz0PkGYP11MlFY',
      };
      expect(proof1).to.deep.equal(expected1);
      expect(
        verifySerializedProof(proof1, didToIndex(DID1), inclusionLeafHash(NONCE1, UPDATE1))
      ).to.equal(true);

      // Non-inclusion entry: no updateId on the wire proof; it verifies
      // against SHA-256(SHA-256(nonce)) and rejects any inclusion candidate.
      const proof2 = tree.proof(DID2);
      const expected2: SerializedSMTProof = {
        id        : 'DPZj_WR4DNhiq3W60A6NskLdvjKXwzahnzu3zZ6ODlY',
        collapsed : '__________________________________________4',
        hashes    : ['zF2oY6uQLLc7GOy_q8m3LLew52KJmGUlYspw4xJbf80'],
        nonce     : '_-7dzLuqmYh3ZlVEMyIRAP_u3cy7qpmId2ZVRDMiEQA',
      };
      expect(proof2).to.deep.equal(expected2);
      expect(
        verifySerializedProof(proof2, didToIndex(DID2), nonInclusionLeafHash(NONCE2))
      ).to.equal(true);
      expect(
        verifySerializedProof(proof2, didToIndex(DID2), inclusionLeafHash(NONCE2, UPDATE1))
      ).to.equal(false);
    });
  });
});
