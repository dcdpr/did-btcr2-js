/**
 * Assign a fixed secret to every key of a recipe directory: the genesis key and
 * the extra keys of each scenario, and the aggregator key of each cohort.
 *
 * A fixed key makes a build deterministic: the same recipe gives the same DID
 * and the same beacon addresses, so funded UTXOs stay usable across builds.
 * Every network has its own recipe directory and its own secrets, so a
 * published key belongs to one chain only.
 *
 * Idempotent: a key that is already `fixed` stays as it is. `--force` rolls
 * every key again (the DIDs change; fund the new addresses).
 *
 * Usage:
 *   pnpm scenario:keys --network regtest
 *   pnpm scenario:keys --network regtest --force
 */

import { existsSync } from 'node:fs';

import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hex } from '@scure/base';

import {
  cohortsFile, parseNetworkArg, readJSON, recipeFiles, writeRecipeJSON,
  type CohortDef, type KeySpec, type Scenario,
} from './_scenario-helpers.js';

const { network, rest } = parseNetworkArg();
const force = rest.includes('--force');

function fixed(): KeySpec {
  return { source: 'fixed', secretHex: hex.encode(SchnorrKeyPair.generate().secretKey.bytes) };
}

/** Replace `spec` when it is `generate` or when `--force` is set. Returns the new spec and whether it changed. */
function fix(spec: KeySpec | undefined): { spec: KeySpec; changed: boolean } {
  if (spec?.source === 'fixed' && !force) return { spec, changed: false };
  return { spec: fixed(), changed: true };
}

let changed = 0;
let skipped = 0;

for (const path of recipeFiles(network)) {
  const recipe = readJSON<Scenario>(path);
  if (typeof recipe?.id !== 'string') continue;
  let touched = false;

  const genesis = fix(recipe.keys);
  recipe.keys = genesis.spec;
  touched ||= genesis.changed;

  for (const name of Object.keys(recipe.extraKeys ?? {})) {
    const extra = fix(recipe.extraKeys![name]);
    recipe.extraKeys![name] = extra.spec;
    touched ||= extra.changed;
  }

  if (!touched) {
    skipped++;
    console.log(`  skip   ${recipe.id} (already fixed)`);
    continue;
  }
  writeRecipeJSON(path, recipe);
  changed++;
  console.log(`  fixed  ${recipe.id}`);
}

let cohortChanged = 0;
let cohortSkipped = 0;
const cohortsPath = cohortsFile(network);
if (existsSync(cohortsPath)) {
  const file = readJSON<{ note?: string; cohorts: CohortDef[] }>(cohortsPath);
  for (const cohort of file.cohorts ?? []) {
    const next = fix(cohort.keys);
    cohort.keys = next.spec;
    if (next.changed) {
      cohortChanged++;
      console.log(`  fixed  cohort ${cohort.id}`);
    } else {
      cohortSkipped++;
      console.log(`  skip   cohort ${cohort.id} (already fixed)`);
    }
  }
  if (cohortChanged > 0) writeRecipeJSON(cohortsPath, file);
}

console.log(`\n${network}: ${changed} scenarios updated, ${skipped} skipped; ${cohortChanged} cohorts updated, ${cohortSkipped} skipped.`);
console.log(`Next: pnpm generate:scenario --network ${network} --clean`);
