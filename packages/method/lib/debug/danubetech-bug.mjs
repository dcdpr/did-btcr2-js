import { createHash } from 'node:crypto';

const sha256 = (...parts) => {
    const h = createHash('sha256');
    for (const p of parts) h.update(p);
    return h.digest();
};

// base64url -> Buffer (no padding) 
const b64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hex = (b) => b.toString('hex');

// Vector 12a from danubetech-vectors.json
const v12a = {
    nonce: b64u('4MLUvdyMMKjzOqU5F0zyMNIbR1279eduVIsDsod_TQo'),    // 'e0c2d4bddc8c30a8f33aa539174cf230d21b475dbbf5e76e548b03b2877f4d0a'
    updateId: b64u('QbPkfJIHH21IeMRyGiNg5NfKYt0TmCljg91evyo-MpU'), // '41b3e47c92071f6d4878c4721a2360e4d7ca62dd1398296383dd5ebf2a3e3295'
    sibling: b64u('SAGvc3PNM_JeqGZ8QG2aJdExqHdvUnYL8UkIPm18a9I'),  // '4801af7373cd33f25ea8667c406d9a25d131a8776f52760bf149083e6d7c6bd2'
    root: b64u('Zeuswi8sMNygdfuKjh9YGaUQOK4zPcirIJRwzIA7ZGU'),     // '65ebacc22f2c30dca075fb8a8e1f5819a51038ae333dc8ab209470cc803b6465'
};

// SPEC says: leaf = H( H(nonce) || updateId )
const specLeaf = sha256(sha256(v12a.nonce), v12a.updateId);

// Danubetech does: leaf = updateId(nonce silently dropped) 
const dtLeaf = v12a.updateId;

console.log('spec leaf       :', hex(specLeaf));
console.log('danubetech leaf :', hex(dtLeaf));
console.log();

// Try both merge directions with the sibling; one of them must hit the root
// (we don't know if leaf is left or right without decoding the DID's index)
const tryRoots = (leaf, label) => {
    const leftRoot = sha256(leaf, v12a.sibling);
    const rightRoot = sha256(v12a.sibling, leaf);
    console.log(`${label} -> H(leaf || sibling) = ${hex(leftRoot).slice(0, 16)}...`);
    console.log(`${label} -> H(sibling || leaf) = ${hex(rightRoot).slice(0, 16)}...`);
    console.log(`${label} matches claimed root: ${leftRoot.equals(v12a.root) || rightRoot.equals(v12a.root)
        }`);
    console.log();
};

console.log('Claimed root    :', hex(v12a.root), '\n');
tryRoots(specLeaf, 'spec-leaf');
tryRoots(dtLeaf, 'danubetech-leaf');
