#!/usr/bin/env node
// Aggregate per-package c8 json-summary coverage into one repo-wide number,
// then emit a committed SVG badge (.github/badges/coverage.svg) and a
// COVERAGE.md table. Fully FOSS and offline: no third-party coverage service,
// no network, no uploader. Run via `pnpm coverage` (which runs the tests first)
// or `pnpm coverage:report` against already-generated coverage/ output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKGS = ['common', 'keypair', 'cryptosuite', 'bitcoin', 'key-manager', 'smt', 'method', 'aggregation', 'api', 'cli'];
const METRICS = ['lines', 'statements', 'functions', 'branches'];

const rows = [];
const totals = Object.fromEntries(METRICS.map(m => [m, { covered: 0, total: 0 }]));
const missing = [];

for (const pkg of PKGS) {
  const fp = path.join(ROOT, 'packages', pkg, 'coverage', 'coverage-summary.json');
  if (!fs.existsSync(fp)) { missing.push(pkg); continue; }
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(fp, 'utf8')).total;
  } catch {
    summary = undefined;
  }
  // A present-but-corrupt or total-less file (interrupted test run, partial write)
  // is treated like a missing package rather than crashing the whole report.
  if (!summary) { missing.push(pkg); continue; }
  const row = { pkg };
  for (const m of METRICS) {
    const { covered = 0, total = 0 } = summary[m] ?? {};
    row[m] = { covered, total, pct: total ? (covered / total) * 100 : 100 };
    totals[m].covered += covered;
    totals[m].total += total;
  }
  rows.push(row);
}

if (!rows.length) {
  console.error('coverage-report: no coverage-summary.json found. Run `pnpm test` (or `pnpm coverage`) first.');
  process.exit(1);
}

const pctOf = m => (totals[m].total ? (totals[m].covered / totals[m].total) * 100 : 100);
const linesPct = pctOf('lines');

// ---- badge ----
function color(pct) {
  if (pct >= 95) return '#4c1';        // brightgreen
  if (pct >= 90) return '#97ca00';     // green
  if (pct >= 80) return '#a4a61d';     // yellowgreen
  if (pct >= 70) return '#dfb317';     // yellow
  if (pct >= 60) return '#fe7d37';     // orange
  return '#e05d44';                    // red
}
function badge(label, message, fill) {
  const w = s => Math.round(s.length * 6.4) + 12;
  const lw = w(label), mw = w(message), total = lw + mw;
  const lx = Math.round((lw / 2) * 10);
  const mx = Math.round((lw + mw / 2) * 10);
  const ltl = (lw - 12) * 10, mtl = (mw - 12) * 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${total}" height="20" role="img" aria-label="${label}: ${message}">
  <title>${label}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${mw}" height="20" fill="${fill}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${ltl}">${label}</text>
    <text x="${lx}" y="140" transform="scale(.1)" fill="#fff" textLength="${ltl}">${label}</text>
    <text aria-hidden="true" x="${mx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${mtl}">${message}</text>
    <text x="${mx}" y="140" transform="scale(.1)" fill="#fff" textLength="${mtl}">${message}</text>
  </g>
</svg>
`;
}

const badgeDir = path.join(ROOT, '.github', 'badges');
fs.mkdirSync(badgeDir, { recursive: true });
fs.writeFileSync(path.join(badgeDir, 'coverage.svg'), badge('coverage', `${linesPct.toFixed(0)}%`, color(linesPct)));

// ---- COVERAGE.md ----
const fmt = c => `${c.pct.toFixed(1)}% (${c.covered}/${c.total})`;
const header = '| Package | Lines | Statements | Functions | Branches |\n|---|---|---|---|---|';
const body = rows
  .slice()
  .sort((a, b) => a.pkg.localeCompare(b.pkg))
  .map(r => `| \`@did-btcr2/${r.pkg}\` | ${fmt(r.lines)} | ${fmt(r.statements)} | ${fmt(r.functions)} | ${fmt(r.branches)} |`)
  .join('\n');
const totalRow = `| **Total** | **${fmt({ pct: pctOf('lines'), covered: totals.lines.covered, total: totals.lines.total })}** | `
  + `**${fmt({ pct: pctOf('statements'), covered: totals.statements.covered, total: totals.statements.total })}** | `
  + `**${fmt({ pct: pctOf('functions'), covered: totals.functions.covered, total: totals.functions.total })}** | `
  + `**${fmt({ pct: pctOf('branches'), covered: totals.branches.covered, total: totals.branches.total })}** |`;

const md = `# Coverage

![coverage](.github/badges/coverage.svg)

Auto-generated by \`pnpm coverage\`. Do not edit by hand. Coverage is produced locally
by \`c8\` (V8 coverage) and aggregated across all published packages: no third-party
coverage service is involved.

**Repo-wide line coverage: ${linesPct.toFixed(2)}%**

${header}
${body}
${totalRow}
${missing.length ? `\n> Missing coverage output for: ${missing.join(', ')} (run \`pnpm test\` for these packages).\n` : ''}`;

fs.writeFileSync(path.join(ROOT, 'COVERAGE.md'), md);

// ---- console + CI job summary ----
console.log(`Repo-wide line coverage: ${linesPct.toFixed(2)}%  (${totals.lines.covered}/${totals.lines.total} lines across ${rows.length} packages)`);
if (missing.length) console.log(`  note: no coverage-summary.json for ${missing.join(', ')}`);
console.log('  wrote .github/badges/coverage.svg and COVERAGE.md');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Coverage: ${linesPct.toFixed(2)}%\n\n${header}\n${body}\n${totalRow}\n`);
}
