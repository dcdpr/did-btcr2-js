/**
 * Scenario anchorer (Batch C, step 5).
 *
 * Broadcasts the on-chain OP_RETURN beacon signals for every update-bearing
 * scenario, spending the UTXOs placed by `scenario:fund`:
 *
 *   - Cohort beacons (09-12): ONE OP_RETURN per cohort carrying the shared
 *     signal from `lib/scenarios/cohorts/<id>.json` (CAS announcement hash for
 *     09/10, SMT root for 11/12), signed by the cohort aggregator key.
 *   - Solo singleton beacons (02/04/06/07/08): one OP_RETURN per update, each
 *     carrying that update's hash, signed by the scenario genesis key. Multi-
 *     update scenarios anchor sequentially, chaining the change UTXO.
 *
 * Determinism note: BIP340 signing is non-deterministic, so the signal a vector
 * commits to is fixed only for the current build. Run generate -> artifacts ->
 * route -> publish -> fund -> anchor as one pipeline; do not regenerate between
 * artifacts and anchor or the recorded signals go stale.
 *
 * Usage:
 *   bun lib/anchor-scenarios.ts          # broadcast all OP_RETURN signals
 *   bun lib/anchor-scenarios.ts --dry    # list anchors (address, signal), no broadcast
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalHash } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '../src/core/btcr2-update.js';

import { anchorSignal } from './wallet/tx-builder.js';
import type { Network } from './wallet/store.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const COHORTS_FILE = join(HERE, 'cohorts.json');
const NETWORK: Network = 'mutinynet';

type CohortDef = { id: string; keys: { source: string; secretHex?: string } };
type Anchor = { label: string; secretHex: string; signalHex: string };

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function readSignedUpdates(dir: string, count: number): SignedBTCR2Update[] {
  if (count === 1) return [readJSON<{ signedUpdate: SignedBTCR2Update }>(join(dir, 'update', 'output.json')).signedUpdate];
  const out: SignedBTCR2Update[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(readJSON<{ signedUpdate: SignedBTCR2Update }>(join(dir, 'update', String(i).padStart(2, '0'), 'output.json')).signedUpdate);
  }
  return out;
}

/** Ordered anchor list: cohort signals first, then solo per-update signals. */
function collectAnchors(): Anchor[] {
  const anchors: Anchor[] = [];

  // Cohort signals (one per cohort).
  for (const cohort of readJSON<{ cohorts: CohortDef[] }>(COHORTS_FILE).cohorts) {
    if (cohort.keys.source !== 'fixed' || !cohort.keys.secretHex) continue;
    const cohortPath = join(HERE, 'scenarios', 'cohorts', `${cohort.id}.json`);
    if (!existsSync(cohortPath)) continue;
    const signalHex = readJSON<{ signalHex: string }>(cohortPath).signalHex;
    anchors.push({ label: cohort.id, secretHex: cohort.keys.secretHex, signalHex });
  }

  // Solo singleton signals (one per update; the singleton OP_RETURN = update hash).
  for (const type of ['k1', 'x1']) {
    const typeDir = join(DATA_DIR, NETWORK, type);
    if (!existsSync(typeDir)) continue;
    for (const h of readdirSync(typeDir)) {
      const dir = join(typeDir, h);
      if (!existsSync(join(dir, 'funding.json'))) continue;
      const f = readJSON<{ needsFunding: boolean; cohort: string | null }>(join(dir, 'funding.json'));
      if (!f.needsFunding || f.cohort) continue;
      const scenario = readJSON<{ id: string; updates?: unknown[] }>(join(dir, 'scenario.json'));
      const count = (scenario.updates ?? []).length;
      if (count === 0) continue;
      const genesisSecret = readJSON<{ genesisKeys: { secret: string } }>(join(dir, 'other.json')).genesisKeys.secret;
      const updates = readSignedUpdates(dir, count);
      updates.forEach((u, i) => anchors.push({
        label     : `${scenario.id} update ${i + 1}/${count}`,
        secretHex : genesisSecret,
        signalHex : canonicalHash(u as Record<string, unknown>, { encoding: 'hex' }),
      }));
    }
  }

  return anchors;
}

async function run(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const anchors = collectAnchors();
  console.log(`=== scenario:anchor (${NETWORK}) - ${anchors.length} OP_RETURN signals ===`);

  if (dry) {
    for (const a of anchors) console.log(`  ${a.signalHex.slice(0, 20)}...  [${a.label}]`);
    console.log('\n  --dry: nothing broadcast. Fund first (pnpm scenario:fund) and confirm.');
    return;
  }

  let ok = 0, fail = 0;
  for (const a of anchors) {
    try {
      const r = await anchorSignal({ secretHex: a.secretHex, signalHex: a.signalHex, network: NETWORK });
      console.log(`  OK  ${a.label}  tx=${r.txid} (fee ${r.feeSats})  @${r.address}`);
      ok++;
    } catch (e) {
      console.log(`  ERR ${a.label}  ${(e as Error).message}`);
      fail++;
    }
  }
  console.log(`\n=== anchored ${ok}/${anchors.length} (${fail} failed) ===`);
  if (fail === 0) console.log('  Wait for confirmations, then run: pnpm scenario:verify:live');
  process.exit(fail ? 1 : 0);
}

await run();
