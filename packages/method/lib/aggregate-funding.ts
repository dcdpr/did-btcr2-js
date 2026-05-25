// Walk all generated scenario directories under lib/data/ and collate their
// funding requirements into a single markdown table.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE     = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');

interface FundingFile {
  scenarioId    : string;
  network       : string;
  did           : string;
  needsFunding  : boolean;
  cohort        : string | null;
  primaryBeacon : string | null;
  allBeacons    : Array<{ id: string; type: string; address: string }>;
}

const entries: FundingFile[] = [];

function listDirs(parent: string): string[] {
  return readdirSync(parent).filter((name) => {
    if (name.startsWith('.')) return false;
    try {
      return statSync(join(parent, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

// Dedupe by scenarioId: a scenario may have stale build dirs from before its
// key was fixed. Keep the most recently written funding.json per scenarioId.
const byScenario = new Map<string, { entry: FundingFile; mtime: number }>();

for (const network of listDirs(DATA_DIR)) {
  const netDir = join(DATA_DIR, network);
  for (const typePrefix of listDirs(netDir)) {
    const typeDir = join(netDir, typePrefix);
    for (const hash of listDirs(typeDir)) {
      const fundingPath = join(typeDir, hash, 'funding.json');
      if (!existsSync(fundingPath)) continue;
      const entry = JSON.parse(readFileSync(fundingPath, 'utf-8')) as FundingFile;
      const mtime = statSync(fundingPath).mtimeMs;
      const prev  = byScenario.get(entry.scenarioId);
      if (!prev || mtime > prev.mtime) {
        byScenario.set(entry.scenarioId, { entry, mtime });
      }
    }
  }
}

entries.push(...[...byScenario.values()].map((v) => v.entry));
entries.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));

const needs   = entries.filter((e) => e.needsFunding);
const noNeeds = entries.filter((e) => !e.needsFunding);

let md = '# Test Vector Funding Targets\n\n';
md += `Generated across ${entries.length} scenarios. `;
md += `${needs.length} have updates and need at least one beacon funded; `;
md += `${noNeeds.length} are no-update vectors (data-only).\n\n`;

md += '## Needs funding (P2WPKH, cheapest to spend from)\n\n';
md += 'Cohort members (09-12) share ONE beacon address per cohort: fund it once and the single OP_RETURN covers every member. Solo update scenarios fund their own P2WPKH singleton.\n\n';
md += '| Scenario | Network | Cohort | Beacon address |\n';
md += '|----------|---------|--------|----------------|\n';
for (const e of needs) {
  md += `| ${e.scenarioId} | ${e.network} | ${e.cohort ?? '-'} | \`${e.primaryBeacon}\` |\n`;
}

// Dedupe by address: cohort members repeat the same shared address, and we only
// want to fund each address once.
const uniqueAddrs = [...new Set(needs.map((e) => e.primaryBeacon).filter((a): a is string => !!a))];
md += `\n### Plain list (${uniqueAddrs.length} unique addresses, one per line, for piping into a script)\n\n\`\`\`\n`;
for (const a of uniqueAddrs) {
  md += `${a}\n`;
}
md += '```\n\n';

md += '## All beacon addresses per scenario\n\n';
md += 'In case you want to fund a different address type per scenario.\n\n';
for (const e of entries) {
  md += `### ${e.scenarioId}\n\n`;
  md += `- **DID:** \`${e.did}\`\n`;
  md += `- **Network:** ${e.network}\n`;
  if (e.allBeacons.length === 0) {
    md += `- _(no beacon services in this DID's document)_\n`;
  } else {
    md += `- Beacons:\n`;
    for (const b of e.allBeacons) {
      md += `  - \`${b.id.split('#')[1]}\` (${b.type}): \`${b.address}\`\n`;
    }
  }
  md += '\n';
}

const outPath = join(HERE, 'FUNDING.md');
writeFileSync(outPath, md);
console.log(`Wrote ${outPath}\n`);
console.log(`Scenarios:      ${entries.length}`);
console.log(`Needs funding:  ${needs.length}`);
console.log(`Data-only:      ${noNeeds.length}`);
