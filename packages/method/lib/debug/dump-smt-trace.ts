// Dumps every intermediate value our SMT verifier sees for a given vector.
// Run via tsx; pass a vector id (e.g., 12a) as the only argument.
//
//   pnpm tsx packages/method/lib/debug/dump-smt-trace.ts 12a
//
// Output goes to stdout in a flat key=value format that's easy to diff against
// another implementation's trace. The diagnostic deliberately mirrors the
// validation algorithm in packages/smt/src/smt-proof.ts so any divergence
// surfaces as an explicit step.
import {
  base64UrlToBigInt,
  base64UrlToHash,
  bigIntToHex,
  blockHash,
  didToIndex,
  hashToHex
} from '@did-btcr2/smt';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH_BIT_LENGTH = 256;

function bit(i: number): bigint {
  return 1n << BigInt(255 - i);
}

function hex(bytes: Uint8Array): string {
  return hashToHex(bytes);
}

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, 'danubetech-vectors.json'), 'utf8'));

const example = process.argv[2] ?? '12a';
const entry = vectors.find((v: { example: string }) => v.example === example);
if (!entry) {
  console.error(`Unknown example: ${example}`);
  process.exit(2);
}

const proof = entry.resolutionOptions?.sidecar?.smtProofs?.[0];
if (!proof) {
  console.error(`Vector ${example} has no smtProofs in sidecar`);
  process.exit(2);
}

const did = entry.did as string;
const nonce = base64UrlToHash(proof.nonce);
const updateId = base64UrlToHash(proof.updateId);
const collapsed = base64UrlToBigInt(proof.collapsed, false);
const claimedRoot = base64UrlToHash(proof.id);
const siblings = (proof.hashes as string[]).map((h) => base64UrlToHash(h));

console.log(`# Vector ${example}`);
console.log(`did=${did}`);
console.log(`proof.id=${proof.id}`);
console.log(`proof.nonce=${proof.nonce}`);
console.log(`proof.updateId=${proof.updateId}`);
console.log(`proof.collapsed=${proof.collapsed}`);
console.log(`proof.hashes.count=${proof.hashes.length}`);
proof.hashes.forEach((h: string, i: number) => console.log(`proof.hashes[${i}]=${h}`));
console.log('');

const index = didToIndex(did);
console.log(`# Step 1: index = bigint(SHA-256(did))`);
console.log(`utf8(did).byteLength=${new TextEncoder().encode(did).byteLength}`);
console.log(`SHA-256(did).hex=${hex(blockHash(new TextEncoder().encode(did)))}`);
console.log(`index.hex=${bigIntToHex(index, true)}`);
console.log(`index.bin.LSB-first=${index.toString(2).padStart(256, '0').split('').reverse().join('').slice(0, 16)}... (showing first 16 LSBs)`);
console.log('');

// Leaf hash via two paths (must agree)
const leafBeacon = blockHash(blockHash(nonce), updateId);
console.log(`# Step 2: leaf hash (beacon path)`);
console.log(`SHA-256(nonce).hex=${hex(blockHash(nonce))}`);
console.log(`leaf.hex=blockHash(blockHash(nonce), updateId)`);
console.log(`leaf=${hex(leafBeacon)}`);
console.log('');

// Trace the validation loop manually
console.log(`# Step 3: walk 256 levels, LSB-of-index first, MSB-of-collapsed first`);
console.log(`# At each level i: bit = 2^(255-i); converge bit set => consume next sibling, else accumulate padding`);
console.log(`# isLeft = (nodeIndex & 1) == 0; nodeIndex >>= 1`);
console.log('');

let nodeIndex = index;
let nodeHash = leafBeacon;
let remaining = collapsed;
let hi = 0;
const leftPad: number[] = [];
const rightPad: number[] = [];

const finalizePadding = (label: string) => {
  if (leftPad.length > 0 || rightPad.length > 0) {
    const before = hex(nodeHash);
    const lp = leftPad.slice();
    const rp = rightPad.slice();
    nodeHash = blockHash(new Uint8Array(leftPad), nodeHash, new Uint8Array(rightPad));
    console.log(`  pad@${label}: H(leftPad[${lp.join(',')}] || node[${before}] || rightPad[${rp.join(',')}]) = ${hex(nodeHash)}`);
    leftPad.length = 0;
    rightPad.length = 0;
  }
};

let stopMerge = -1;
for (let i = 0; i < HASH_BIT_LENGTH; i++) {
  const isLeft = (nodeIndex & 1n) === 0n;
  nodeIndex >>= 1n;
  const b = bit(i);

  if ((remaining & b) !== 0n) {
    remaining ^= b;
    finalizePadding(`i=${i}`);

    if (hi >= siblings.length) {
      console.log(`  i=${i}: ERROR — converge says we need sibling ${hi} but only have ${siblings.length}`);
      stopMerge = i;
      break;
    }
    const peer = siblings[hi++]!;
    const before = hex(nodeHash);
    nodeHash = isLeft ? blockHash(nodeHash, peer) : blockHash(peer, nodeHash);
    console.log(`  i=${i}: merge ${isLeft ? 'L' : 'R'} sibling[${hi - 1}]=${hex(peer)}; before=${before}; after=${hex(nodeHash)}`);
    if (hi === siblings.length && remaining === 0n) {
      // Common case: ran out of work before reaching bit 0
      console.log(`  (all siblings consumed and converge cleared at i=${i}; loop continues only to accumulate root-side padding)`);
    }
  } else {
    const depth = HASH_BIT_LENGTH - i - 1;
    if (isLeft) {
      rightPad.push(depth);
    } else {
      leftPad.unshift(depth);
    }
  }
}

if (stopMerge < 0) finalizePadding('end');

console.log('');
console.log(`# Step 4: compare`);
console.log(`computed.root=${hex(nodeHash)}`);
console.log(`claimed.root =${hex(claimedRoot)}`);
console.log(`match=${hex(nodeHash) === hex(claimedRoot)}`);
console.log(`siblings.consumed=${hi}/${siblings.length}`);
console.log(`converge.remaining.hex=${remaining.toString(16)}`);
