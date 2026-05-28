// Reproduce the spec's 4-bit worked example and verify our @did-btcr2/smt
// SMTProof.isValid agrees with the spec's narrated walk.
//
// Spec (https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html):
//   index = 1101 (binary, decimal 13)
//   collapsed = 0001 (binary, decimal 1)
//   hashes = [H_1110, H_1001, H_0]
//   leaf = hash(hash(nonce) + updateId)
//
//   step 0: collapsed bit 0 = 1 -> skip; candidate unchanged
//   step 1: collapsed bit 1 = 0; index bit 1 = 0 -> hash(candidate || H_1110)
//   step 2: collapsed bit 2 = 0; index bit 2 = 1 -> hash(H_1001 || candidate)
//   step 3: collapsed bit 3 = 0; index bit 3 = 1 -> hash(H_0 || candidate)
//
// Run with:
//   pnpm tsx packages/method/lib/debug/verify-spec-example.ts
import { blockHash, hashToHex, SMTProof } from '@did-btcr2/smt';

// Synthetic 32-byte siblings (deterministic, so the script is reproducible)
const H_1110 = new Uint8Array(32).fill(0x10);
const H_1001 = new Uint8Array(32).fill(0x20);
const H_0    = new Uint8Array(32).fill(0x30);

// Synthetic leaf = blockHash(blockHash(nonce) || updateId). Values are
// arbitrary; we just need to compute the same thing the spec walk would.
const nonce    = new Uint8Array(32).fill(0xa1);
const updateId = new Uint8Array(32).fill(0xb2);
const leaf     = blockHash(blockHash(nonce), updateId);

// Spec example values
const index     = 0b1101n;
const collapsed = 0b0001n;
const hashes    = [H_1110, H_1001, H_0];

// Step-by-step trace, following the spec verbatim
console.log('Spec example walk:');
let c = leaf;
console.log(`  start    : leaf = ${hashToHex(c).slice(0, 16)}...`);

// step 0: skip
console.log('  step 0   : collapsed bit 0 = 1 -> skip');

// step 1: consume H_1110, index bit 1 = 0 -> left
c = blockHash(c, hashes[0]!);
console.log(`  step 1   : collapsed bit 1 = 0, index bit 1 = 0 -> hash(c || H_1110)`);
console.log(`             c -> ${hashToHex(c).slice(0, 16)}...`);

// step 2: consume H_1001, index bit 2 = 1 -> right
c = blockHash(hashes[1]!, c);
console.log(`  step 2   : collapsed bit 2 = 0, index bit 2 = 1 -> hash(H_1001 || c)`);
console.log(`             c -> ${hashToHex(c).slice(0, 16)}...`);

// step 3: consume H_0, index bit 3 = 1 -> right
c = blockHash(hashes[2]!, c);
console.log(`  step 3   : collapsed bit 3 = 0, index bit 3 = 1 -> hash(H_0 || c)`);
console.log(`             c -> ${hashToHex(c).slice(0, 16)}...`);

const expectedRoot = c;
console.log(`  expected root: ${hashToHex(expectedRoot)}`);
console.log('');

// Now feed the same proof to our SMTProof.isValid and confirm it accepts
const proof = new SMTProof(collapsed, hashes);
const ourResult = proof.isValid(index, leaf, expectedRoot);
console.log(`@did-btcr2/smt SMTProof.isValid(index, leaf, expectedRoot) = ${ourResult}`);

if (!ourResult) {
  console.error('FAIL: our SMTProof does not accept the spec\'s own example.');
  process.exit(1);
}

// Negative tests — verify the proof rejects wrong inputs
const tamperedLeaf = blockHash(blockHash(nonce), new Uint8Array(32).fill(0xff));
if (proof.isValid(index, tamperedLeaf, expectedRoot)) {
  console.error('FAIL: proof accepted a tampered leaf');
  process.exit(1);
}

// Index bit 1 was used as a consume bit (=0). Flip it -> verification must fail.
const wrongIndex = index ^ 0b10n;
if (proof.isValid(wrongIndex, leaf, expectedRoot)) {
  console.error('FAIL: proof accepted an index with a flipped consume bit');
  process.exit(1);
}

console.log('All assertions pass. Our SMTProof matches the spec walk.');
