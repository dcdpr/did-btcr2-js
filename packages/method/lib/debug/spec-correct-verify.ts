// Implements the SMT proof verification algorithm EXACTLY as written in the
// did:btcr2 spec appendix:
//   https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html
//
// Spec walk (pseudocode from the page):
//   index = int(hash(did))
//   candidateHash = hash(hash(proof.nonce) + proof.updateId)
//   for each collapsed bit from the right:
//     if bit == 1: skip this index bit
//     if bit == 0: consume next sibling
//       index bit == 0: candidateHash = hash(candidateHash + sibling)
//       index bit == 1: candidateHash = hash(sibling + candidateHash)
//   assert candidateHash == proof.id
//
// This is INDEPENDENT of our own SMT package's verifier. We use it as a clean
// reference to (a) confirm the spec algorithm is right and (b) isolate the
// leaf-hash bug in danubetech's data.
//
// Run with:
//   pnpm tsx packages/method/lib/debug/spec-correct-verify.ts
import { base64UrlToHash, blockHash, didToIndex, hashToHex } from '@did-btcr2/smt';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface VectorProof {
  id        : string;
  nonce     : string;
  updateId  : string;
  collapsed : string;
  hashes    : string[];
}

interface Vector {
  example          : string;
  did              : string;
  resolutionOptions: { sidecar: { smtProofs: VectorProof[] } };
}

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, 'danubetech-vectors.json'), 'utf8'),
) as Vector[];

// Decode the `collapsed` field to a bigint. Per the spec walk, we read bits
// from the right (LSB), so the bigint's bit-0 corresponds to the leaf level.
function decodeCollapsed(b64: string): bigint {
  const bytes = base64UrlToHash.length // ensure tree-shake retains the import
    ? base64UrlDecodeRaw(b64)
    : new Uint8Array();
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

// Minimal base64url-nopad -> bytes decoder (avoids assuming a fixed length).
function base64UrlDecodeRaw(s: string): Uint8Array {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = alpha.indexOf(ch);
    if (v < 0) throw new Error(`Invalid base64url char: ${ch}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

// SPEC-CORRECT verification.
// Returns { valid, computed } so the caller can see both the verdict and the
// reconstructed root.
function verifySpec(
  did      : string,
  proof    : VectorProof,
  leafFn   : (nonceBytes: Uint8Array, updateIdBytes: Uint8Array) => Uint8Array,
): { valid: boolean; computed: string; consumed: number } {
  const nonce       = base64UrlToHash(proof.nonce);
  const updateId    = base64UrlToHash(proof.updateId);
  const claimedRoot = base64UrlToHash(proof.id);
  const siblings    = proof.hashes.map((h) => base64UrlToHash(h));
  const collapsed   = decodeCollapsed(proof.collapsed);

  let candidate = leafFn(nonce, updateId);
  let indexBig  = didToIndex(did);
  let hi        = 0;

  // Walk LSB-first of collapsed AND index. Each loop iteration consumes one
  // collapsed bit and (if bit==0) one index bit + one sibling.
  // A 256-leaf-depth tree has up to 256 levels of merges.
  let bitPos = 0;
  let bitmap = collapsed;
  while (bitmap !== 0n || hi < siblings.length) {
    const collapsedBit = bitmap & 1n;
    bitmap >>= 1n;

    if (collapsedBit === 1n) {
      // Skip this index bit. candidate unchanged.
      indexBig >>= 1n;
    } else {
      // Consume next sibling. index bit decides left/right.
      if (hi >= siblings.length) {
        return { valid: false, computed: hashToHex(candidate), consumed: hi };
      }
      const sibling = siblings[hi++]!;
      const indexBit = indexBig & 1n;
      indexBig >>= 1n;
      candidate = indexBit === 0n
        ? blockHash(candidate, sibling)
        : blockHash(sibling, candidate);
    }
    bitPos++;
    if (bitPos > 256) break; // safety
  }

  return {
    valid    : hashToHex(candidate) === hashToHex(claimedRoot),
    computed : hashToHex(candidate),
    consumed : hi,
  };
}

const specLeaf = (nonce: Uint8Array, updateId: Uint8Array): Uint8Array =>
  blockHash(blockHash(nonce), updateId);

const danubetechLeaf = (_n: Uint8Array, updateId: Uint8Array): Uint8Array =>
  updateId;

console.log('Spec-correct verification of danubetech SMT vectors\n');
console.log('Algorithm: https://dcdpr.github.io/did-btcr2/appendix/optimized-smt.html\n');

const smtVectors = ['11a', '11b', '12a', '12b'];
for (const id of smtVectors) {
  const entry = vectors.find((v) => v.example === id);
  if (!entry) continue;
  const proof = entry.resolutionOptions.sidecar.smtProofs[0]!;

  const specResult = verifySpec(entry.did, proof, specLeaf);
  const dtResult   = verifySpec(entry.did, proof, danubetechLeaf);

  console.log(`Vector ${id}  (did ends in ...${entry.did.slice(-6)})`);
  console.log(`  claimed root                : ${proof.id}`);
  console.log(`  spec-walk + spec-leaf       : valid=${specResult.valid}  computed=${specResult.computed}`);
  console.log(`  spec-walk + danubetech-leaf : valid=${dtResult.valid}  computed=${dtResult.computed}`);
  console.log('');
}

console.log('Interpretation:');
console.log('  If "spec-walk + spec-leaf" is FALSE but "spec-walk + danubetech-leaf"');
console.log('  is TRUE, then the spec walk algorithm is correctly implemented and');
console.log('  the divergence is solely in the leaf hash: danubetech omits the nonce.');
