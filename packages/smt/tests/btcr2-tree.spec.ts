import { expect } from 'chai';
import {
  BTCR2MerkleTree, type TreeEntry,
  didToIndex, inclusionLeafHash, nonInclusionLeafHash,
  verifySerializedProof,
  HASH_BYTE_LENGTH,
} from '../src/index.js';

function randomHash(): Uint8Array {
  const buf = new Uint8Array(HASH_BYTE_LENGTH);
  crypto.getRandomValues(buf);
  return buf;
}

function makeEntry(did: string, include = true): TreeEntry {
  return {
    did,
    nonce        : randomHash(),
    signedUpdate : include ? randomHash() : undefined,
  };
}

describe('BTCR2MerkleTree', () => {

  it('builds and verifies a single inclusion entry', () => {
    const tree = new BTCR2MerkleTree();
    const entry = makeEntry('did:btcr2:k1qsingle');
    tree.addEntries([entry]);
    tree.finalize();

    const proof = tree.proof('did:btcr2:k1qsingle');
    const index = didToIndex('did:btcr2:k1qsingle');
    const leafHash = inclusionLeafHash(entry.nonce, entry.signedUpdate!);

    expect(verifySerializedProof(proof, index, leafHash)).to.be.true;
  });

  it('builds and verifies multiple entries', () => {
    const dids = [
      'did:btcr2:k1qalpha',
      'did:btcr2:k1qbravo',
      'did:btcr2:k1qcharlie',
      'did:btcr2:k1qdelta',
      'did:btcr2:k1qecho',
    ];
    const entries = dids.map(d => makeEntry(d));
    const tree = new BTCR2MerkleTree();
    tree.addEntries(entries);
    tree.finalize();

    for (const entry of entries) {
      const proof = tree.proof(entry.did);
      const index = didToIndex(entry.did);
      const leafHash = inclusionLeafHash(entry.nonce, entry.signedUpdate!);
      expect(verifySerializedProof(proof, index, leafHash)).to.be.true;
    }
  });

  it('builds and verifies non-inclusion entries', () => {
    const tree = new BTCR2MerkleTree(true);
    const entry = makeEntry('did:btcr2:k1qmissing', false);
    tree.addEntries([entry]);
    tree.finalize();

    const proof = tree.proof('did:btcr2:k1qmissing');
    const index = didToIndex('did:btcr2:k1qmissing');
    const leafHash = nonInclusionLeafHash(entry.nonce);

    expect(verifySerializedProof(proof, index, leafHash)).to.be.true;
  });

  it('handles mixed inclusion and non-inclusion entries', () => {
    const tree = new BTCR2MerkleTree(true);
    const included  = makeEntry('did:btcr2:k1qincl', true);
    const excluded  = makeEntry('did:btcr2:k1qexcl', false);
    tree.addEntries([included, excluded]);
    tree.finalize();

    // Inclusion proof
    const inclProof = tree.proof('did:btcr2:k1qincl');
    const inclHash  = inclusionLeafHash(included.nonce, included.signedUpdate!);
    expect(verifySerializedProof(inclProof, didToIndex('did:btcr2:k1qincl'), inclHash)).to.be.true;

    // Non-inclusion proof
    const exclProof = tree.proof('did:btcr2:k1qexcl');
    const exclHash  = nonInclusionLeafHash(excluded.nonce);
    expect(verifySerializedProof(exclProof, didToIndex('did:btcr2:k1qexcl'), exclHash)).to.be.true;
  });

  it('root hash is deterministic for same entries', () => {
    const entry = makeEntry('did:btcr2:k1qdeterm');
    // Fix nonce and update for reproducibility.
    const nonce  = new Uint8Array(HASH_BYTE_LENGTH).fill(0x42);
    const update = new Uint8Array(HASH_BYTE_LENGTH).fill(0x99);
    entry.nonce = nonce;
    entry.signedUpdate = update;

    const tree1 = new BTCR2MerkleTree();
    tree1.addEntries([{ ...entry }]);
    tree1.finalize();

    const tree2 = new BTCR2MerkleTree();
    tree2.addEntries([{ ...entry }]);
    tree2.finalize();

    expect(tree1.rootHash).to.deep.equal(tree2.rootHash);
  });

  it('reset allows rebuilding with new data', () => {
    const tree = new BTCR2MerkleTree();
    const entry1 = makeEntry('did:btcr2:k1qfirst');
    tree.addEntries([entry1]);
    tree.finalize();
    const root1 = new Uint8Array(tree.rootHash);

    tree.reset();
    // After reset, need new hashes (entries are preserved, tree structure reused).
    // Since entry nonce/update haven't changed, re-finalize produces same root.
    tree.finalize();
    expect(tree.rootHash).to.deep.equal(root1);
  });

  it('serialized proof has correct metadata fields', () => {
    const tree = new BTCR2MerkleTree();
    const entry = makeEntry('did:btcr2:k1qmeta');
    tree.addEntries([entry]);
    tree.finalize();

    const proof = tree.proof('did:btcr2:k1qmeta');

    expect(proof).to.have.property('id').that.is.a('string');
    expect(proof).to.have.property('collapsed').that.is.a('string');
    expect(proof).to.have.property('hashes').that.is.an('array');
    expect(proof).to.have.property('nonce').that.is.a('string');
    expect(proof).to.have.property('updateId').that.is.a('string');
  });

  it('throws on duplicate DID', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qdup')]);
    expect(() => tree.addEntries([makeEntry('did:btcr2:k1qdup')])).to.throw(RangeError, /Duplicate/i);
  });

  it('throws on proof for unknown DID', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qknown')]);
    tree.finalize();
    expect(() => tree.proof('did:btcr2:k1qunknown')).to.throw(RangeError);
  });

  it('throws on rootHash before finalize', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qearly')]);
    expect(() => tree.rootHash).to.throw(RangeError);
  });
});
