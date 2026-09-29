import { expect } from 'chai';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { BTCR2MerkleTree } from '@did-btcr2/smt';
import { base64urlnopad } from '@scure/base';
import { createApi } from '../src/index.js';
import type { SmtEntry } from '../src/index.js';

/** A fresh KEY DID on regtest. */
function newDid(): string {
  return createApi().btcr2.createDeterministic(SchnorrKeyPair.generate().publicKey.compressed);
}

/** 32 random bytes, base64url with no padding. */
function random32(): string {
  return base64urlnopad.encode(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * SmtApi (ADR 132)
 */
describe('SmtApi', () => {
  const api = createApi();

  it('builds the same root and proofs as the smt package', () => {
    const [a, b, c] = [newDid(), newDid(), newDid()];
    const entries: SmtEntry[] = [
      { did: a, nonce: random32(), updateId: random32() },
      { did: b, nonce: random32() },
      { did: c, updateId: random32() },
    ];

    const tree = new BTCR2MerkleTree();
    tree.addEntries(entries.map(e => ({
      did      : e.did,
      nonce    : e.nonce === undefined ? undefined : base64urlnopad.decode(e.nonce),
      updateId : e.updateId === undefined ? undefined : base64urlnopad.decode(e.updateId),
    })));
    tree.finalize();

    const built = api.smt.build(entries);
    expect(built.root).to.equal(base64urlnopad.encode(tree.rootHash));
    for (const { did } of entries) {
      expect(built.proof(did)).to.deep.equal(tree.proof(did));
    }
  });

  it('makes a proof that carries the entry fields and that verifies', () => {
    const did = newDid();
    const entry: SmtEntry = { did, nonce: random32(), updateId: random32() };
    const tree = api.smt.build([entry, { did: newDid(), nonce: random32() }]);
    const proof = tree.proof(did);

    expect(proof.id).to.equal(tree.root);
    expect(proof.nonce).to.equal(entry.nonce);
    expect(proof.updateId).to.equal(entry.updateId);
    expect(api.smt.verify(proof, did)).to.equal(true);
  });

  it('makes the proof of an empty index for a DID with no entry', () => {
    const outsider = newDid();
    const tree = api.smt.build([{ did: newDid(), nonce: random32() }]);
    const proof = tree.proof(outsider);

    expect(proof).to.not.have.property('nonce');
    expect(proof).to.not.have.property('updateId');
    expect(api.smt.verify(proof, outsider)).to.equal(true);
  });

  it('rejects a proof for another DID or with a changed updateId', () => {
    const did = newDid();
    const tree = api.smt.build([{ did, updateId: random32() }]);
    const proof = tree.proof(did);

    expect(api.smt.verify(proof, newDid())).to.equal(false);
    expect(api.smt.verify({ ...proof, updateId: random32() }, did)).to.equal(false);
    expect(api.smt.verify({} as never, did)).to.equal(false);
    expect(api.smt.verify(proof, 42 as never)).to.equal(false);
  });

  it('refuses two entries with the same DID and an updateId that is not 32 bytes', () => {
    const did = newDid();
    expect(() => api.smt.build([{ did, nonce: random32() }, { did, nonce: random32() }])).to.throw(RangeError);
    expect(() => api.smt.build([{ did, updateId: base64urlnopad.encode(new Uint8Array(31)) }])).to.throw(RangeError);
  });

  it('refuses entries that are not an array and an entry without a DID', () => {
    expect(() => api.smt.build('x' as never)).to.throw('entries must be an array');
    expect(() => api.smt.build([{} as never])).to.throw('entry.did');
  });
});
