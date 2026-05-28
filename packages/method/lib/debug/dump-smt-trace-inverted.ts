// Hypothesis test: danubetech may use the INVERTED convention for the collapsed
// bitmap — bit SET means "padding (no sibling)" rather than "sibling present".
// This script walks the proof under that assumption and reports whether the
// reconstructed root matches the claimed root.
//
//   pnpm tsx packages/method/lib/debug/dump-smt-trace-inverted.ts 12a
import {
  base64UrlToBigInt,
  base64UrlToHash,
  blockHash,
  didToIndex,
  hashToHex,
} from '@did-btcr2/smt';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH_BIT_LENGTH = 256;

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, 'danubetech-vectors.json'), 'utf8'));
const example = process.argv[2] ?? '12a';
const entry = vectors.find((v: { example: string }) => v.example === example);
if (!entry) { console.error(`Unknown example: ${example}`); process.exit(2); }

const proof = entry.resolutionOptions?.sidecar?.smtProofs?.[0];
const did = entry.did as string;
const nonce = base64UrlToHash(proof.nonce);
const updateId = base64UrlToHash(proof.updateId);
const collapsed = base64UrlToBigInt(proof.collapsed, false);
const claimedRoot = base64UrlToHash(proof.id);
const siblings = (proof.hashes as string[]).map((h) => base64UrlToHash(h));

console.log(`# Vector ${example} — INVERTED-CONVERGE hypothesis`);
console.log(`did=${did}`);
console.log(`collapsed.bin.first16bits.MSB-first=${collapsed.toString(2).padStart(256, '0').slice(0, 16)}`);
console.log(`siblings.count=${siblings.length}`);
console.log('');

const index = didToIndex(did);
const leaf = blockHash(blockHash(nonce), updateId);
console.log(`leaf=${hashToHex(leaf)}`);
console.log('');

// Walk: bit SET in collapsed = padding (no sibling). bit UNSET = consume sibling.
let nodeIndex = index;
let nodeHash = leaf;
let hi = 0;
const leftPad: number[] = [];
const rightPad: number[] = [];

const finalizePadding = (label: string) => {
  if (leftPad.length > 0 || rightPad.length > 0) {
    nodeHash = blockHash(new Uint8Array(leftPad), nodeHash, new Uint8Array(rightPad));
    console.log(`  pad@${label}: -> ${hashToHex(nodeHash)} (leftPad=[${leftPad.join(',')}] rightPad=[${rightPad.join(',')}])`);
    leftPad.length = 0;
    rightPad.length = 0;
  }
};

for (let i = 0; i < HASH_BIT_LENGTH; i++) {
  const isLeft = (nodeIndex & 1n) === 0n;
  nodeIndex >>= 1n;
  const b = 1n << BigInt(255 - i);

  if ((collapsed & b) === 0n) {
    // INVERTED: bit unset = consume sibling
    finalizePadding(`i=${i}`);
    if (hi >= siblings.length) { console.log(`  i=${i}: ERROR — need sibling ${hi} but only ${siblings.length} provided`); break; }
    const peer = siblings[hi++]!;
    const before = hashToHex(nodeHash);
    nodeHash = isLeft ? blockHash(nodeHash, peer) : blockHash(peer, nodeHash);
    console.log(`  i=${i}: merge ${isLeft ? 'L' : 'R'} sib[${hi - 1}] before=${before} after=${hashToHex(nodeHash)}`);
  } else {
    // INVERTED: bit set = padding
    const depth = HASH_BIT_LENGTH - i - 1;
    if (isLeft) rightPad.push(depth); else leftPad.unshift(depth);
  }
}
finalizePadding('end');

console.log('');
console.log(`computed.root=${hashToHex(nodeHash)}`);
console.log(`claimed.root =${hashToHex(claimedRoot)}`);
console.log(`match=${hashToHex(nodeHash) === hashToHex(claimedRoot)}`);
console.log(`siblings.consumed=${hi}/${siblings.length}`);
