/**
 * README generator (pipeline step 8).
 *
 * Writes `lib/data/<network>/README.md` from the generated vectors: the
 * hand-written head of `lib/scenarios/<network>/README.head.md` (the network
 * setup), the comparison rules, and one table row per vector with the
 * scenario id, the type, the delivery, the expected result, the DID, and the
 * path. The sub-vectors of a scenario are listed with the recorded value of
 * each option, not the recipe form (`before:1`, `depth:2`). The expected
 * result of a negative vector also names the rule id of the set, and the
 * section `Expected failures` lists each rule id with its error code, the
 * rule, the link to the specification, and the sets that break it (ADR 136).
 *
 * Usage:
 *   pnpm scenario:readme --network regtest
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FAILURE_RULES, findCohort, indexScenarioDirs, isDuplicate, isMinConfForm, loadCohorts, loadRecipes, networkDataDir,
  parseNetworkArg, readExpected, readJSON, readmeHeadFile, realUpdates, resolveCaseDir, SPEC_URL,
  type Scenario,
} from './_scenario-helpers.js';

const { network } = parseNetworkArg();

function deliveryOf(recipe: Scenario, cohortType: string | undefined): string {
  const parts: string[] = [];
  if (recipe.idType === 'EXTERNAL') parts.push(`genesis ${recipe.delivery?.genesis ?? 'sidecar'}`);
  const updates = realUpdates(recipe).map((u) => (u.withhold ? 'withheld' : u.delivery));
  if (updates.length > 0) parts.push(`${updates.length} update${updates.length > 1 ? 's' : ''} ${[...new Set(updates)].join('/')}`);
  else if (cohortType) parts.push('no update');
  const again = recipe.updates.filter(isDuplicate).length;
  if (again > 0) parts.push(`${again} duplicate signal${again > 1 ? 's' : ''}`);
  if (cohortType === 'CASBeacon') parts.push(`announcement ${recipe.delivery?.announcement ?? 'sidecar'}`);
  if (cohortType === 'SMTBeacon') {
    const proof = recipe.smt?.proof;
    parts.push(proof === 'withhold' ? 'no SMT proof' : proof ? `SMT proof sidecar (\`${proof}\` changed)` : 'SMT proof sidecar');
    if (recipe.smt?.nonce === false) parts.push('no nonce');
  }
  return parts.length > 0 ? parts.join(', ') : 'no update';
}

function expectedText(outputPath: string): string {
  const e = readExpected(outputPath);
  return e.kind === 'ok' ? `versionId ${e.versionId}${e.deactivated ? ', deactivated' : ''}` : `error \`${e.error}\``;
}

/** The rule id of a negative set, with a link to its row in the section `Expected failures`. */
function ruleText(recipe: Scenario): string {
  return recipe.expect ? `, rule [\`${recipe.expect.rule}\`](#expected-failures)` : '';
}

/** The section `Expected failures`: one row per rule that a negative set of the network breaks. */
function expectedFailures(negatives: Scenario[]): string {
  let md = '## Expected failures\n\n';
  md += 'The `expectedFailure` of a negative set is the id of the rule that the set breaks. Two sets that break the same rule share the id. ';
  md += 'The ids are stable: an id never changes, and it never names another rule. A new rule gets a new id.\n\n';
  md += '| Rule id | Error | Rule | Specification | Sets |\n|---------|-------|------|---------------|------|\n';
  for (const [id, rule] of Object.entries(FAILURE_RULES)) {
    const sets = negatives.filter((r) => r.expect?.rule === id);
    if (sets.length === 0) continue;
    const anchor = rule.section.split('#')[1] ?? rule.section;
    const links = sets.map((r) => `[${r.id.split('-')[0]}](#${r.id})`).join(', ');
    md += `| \`${id}\` | \`${rule.error}\` | ${rule.rule} | [${anchor}](${SPEC_URL}${rule.section}) | ${links} |\n`;
  }
  return md + '\n';
}

