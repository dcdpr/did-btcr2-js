import { createHash } from 'node:crypto';
const sha256 = (...parts) => {
    const h = createHash('sha256');
    for (const p of parts) h.update(p);
    return h.digest();
};
const b64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hex = (b) => b.toString('hex');

// Treat the collapsed bytes as a big-endian unsigned integer, LSB-first bit indexing.
function bytesToBigInt(b) {
    let n = 0n;
    for (const byte of b) n = (n << 8n) | BigInt(byte);
    return n;
}

// 12a values
const nonce = b64u('4MLUvdyMMKjzOqU5F0zyMNIbR1279eduVIsDsod_TQo');
const updateId = b64u('QbPkfJIHH21IeMRyGiNg5NfKYt0TmCljg91evyo-MpU');
const sibling = b64u('SAGvc3PNM_JeqGZ8QG2aJdExqHdvUnYL8UkIPm18a9I');
const root = b64u('Zeuswi8sMNygdfuKjh9YGaUQOK4zPcirIJRwzIA7ZGU');
const hashes = [sibling];

const collapsed = bytesToBigInt(b64u('f_________________________________________8'));

// Pretend the leaf is the danubetech one so the walk has a chance to match.
const leaf = updateId;

// We don't have the real index without decoding bech32m. Use a placeholder;
// the walk only consults index bits at *consume* positions, of which there's
// exactly one here (bit 254). Try both.
function specWalk(index, collapsed, hashes, leaf) {
    let c = leaf, idx = index, bm = collapsed, hi = 0, step = 0;
    while ((bm !== 0n || hi < hashes.length) && step < 256) {
        if ((bm & 1n) === 1n) {
            // SKIP
            idx >>= 1n;
        } else {
            // CONSUME
            const sib = hashes[hi++];
            c = (idx & 1n) === 0n ? sha256(c, sib) : sha256(sib, c);
            idx >>= 1n;
        }
        bm >>= 1n;
        step++;
    }
    return c;
}

console.log('Spec walk (LSB-first, bit=1 means skip):');
console.log('consume bit at level 254, both orientations:');
console.log('idx bit254=0:', hex(specWalk(0n, collapsed, hashes, leaf)));
console.log('idx bit254=1:', hex(specWalk(1n << 254n, collapsed, hashes, leaf)));
console.log('Claimed root:', hex(root));
console.log();
console.log('One of those two MUST match the root. With the old buggy MSB-first');
console.log('walk + inverted skip semantics, neither would — we would have rejected');
console.log('this proof even though the data is internally consistent.');