// Assign a fixed secret key to every scenario recipe so that re-running the
// orchestrator is deterministic: same scenario -> same DID -> same beacon
// addresses. Idempotent — scenarios already marked `fixed` are left untouched.
//
// This must be run (once) before funding, because funded UTXOs are tied to
// addresses derived from the scenario key. With `generate` keys, every build
// mints a new key and strands any sats sent to the previous address.
//
// Run with:
//   bun lib/scenario-keys.ts          # assign to any scenario still on `generate`
//   bun lib/scenario-keys.ts --force   # re-roll every scenario's key
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hex } from '@scure/base';

const HERE          = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(HERE, 'scenarios');
const COHORTS_FILE  = join(HERE, 'cohorts.json');
const force         = process.argv.includes('--force');

// Matches the single-line keys field in either state.
const GENERATE_RE = /"keys"\s*:\s*\{\s*"source"\s*:\s*"generate"\s*\}/;
const FIXED_RE    = /"keys"\s*:\s*\{\s*"source"\s*:\s*"fixed"[^}]*\}/;

let changed = 0;
let skipped = 0;

for (const file of readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.json')).sort()) {
  const path = join(SCENARIOS_DIR, file);
  const raw  = readFileSync(path, 'utf-8');

  const isFixed = FIXED_RE.test(raw);
  if (isFixed && !force) {
    skipped++;
    console.log(`  skip   ${file} (already fixed)`);
    continue;
  }

  const secretHex = hex.encode(SchnorrKeyPair.generate().secretKey.bytes);
  const replacement = `"keys": { "source": "fixed", "secretHex": "${secretHex}" }`;

  let next: string;
  if (GENERATE_RE.test(raw)) {
    next = raw.replace(GENERATE_RE, replacement);
  } else if (isFixed) {
    next = raw.replace(FIXED_RE, replacement);
  } else {
    console.log(`  WARN   ${file} has no recognizable keys field — skipping`);
    skipped++;
    continue;
  }

  writeFileSync(path, next);
  changed++;
  console.log(`  fixed  ${file} -> ${secretHex.slice(0, 16)}...`);
}

// ─── Cohort (aggregator) keys ───────────────────────────────────────────────
// Paired scenarios (09-12) anchor at a SHARED beacon whose address derives from
// the cohort's own key, not any member's genesis key. Fix those here too so the
// shared addresses are stable and fundable. cohorts.json is structured, so we
// edit it via parse/stringify rather than the regex used for scenario files.
interface CohortKeys {
  source: 'generate' | 'fixed';
  secretHex?: string;
}
interface Cohort {
  id: string;
  keys: CohortKeys;
  [k: string]: unknown;
}
interface CohortsFile {
  note?: string;
  cohorts: Cohort[];
}

let cohortChanged = 0;
let cohortSkipped = 0;
try {
  const file = JSON.parse(readFileSync(COHORTS_FILE, 'utf-8')) as CohortsFile;
  for (const cohort of file.cohorts ?? []) {
    if (cohort.keys?.source === 'fixed' && !force) {
      cohortSkipped++;
      console.log(`  skip   cohort ${cohort.id} (already fixed)`);
      continue;
    }
    const secretHex = hex.encode(SchnorrKeyPair.generate().secretKey.bytes);
    cohort.keys = { source: 'fixed', secretHex };
    cohortChanged++;
    console.log(`  fixed  cohort ${cohort.id} -> ${secretHex.slice(0, 16)}...`);
  }
  if (cohortChanged > 0) {
    writeFileSync(COHORTS_FILE, JSON.stringify(file, null, 2) + '\n');
  }
} catch (err) {
  console.log(`  WARN   could not process cohorts.json: ${(err as Error).message}`);
}

console.log(`\nDone. ${changed} scenarios updated, ${skipped} skipped; ${cohortChanged} cohorts updated, ${cohortSkipped} skipped.`);
console.log('Next: bun lib/generate-scenario.ts lib/scenarios/<id>.json (or rebuild all).');
