// Walk A vs Walk B — verify danubetech SMT vectors against BOTH spec algorithms.
//
// Walk A: per appendix/optimized-smt.md.
//   LSB-first walk. bit=1 SKIPS the level entirely (no sibling, no hash,
//   candidate unchanged). bit=0 consumes the next sibling and merges per index bit.
//
// Walk B: per algorithms.md "SMT Proof Verification".
//   ALSO LSB-first (the spec's `let i = 255 - n` uses string-position indexing
//   where collapsed[255] is the rightmost = LSB, so i=255-n at n=0 reads LSB).
//   bit=1 uses cachedZero[n] as the sibling and STILL hashes.
//   bit=0 consumes proof.hashes.pop_front() and hashes.
//   Always performs 256 hash operations.
//
// The only behavioral difference is what happens at collapsed[i] == 1:
// Walk A skips; Walk B hashes with the zero-pyramid sibling.
//
// We test every (vector, leaf-formula, walk) combination and report a matrix.
//
// Run with:
//   pnpm tsx packages/method/lib/debug/walk-a-vs-walk-b.ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Hashing + base64url helpers (no @did-btcr2/smt dependency on purpose).
// ---------------------------------------------------------------------------

function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function b64uToBytes(s: string): Uint8Array {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = ALPHA.indexOf(ch);
    if (v < 0) throw new Error(`Invalid base64url char: ${ch}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  return n;
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += byte.toString(16).padStart(2, '0');
  return s;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Walk A — appendix/optimized-smt.md
// ---------------------------------------------------------------------------
//
// Variable-length walk. bit=1 means SKIP (no sibling, no hash). bit=0 means
// consume next sibling, merge using index bit (0=left, 1=right).
function walkA(
  index: bigint,
  collapsed: bigint,
  hashes: Uint8Array[],
  leaf: Uint8Array,
): Uint8Array | null {
  let candidate = leaf;
  let idx       = index;
  let bm        = collapsed;
  let hi        = 0;
  let step      = 0;

  while (bm !== 0n || hi < hashes.length) {
    if (step >= 256) return null;
    const cBit = bm & 1n;
    bm >>= 1n;
    if (cBit === 1n) {
      idx >>= 1n;
    } else {
      if (hi >= hashes.length) return null;
      const sib = hashes[hi++]!;
      const dir = idx & 1n;
      idx >>= 1n;
      candidate = dir === 0n ? sha256(candidate, sib) : sha256(sib, candidate);
    }
    step++;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Walk B — algorithms.md SMT Proof Verification
// ---------------------------------------------------------------------------
//
//   let cachedZero = [];
//   let z = 0;
//   for i in 0..=255 { z = hash(concat(z, z)); cachedZero[i] = z; }
//
//   for n in 0..=255 {
//     let i = 255 - n;                            // string-position indexing
//     let siblingHash = if proof.collapsed[i] == 1 {
//       cachedZero[n]
//     } else {
//       proof.hashes.pop_front()
//     };
//     if index[i] == 1 { c = hash(siblingHash || c); }
//     else             { c = hash(c || siblingHash); }
//   }
//
// The spec's `let i = 255 - n` reads bits LSB-first when `collapsed[i]` is
// interpreted as string-position indexing (where collapsed[255] is the
// rightmost / LSB bit). Below we use bit n of the integer representation,
// which is equivalent to the spec's collapsed[255 - n] under that convention.
//
// Walk B always performs 256 hash operations; proof.hashes must be drained exactly.
function buildCachedZero(): Uint8Array[] {
  const out: Uint8Array[] = [];
  let z = new Uint8Array(32); // zero leaf
  for (let i = 0; i < 256; i++) {
    z = sha256(z, z);
    out.push(z);
  }
  return out;
}

function walkB(
  index: bigint,
  collapsed: bigint,
  hashes: Uint8Array[],
  leaf: Uint8Array,
): Uint8Array | null {
  const cachedZero = buildCachedZero();
  let candidate = leaf;
  const queue = [...hashes];

  for (let n = 0; n < 256; n++) {
    const cBit = (collapsed >> BigInt(n)) & 1n;

    let sib: Uint8Array;
    if (cBit === 1n) {
      sib = cachedZero[n]!;
    } else {
      if (queue.length === 0) return null;
      sib = queue.shift()!;
    }

    const idxBit = (index >> BigInt(n)) & 1n;
    candidate = idxBit === 1n
      ? sha256(sib, candidate)
      : sha256(candidate, sib);
  }

  if (queue.length > 0) return null; // unused hashes
  return candidate;
}

// ---------------------------------------------------------------------------
// Vector loading
// ---------------------------------------------------------------------------

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

const ids = ['11a', '11b', '12a', '12b'];
const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Run matrix
// ---------------------------------------------------------------------------

interface Result {
  vector  : string;
  leaf    : 'spec' | 'dt';
  walk    : 'A' | 'B';
  matched : boolean;
  output  : string | null;
}

const results: Result[] = [];

for (const id of ids) {
  const v = vectors.find((x) => x.example === id);
  if (!v) continue;
  const p = v.resolutionOptions.sidecar.smtProofs[0]!;

  const nonce    = b64uToBytes(p.nonce);
  const updateId = b64uToBytes(p.updateId);
  const root     = b64uToBytes(p.id);
  const collapsed = bytesToBigInt(b64uToBytes(p.collapsed));
  const hashes    = p.hashes.map((h) => b64uToBytes(h));

  // index = bigint(SHA-256(did_utf8))
  const index = bytesToBigInt(sha256(encoder.encode(v.did)));

  const specLeaf = sha256(sha256(nonce), updateId);
  const dtLeaf   = updateId;

  for (const [leafLabel, leaf] of [['spec', specLeaf], ['dt', dtLeaf]] as const) {
    for (const [walkLabel, walkFn] of [
      ['A', walkA],
      ['B', walkB],
    ] as const) {
      const out = walkFn(index, collapsed, hashes, leaf);
      results.push({
        vector  : id,
        leaf    : leafLabel,
        walk    : walkLabel,
        matched : out !== null && bytesEqual(out, root),
        output  : out ? bytesToHex(out) : null,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('SMT Proof Verification: Walk A (appendix) vs Walk B (algorithms.md)');
console.log('Against danubetech vectors 11a, 11b, 12a, 12b');
console.log('Both walks iterate LSB-first; they differ only at collapsed bit == 1');
console.log('(Walk A skips the level; Walk B hashes with cachedZero[n]).\n');

console.log(
  '| Vector | Leaf | Walk | Match | Computed root (first 16 hex) |'
);
console.log(
  '|--------|------|------|-------|------------------------------|'
);
for (const r of results) {
  const root = r.output ? r.output.slice(0, 16) : '(null)';
  const m    = r.matched ? '✓ YES' : '  no ';
  console.log(
    `| ${r.vector.padEnd(6)} | ${r.leaf.padEnd(4)} | ${r.walk.padEnd(4)} | ${m} | ${root}             |`
  );
}

console.log('\nSummary by (leaf, walk):');
const combos = ['spec+A', 'dt+A', 'spec+B', 'dt+B'];
for (const c of combos) {
  const [leaf, walk] = c.split('+') as ['spec'|'dt', 'A'|'B'];
  const passes = results.filter((r) => r.leaf === leaf && r.walk === walk && r.matched).length;
  console.log(`  ${c.padEnd(10)} -> ${passes}/4 vectors verify`);
}
