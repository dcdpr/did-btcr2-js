/**
 * Funding summary. Walks the generated vectors of one network and collates
 * their `funding.json` files into `lib/scenarios/<network>/FUNDING.md`: the
 * addresses to fund, the anchors each address carries, and every beacon
 * address per scenario.
 *
 * Usage:
 *   pnpm scenario:funding --network regtest
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

import {
  fundingSummaryFile, indexScenarioDirs, loadCohorts, parseNetworkArg, readJSON,
  type FundingFile,
} from './_scenario-helpers.js';

const { network } = parseNetworkArg();

const entries: FundingFile[] = [];
for (const [, dir] of indexScenarioDirs(network)) {
  const path = join(dir, 'funding.json');
  if (existsSync(path)) entries.push(readJSON<FundingFile>(path));
}
entries.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));

const cohorts = loadCohorts(network);
const solo = entries.filter((e) => e.anchors.length > 0);
const members = entries.filter((e) => e.cohort !== null && e.needsFunding);
const dataOnly = entries.filter((e) => !e.needsFunding);

// address -> anchors carried, labels
const targets = new Map<string, { anchors: number; kind: string; labels: string[] }>();
for (const e of solo) {
  for (const a of e.anchors) {
    const t = targets.get(a.address) ?? { anchors: 0, kind: a.kind, labels: [] };
    t.anchors++;
    if (!t.labels.includes(e.scenarioId)) t.labels.push(e.scenarioId);
    targets.set(a.address, t);
  }
}

let md = `# Test Vector Funding Targets (${network})\n\n`;
md += `Generated from ${entries.length} scenarios: ${solo.length} anchor their own beacons, `;
md += `${members.length} are cohort members (one shared anchor per cohort), ${dataOnly.length} need no funding.\n\n`;

md += '## Solo beacon addresses\n\n';
md += 'Each address carries one OP_RETURN per anchor. Fund each address once; the anchor step chains the change.\n\n';
md += '| Address | Type | Anchors | Scenarios |\n|---------|------|---------|-----------|\n';
for (const [address, t] of targets) {
  md += `| \`${address}\` | ${t.kind} | ${t.anchors} | ${t.labels.join(', ')} |\n`;
}

md += '\n## Cohort beacon addresses\n\n';
md += 'One shared address per cohort, funded once, one OP_RETURN for every member.\n\n';
md += '| Cohort | Type | Members |\n|--------|------|---------|\n';
for (const c of cohorts) {
  md += `| ${c.id} | ${c.beaconType} | ${c.members.join(', ')} |\n`;
}

md += `\n### Plain list (${targets.size} solo addresses, one per line)\n\n\`\`\`\n`;
for (const address of targets.keys()) md += `${address}\n`;
md += '```\n\n';

md += '## All beacon addresses per scenario\n\n';
for (const e of entries) {
  md += `### ${e.scenarioId}\n\n- **DID:** \`${e.did}\`\n`;
  if (e.cohort) md += `- **Cohort:** ${e.cohort}\n`;
  if (e.allBeacons.length === 0) {
    md += '- _(no beacon services in this DID document)_\n';
  } else {
    md += '- Beacons:\n';
    for (const b of e.allBeacons) md += `  - \`${b.id.split('#')[1]}\` (${b.type}): \`${b.address}\`\n`;
  }
  if (e.anchors.length > 0) {
    md += '- Anchors:\n';
    for (const a of e.anchors) md += `  - update ${a.update} at \`${a.beaconId.split('#')[1]}\` (${a.kind}, key ${a.key}): \`${a.address}\`\n`;
  }
  md += '\n';
}

const outPath = fundingSummaryFile(network);
writeFileSync(outPath, md);
console.log(`Wrote ${outPath}\n`);
console.log(`Scenarios:        ${entries.length}`);
console.log(`Solo anchors:     ${solo.length} scenarios, ${targets.size} addresses`);
console.log(`Cohort members:   ${members.length}`);
console.log(`Data-only:        ${dataOnly.length}`);
