// Confirms that the now-rewritten @did-btcr2/smt package behaves identically to
// the standalone spec-correct verifier on the danubetech vectors.
//
// Expected outcome (mirrors spec-correct-verify.ts):
//   - spec-walk + spec-leaf       = FALSE for all 4 (danubetech data omits nonce)
//   - spec-walk + danubetech-leaf = TRUE  for all 4 (when we feed updateId as leaf)
//
// If the rewritten package agrees with these results, the package's walk
// algorithm is spec-correct and the only remaining divergence is in
// danubetech's leaf hashing.
//
// Run with:
//   pnpm tsx packages/method/lib/debug/verify-package-vs-spec.ts
import { base64UrlToHash, blockHash, didToIndex, SMTProof } from '@did-btcr2/smt';
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

function base64UrlToBigInt(s: string): bigint {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const ch of s) {
    const v = alpha.indexOf(ch);
    if (v < 0) throw new Error(`Invalid base64url char: ${ch}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(here, 'danubetech-vectors.json'), 'utf8'),
) as Vector[];

console.log('Verifying danubetech SMT vectors via the rewritten @did-btcr2/smt package\n');

const ids = ['11a', '11b', '12a', '12b'];
let allConsistent = true;

for (const id of ids) {
  const entry = vectors.find((v) => v.example === id);
  if (!entry) continue;
  const p = entry.resolutionOptions.sidecar.smtProofs[0]!;

  const nonce     = base64UrlToHash(p.nonce);
  const updateId  = base64UrlToHash(p.updateId);
  const root      = base64UrlToHash(p.id);
  const collapsed = base64UrlToBigInt(p.collapsed);
  const hashes    = p.hashes.map((h) => base64UrlToHash(h));

  const index   = didToIndex(entry.did);
  const proof   = new SMTProof(collapsed, hashes);

  const specLeaf = blockHash(blockHash(nonce), updateId); // per spec
  const dtLeaf   = updateId;                              // danubetech's bug

  const okSpec = proof.isValid(index, specLeaf, root);
  const okDT   = proof.isValid(index, dtLeaf, root);

  console.log(`Vector ${id}:`);
  console.log(`  spec-leaf       -> isValid = ${okSpec}`);
  console.log(`  danubetech-leaf -> isValid = ${okDT}`);

  // The package should match the standalone verifier:
  //   spec-leaf = false (their data is spec-incorrect)
  //   dt-leaf   = true  (they're consistent within their own convention)
  if (okSpec !== false || okDT !== true) {
    console.log(`  UNEXPECTED — does not match standalone spec-correct-verify.ts`);
    allConsistent = false;
  }
  console.log('');
}

if (!allConsistent) {
  console.error('Package output does not match standalone spec-correct verifier.');
  process.exit(1);
}
console.log('Package agrees with standalone spec-correct verifier on all 4 vectors.');
console.log('Conclusion: @did-btcr2/smt walk is spec-compliant; data is the divergence.');
