// Hypothesis: leaf = updateId directly (no nonce mixing).
// Walk with INVERTED bitmap (bit set = zero/padding node, per spec text).
// Try BOTH "no padding optimization" and "depth-byte padding" variants.
import {
  base64UrlToBigInt,
  base64UrlToHash,
  blockHash,
  didToIndex,
  hashToHex,
  NULL_HASH,
} from '@did-btcr2/smt';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH_BIT_LENGTH = 256;

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, 'danubetech-vectors.json'), 'utf8'));
const example = process.argv[2] ?? '12a';
const entry = vectors.find((v: { example: string }) => v.example === example);

const proof = entry.resolutionOptions.sidecar.smtProofs[0];
const did = entry.did as string;
const collapsed = base64UrlToBigInt(proof.collapsed, false);
const claimedRoot = base64UrlToHash(proof.id);
const siblings = (proof.hashes as string[]).map((h) => base64UrlToHash(h));
const index = didToIndex(did);

console.log(`# Vector ${example} — leaf=updateId, inverted bitmap, NULL_HASH padding`);
console.log(`did=${did}`);
console.log(`claimed.root=${hashToHex(claimedRoot)}`);
console.log('');

const leaf = base64UrlToHash(proof.updateId);
console.log(`leaf=updateId=${hashToHex(leaf)}`);

// Variant A: NULL_HASH padding (no optimization)
{
  console.log('\n## Variant A: NULL_HASH for every padding level');
  let nodeIndex = index;
  let nodeHash = leaf;
  let hi = 0;
  for (let i = 0; i < HASH_BIT_LENGTH; i++) {
    const isLeft = (nodeIndex & 1n) === 0n;
    nodeIndex >>= 1n;
    const b = 1n << BigInt(255 - i);
    let peer: Uint8Array;
    if ((collapsed & b) === 0n) {
      if (hi >= siblings.length) { console.log(`  i=${i}: ERROR — need sibling but exhausted`); break; }
      peer = siblings[hi++]!;
    } else {
      peer = NULL_HASH;
    }
    nodeHash = isLeft ? blockHash(nodeHash, peer) : blockHash(peer, nodeHash);
  }
  console.log(`computed=${hashToHex(nodeHash)}`);
  console.log(`match=${hashToHex(nodeHash) === hashToHex(claimedRoot)}`);
  console.log(`siblings.consumed=${hi}/${siblings.length}`);
}

// Variant B: depth-byte padding (our quadrable-style optimization)
{
  console.log('\n## Variant B: depth-byte padding accumulated (our quadrable style)');
  let nodeIndex = index;
  let nodeHash = leaf;
  let hi = 0;
  const leftPad: number[] = [];
  const rightPad: number[] = [];
  const flush = () => {
    if (leftPad.length || rightPad.length) {
      nodeHash = blockHash(new Uint8Array(leftPad), nodeHash, new Uint8Array(rightPad));
      leftPad.length = 0; rightPad.length = 0;
    }
  };
  for (let i = 0; i < HASH_BIT_LENGTH; i++) {
    const isLeft = (nodeIndex & 1n) === 0n;
    nodeIndex >>= 1n;
    const b = 1n << BigInt(255 - i);
    if ((collapsed & b) === 0n) {
      flush();
      if (hi >= siblings.length) { console.log(`  i=${i}: ERROR — need sibling but exhausted`); break; }
      const peer = siblings[hi++]!;
      nodeHash = isLeft ? blockHash(nodeHash, peer) : blockHash(peer, nodeHash);
    } else {
      const depth = HASH_BIT_LENGTH - i - 1;
      if (isLeft) rightPad.push(depth); else leftPad.unshift(depth);
    }
  }
  flush();
  console.log(`computed=${hashToHex(nodeHash)}`);
  console.log(`match=${hashToHex(nodeHash) === hashToHex(claimedRoot)}`);
  console.log(`siblings.consumed=${hi}/${siblings.length}`);
}
