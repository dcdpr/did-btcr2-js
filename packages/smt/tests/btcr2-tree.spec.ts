import { expect } from 'chai';
import {
  BTCR2MerkleTree, type TreeEntry,
  verifyProof,
  HASH_BYTE_LENGTH,
} from '../src/index.js';
import { randomBytes } from '@noble/curves/utils.js';

function randomHash(): Uint8Array {
  return randomBytes(HASH_BYTE_LENGTH);
}

/** An entry in nonce mode: an update (`include`) or a nonce non-update. */
function makeEntry(did: string, include = true): TreeEntry {
  return {
    did,
    nonce    : randomHash(),
    updateId : include ? randomHash() : undefined,
  };
}

describe('BTCR2MerkleTree', () => {

  it('builds and verifies a single nonce-mode update entry', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qsingle')]);
    tree.finalize();

    const proof = tree.proof('did:btcr2:k1qsingle');
    expect(proof.nonce).to.be.a('string');
    expect(proof.updateId).to.be.a('string');
    expect(verifyProof(proof, 'did:btcr2:k1qsingle')).to.be.true;
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
      expect(verifyProof(tree.proof(entry.did), entry.did)).to.be.true;
    }
  });

  it('builds and verifies a nonce non-update entry (nonce only)', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qmissing', false)]);
    tree.finalize();

    const proof = tree.proof('did:btcr2:k1qmissing');
    expect(proof.nonce).to.be.a('string');
    expect(proof.updateId).to.be.undefined;
    expect(verifyProof(proof, 'did:btcr2:k1qmissing')).to.be.true;
  });

  it('builds and verifies a no-nonce update entry (updateId only)', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([{ did: 'did:btcr2:k1qnononce', updateId: randomHash() }]);
    tree.finalize();

    const proof = tree.proof('did:btcr2:k1qnononce');
    expect(proof.nonce).to.be.undefined;
    expect(proof.updateId).to.be.a('string');
    expect(verifyProof(proof, 'did:btcr2:k1qnononce')).to.be.true;
  });

  it('handles mixed update and non-update entries', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([
      makeEntry('did:btcr2:k1qincl', true),
      makeEntry('did:btcr2:k1qexcl', false),
      { did: 'did:btcr2:k1qplain', updateId: randomHash() },
    ]);
    tree.finalize();

    expect(verifyProof(tree.proof('did:btcr2:k1qincl'), 'did:btcr2:k1qincl')).to.be.true;
    expect(verifyProof(tree.proof('did:btcr2:k1qexcl'), 'did:btcr2:k1qexcl')).to.be.true;
    expect(verifyProof(tree.proof('did:btcr2:k1qplain'), 'did:btcr2:k1qplain')).to.be.true;
  });

  it('an entry with neither field stays an empty index', () => {
    const member = makeEntry('did:btcr2:k1qmember');

    const withEmpty = new BTCR2MerkleTree();
    withEmpty.addEntries([member, { did: 'did:btcr2:k1qempty' }]);
    withEmpty.finalize();

    const without = new BTCR2MerkleTree();
    without.addEntries([member]);
    without.finalize();

    expect(withEmpty.rootHash).to.deep.equal(without.rootHash);

    const proof = withEmpty.proof('did:btcr2:k1qempty');
    expect(proof.nonce).to.be.undefined;
    expect(proof.updateId).to.be.undefined;
    expect(verifyProof(proof, 'did:btcr2:k1qempty')).to.be.true;
  });

  it('returns a verifiable empty-index proof for a DID that is not in the tree', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qknown')]);
    tree.finalize();

    const proof = tree.proof('did:btcr2:k1qunknown');
    expect(proof.id).to.equal(tree.proof('did:btcr2:k1qknown').id);
    expect(proof.nonce).to.be.undefined;
    expect(proof.updateId).to.be.undefined;
    expect(verifyProof(proof, 'did:btcr2:k1qunknown')).to.be.true;
  });

  it('a proof of a member does not verify for another DID', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qmine'), makeEntry('did:btcr2:k1qyours')]);
    tree.finalize();

    const proof = tree.proof('did:btcr2:k1qmine');
    expect(verifyProof(proof, 'did:btcr2:k1qyours')).to.be.false;
    expect(verifyProof(proof, 'did:btcr2:k1qnobody')).to.be.false;
  });

  it('root hash is deterministic for same entries', () => {
    const entry: TreeEntry = {
      did      : 'did:btcr2:k1qdeterm',
      nonce    : new Uint8Array(HASH_BYTE_LENGTH).fill(0x42),
      updateId : new Uint8Array(HASH_BYTE_LENGTH).fill(0x99),
    };

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
    tree.addEntries([makeEntry('did:btcr2:k1qfirst')]);
    tree.finalize();
    const root1 = new Uint8Array(tree.rootHash);

    tree.reset();
    // The entries are kept, so a second finalize produces the same root.
    tree.finalize();
    expect(tree.rootHash).to.deep.equal(root1);
  });

  it('serialized proof has correct metadata fields', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qmeta')]);
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

  it('throws on an updateId that is not 32 bytes', () => {
    const tree = new BTCR2MerkleTree();
    expect(() => tree.addEntries([{ did: 'did:btcr2:k1qshort', updateId: new Uint8Array(31) }])).to.throw(RangeError);
  });

  it('throws on proof before finalize', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qearly')]);
    expect(() => tree.proof('did:btcr2:k1qearly')).to.throw(Error, /not finalized/i);
  });

  it('throws on rootHash before finalize', () => {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([makeEntry('did:btcr2:k1qearly')]);
    expect(() => tree.rootHash).to.throw(Error, /not finalized/i);
  });
});
