import { decode as decodeHash } from '@did-btcr2/common';
import type { SMTProof } from '@did-btcr2/method';
import { BTCR2MerkleTree, hashToBase64Url, verifyProof } from '@did-btcr2/smt';
import { assertString } from './helpers.js';

/**
 * One entry of the Sparse Merkle Tree of an SMT beacon signal: a DID and the
 * leaf data of its index. The fields use the encoding of the SMT Proof data
 * structure of the specification.
 * @public
 */
export interface SmtEntry {
  /** The DID. The index of its leaf is the SHA-256 hash of the DID. */
  did: string;
  /** The nonce of the index in this signal, of any length. base64url, no padding. */
  nonce?: string;
  /**
   * The JSON Document Hash of the signed update that the signal announces for
   * the DID. base64url, no padding. See {@link DidMethodApi.hashDocument}.
   */
  updateId?: string;
}

/**
 * The Sparse Merkle Tree of one SMT beacon signal, from {@link SmtApi.build}.
 * @public
 */
export interface SmtTree {
  /** The root hash: the signal bytes of the beacon signal. base64url, no padding. */
  readonly root: string;
  /**
   * The SMT proof of a DID. A DID with no entry, or with an entry that has no
   * `nonce` and no `updateId`, gets the proof of an empty index.
   * @param did The DID.
   * @returns The SMT proof, which carries the `nonce` and `updateId` of the entry.
   */
  proof(did: string): SMTProof;
}

/**
 * Sparse Merkle Tree operations of the SMT beacon, with zero I/O: build the
 * tree of a signal, make the proof of a DID, and verify a proof. The tree and
 * the proofs follow the "SMT Proof Verification" algorithm of the
 * specification.
 *
 * An aggregate beacon with many parties uses `@did-btcr2/aggregation`. This
 * sub-facade is for one party that builds its own tree, and for a tool that
 * makes test vectors.
 * @public
 */
export class SmtApi {
  /**
   * Build the tree of one SMT beacon signal.
   * @param entries One entry for each DID in the signal.
   * @returns The tree: its root and the proof of each DID.
   * @throws {RangeError} If two entries have the same DID, or an `updateId` is not 32 bytes.
   */
  build(entries: SmtEntry[]): SmtTree {
    if(!Array.isArray(entries)) {
      throw new Error('entries must be an array.');
    }
    const tree = new BTCR2MerkleTree();
    tree.addEntries(entries.map((entry) => {
      assertString(entry?.did, 'entry.did');
      return {
        did : entry.did,
        ...(entry.nonce === undefined ? {} : { nonce: decodeHash(entry.nonce) }),
        ...(entry.updateId === undefined ? {} : { updateId: decodeHash(entry.updateId) }),
      };
    }));
    tree.finalize();
    return {
      root  : hashToBase64Url(tree.rootHash),
      proof : (did: string): SMTProof => {
        assertString(did, 'did');
        return tree.proof(did);
      },
    };
  }

  /**
   * Verify the SMT proof of a DID: the leaf of the DID, with the `nonce` and
   * `updateId` of the proof, hashes up to the root `id` of the proof.
   * @param proof The SMT proof.
   * @param did The DID.
   * @returns `true` if the proof is valid for the DID. Never throws.
   */
  verify(proof: SMTProof, did: string): boolean {
    if(typeof did !== 'string') return false;
    return verifyProof(proof, did);
  }
}