function run(): void {
  const recipes = loadRecipes(network);
  const idx = indexScenarioDirs(network);
  const cohorts = loadCohorts(network);

  const head = existsSync(readmeHeadFile(network))
    ? readFileSync(readmeHeadFile(network), 'utf-8').trimEnd() + '\n\n'
    : `# did:btcr2 ${network} test vectors\n\n`;

  let md = head;
  md += '## Layout\n\n';
  md += 'Each vector set lives under `{k1|x1}/{hash}/`:\n\n';
  md += '- `create/input.json`, `create/output.json`: the create operation.\n';
  md += '- `update/input.json`, `update/output.json`: the update operation; `update/NN/` for a set with more than one update. `signingMaterial` is the secret key of the signer.\n';
  md += '- `resolve/input.json`, `resolve/output.json`: the resolve operation with the sidecar; `resolve/NN/` for a sub-vector with resolution options.\n';
  md += '- `other.json`: the keys and the genesis document. A negative set also has `expectedFailure`: the id of the rule that the set breaks (see [Expected failures](#expected-failures)).\n';
  md += '- `signals.json` (a set with a Beacon Signal on the chain): one entry per signal with the update it commits to (`update` is the `update/NN/` number; `duplicate` marks a second signal of the same update in a later block), the beacon id, the address, the `txid`, the block height, hash, time, and `mediantime`, the signal bytes, and `recordedTip` (the chain tip height when the outputs were recorded). A cohort member records the shared signal with the cohort id and members. A cohort member with no update has no `update` member: the signal commits to no update of the DID.\n\n';
  md += '## How to compare\n\n';
  md += '- Take the inputs and produce your own outputs. The signed bytes of an update are not compared: BIP340 signing is randomized. Your signed update must verify and must resolve to the recorded document.\n';
  md += '- `resolve/output.json` is the DID Resolution result. Compare `didDocument`, `didDocumentMetadata.versionId`, and `didDocumentMetadata.deactivated`. Compare `didDocumentMetadata.confirmations` as "at least the recorded value": it grows with the chain. `updated` is the header time of the block of the last applied update.\n';
  md += '- A negative vector records `didResolutionMetadata.error` with the DID Resolution error code. Compare the code. Then check that your resolver fails for the rule of `expectedFailure` in `other.json`. `errorMessage` is the text of this implementation: do not compare it.\n';
  md += '- Resolution applies a beacon signal at six confirmations (the specification default). A resolve before that depth returns an earlier version.\n';
  md += '- `signals.json` is what your signal discovery must find at the beacon addresses. Compare the `txid`, the block, and the signal bytes; a resolver that reads no chain can take the signals from the file.\n';
  md += '- `recordedTip` pins the chain of a set. At that tip, each signal has `recordedTip - blockHeight + 1` confirmations. Each recorded `confirmations` is equal to that value for the block of the last applied update.\n';
  const depthForms = [...recipes.values()].some((r) => (r.resolves ?? []).some((c) => isMinConfForm(c.options.minConf)));
  if (depthForms) {
    md += '- A sub-vector with `minConf` equal to the confirmation count of one signal holds only at `recordedTip`. The chain of the Polar export is at that tip. A block that you mine changes the result.\n';
  }
  md += '\n';

  const rows: Array<{ recipe: Scenario; dir: string; did: string; negative: boolean }> = [];
  for (const id of [...recipes.keys()].sort()) {
    const dir = idx.get(id);
    if (!dir) continue;
    const recipe = recipes.get(id)!;
    const did = readJSON<{ did: string }>(join(dir, 'resolve', 'input.json')).did;
    rows.push({ recipe, dir, did, negative: recipe.expect !== undefined });
  }

  for (const [title, negative] of [['Positive vectors', false], ['Negative vectors', true]] as const) {
    const subset = rows.filter((r) => r.negative === negative);
    if (subset.length === 0) continue;
    md += `## ${title}\n\n`;
    md += '| Scenario | Type | Delivery | Expected | Path |\n|----------|------|----------|----------|------|\n';
    for (const r of subset) {
      const cohort = findCohort(r.recipe.id, cohorts);
      const rel = r.dir.slice(networkDataDir(network).length + 1);
      const expected = `${expectedText(join(r.dir, 'resolve', 'output.json'))}${ruleText(r.recipe)}`;
      md += `| ${r.recipe.id} | ${r.recipe.idType === 'KEY' ? 'k1' : 'x1'} | ${deliveryOf(r.recipe, cohort?.beaconType)} | ${expected} | [\`${rel}/\`](./${rel}/) |\n`;
    }
    md += '\n';
    for (const r of subset) {
      md += `### ${r.recipe.id}\n\n${r.recipe.description}\n\n`;
      md += `DID: \`${r.did}\`\n\n`;
      const cases = r.recipe.resolves ?? [];
      if (cases.length > 0) {
        md += '| Sub-vector | Options | Expected |\n|------------|---------|----------|\n';
        for (const c of cases) {
          // The recorded value of each option: the record step writes the value of a form into the input.
          const recorded = readJSON<{ resolutionOptions: Record<string, unknown> }>(join(resolveCaseDir(r.dir, c.id), 'input.json')).resolutionOptions;
          const options = Object.fromEntries(Object.keys(c.options).map((k) => [k, recorded[k] ?? c.options[k as keyof typeof c.options]]));
          md += `| \`resolve/${c.id}/\` | \`${JSON.stringify(options)}\` | ${expectedText(join(resolveCaseDir(r.dir, c.id), 'output.json'))} |\n`;
        }
        md += '\n';
      }
    }
  }
  const negatives = rows.filter((r) => r.negative).map((r) => r.recipe);
  if (negatives.length > 0) md += expectedFailures(negatives);

  const outPath = join(networkDataDir(network), 'README.md');
  writeFileSync(outPath, md);
  console.log(`Wrote ${outPath} (${rows.length} vectors)`);
}

run();
