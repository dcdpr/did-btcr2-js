/**
 * README generator (pipeline step 8).
 *
 * Writes `lib/data/<network>/README.md` from the generated vectors: the
 * hand-written head of `lib/scenarios/<network>/README.head.md` (the network
 * setup), the comparison rules, and one table row per vector with the
 * scenario id, the type, the delivery, the expected result, the DID, and the
 * path. The sub-vectors of a scenario are listed with their options.
 *
 * Usage:
 *   pnpm scenario:readme --network regtest
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  findCohort, indexScenarioDirs, isDuplicate, isMinConfForm, loadCohorts, loadRecipes, networkDataDir, parseNetworkArg,
  readExpected, readJSON, readmeHeadFile, realUpdates, resolveCaseDir,
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
  md += '- `other.json`: the keys and the genesis document.\n';
  md += '- `signals.json` (a set with a Beacon Signal on the chain): one entry per signal with the update it commits to (`update` is the `update/NN/` number; `duplicate` marks a second signal of the same update in a later block), the beacon id, the address, the `txid`, the block height, hash, time, and `mediantime`, the signal bytes, and `recordedTip` (the chain tip height when the outputs were recorded). A cohort member records the shared signal with the cohort id and members. A cohort member with no update has no `update` member: the signal commits to no update of the DID.\n\n';
  md += '## How to compare\n\n';
  md += '- Take the inputs and produce your own outputs. The signed bytes of an update are not compared: BIP340 signing is randomized. Your signed update must verify and must resolve to the recorded document.\n';
  md += '- `resolve/output.json` is the DID Resolution result. Compare `didDocument`, `didDocumentMetadata.versionId`, and `didDocumentMetadata.deactivated`. Compare `didDocumentMetadata.confirmations` as "at least the recorded value": it grows with the chain. `updated` is the header time of the block of the last applied update.\n';
  md += '- A negative vector records `didResolutionMetadata.error` with the DID Resolution error code. Compare the code only; `errorMessage` is the text of this implementation.\n';
  md += '- Resolution applies a beacon signal at six confirmations (the specification default). A resolve before that depth returns an earlier version.\n';
  md += '- `signals.json` is what your signal discovery must find at the beacon addresses. Compare the `txid`, the block, and the signal bytes; a resolver that reads no chain can take the signals from the file.\n';
  md += '- `recordedTip` pins the chain of a set. At that tip, each signal has `recordedTip - blockHeight + 1` confirmations, and each recorded `confirmations` is at least the recorded value.\n';
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
      md += `| ${r.recipe.id} | ${r.recipe.idType === 'KEY' ? 'k1' : 'x1'} | ${deliveryOf(r.recipe, cohort?.beaconType)} | ${expectedText(join(r.dir, 'resolve', 'output.json'))} | [\`${rel}/\`](./${rel}/) |\n`;
    }
    md += '\n';
    for (const r of subset) {
      md += `### ${r.recipe.id}\n\n${r.recipe.description}\n\n`;
      md += `DID: \`${r.did}\`\n\n`;
      const cases = r.recipe.resolves ?? [];
      if (cases.length > 0) {
        md += '| Sub-vector | Options | Expected |\n|------------|---------|----------|\n';
        for (const c of cases) {
          md += `| \`resolve/${c.id}/\` | \`${JSON.stringify(c.options)}\` | ${expectedText(join(resolveCaseDir(r.dir, c.id), 'output.json'))} |\n`;
        }
        md += '\n';
      }
    }
  }

  const outPath = join(networkDataDir(network), 'README.md');
  writeFileSync(outPath, md);
  console.log(`Wrote ${outPath} (${rows.length} vectors)`);
}

run();
