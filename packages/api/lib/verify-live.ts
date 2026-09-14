/**
 * Live scenario verifier and recorder (pipeline step 7).
 *
 * Resolves every generated vector of a network through the api facade against
 * the live chain and the live CAS, the way a user of `@did-btcr2/api` does:
 * the beacon signals come from the Esplora indexer of the network, the
 * CAS-delivered objects from an IPFS gateway, the sidecar data from the vector
 * `resolve/input.json`. The result is compared with the expected
 * `resolve/output.json` (the main resolve and every `resolve/NN/` sub-vector).
 *
 * `--record` writes the raw DID Resolution result of the api into
 * `resolve/output.json` for every vector that PASSES, so the committed output
 * is what the api returns (`didResolutionMetadata`, `didDocument`,
 * `didDocumentMetadata` with `versionId`, `confirmations`, `updated`,
 * `deactivated`). A `versionTime` form (`before:N`, `at:N`, `after:N`) in a
 * sub-vector recipe resolves against the block `mediantime` of the anchor of
 * update N; `--record` writes the timestamp into the sub-vector input.
 *
 * Prerequisites: generate -> artifacts -> route -> publish (--publish) -> fund ->
 * anchor, with the anchors at `minConf` confirmations and the CAS objects pinned.
 *
 * Env:
 *   CAS_GATEWAY   IPFS gateway base (default: the api DEFAULT_CAS_GATEWAY)
 *
 * Usage:
 *   pnpm scenario:verify:live --network regtest
 *   pnpm scenario:verify:live --network regtest --record
 *   pnpm scenario:verify:live --network mutinynet --min-conf 1
 */

import { join } from 'node:path';

import { createApi, DEFAULT_CAS_GATEWAY, type DidBtcr2Api } from '@did-btcr2/api';
import { canonicalHash, canonicalize } from '@did-btcr2/common';
import { BeaconSignalDiscovery, DEFAULT_MIN_CONF, type BeaconService } from '@did-btcr2/method';

import { bitcoinConfigFor } from './_e2e-helpers.js';
import {
  cohortsOutDir, findCohort, indexScenarioDirs, isVersionTimeForm, loadCohorts, loadRecipes, parseNetworkArg,
  readExpected, readJSON, readSignedUpdates, resolveCaseDir, resolveVersionTime, takeOption, writeJSON,
  type CohortDef, type Expected, type FundingFile, type Scenario,
} from './_scenario-helpers.js';

const { network, rest } = parseNetworkArg();
const record = rest.includes('--record');
const minConfOpt = takeOption(rest, 'min-conf').value;
const minConf = minConfOpt === undefined ? DEFAULT_MIN_CONF : Number(minConfOpt);
if (!Number.isInteger(minConf) || minConf < 1) throw new Error(`--min-conf must be a positive integer, got "${minConfOpt}"`);
const gateway = (process.env.CAS_GATEWAY ?? DEFAULT_CAS_GATEWAY).replace(/\/+$/, '');

type Outcome = { kind: 'ok'; didDocument: object; versionId: string; deactivated: boolean } | { kind: 'error'; error: string };
type ResolveInput = { did: string; resolutionOptions: Record<string, unknown> };

function compare(got: Outcome, want: Expected): string | undefined {
  if (want.kind === 'error') {
    if (got.kind === 'error' && got.error === want.error) return undefined;
    return got.kind === 'error' ? `error ${got.error}, expected ${want.error}` : `resolved v${got.versionId}, expected error ${want.error}`;
  }
  if (got.kind === 'error') return `error ${got.error}, expected v${want.versionId}`;
  if (got.versionId !== want.versionId) return `versionId ${got.versionId}, expected ${want.versionId}`;
  if (got.deactivated !== want.deactivated) return `deactivated ${got.deactivated}, expected ${want.deactivated}`;
  if (canonicalize(got.didDocument) !== canonicalize(want.didDocument)) return `document differs (v${got.versionId})`;
  return undefined;
}

/**
 * The block `mediantime` of the anchor of update N, read from the chain: the
 * signal at the beacon of update N whose bytes are the hash of that update (solo),
 * or the cohort signal at the cohort beacon (cohort member).
 */
async function mediantimeReader(api: DidBtcr2Api, dir: string, recipe: Scenario, cohort: CohortDef | undefined): Promise<(n: number) => number> {
  const cache = new Map<number, number>();
  const funding = readJSON<FundingFile>(join(dir, 'funding.json'));
  const signed = readSignedUpdates(dir, recipe.updates.length);
  const lookups = new Map<number, { address: string; signalHex: string }>();
  if (cohort) {
    const cohortPath = join(cohortsOutDir(network), `${cohort.id}.json`);
    const { anchorAddress, signalHex } = readJSON<{ anchorAddress: string; signalHex: string }>(cohortPath);
    lookups.set(1, { address: anchorAddress, signalHex });
  } else {
    for (const a of funding.anchors) {
      lookups.set(a.update, { address: a.address, signalHex: canonicalHash(signed[a.update - 1] as Record<string, unknown>, { encoding: 'hex' }) });
    }
  }
  for (const [n, l] of lookups) {
    const service: BeaconService = { id: `#anchor-${n}`, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${l.address}` };
    const signals = (await BeaconSignalDiscovery.indexer([service], api.btc.connection)).get(service) ?? [];
    const hit = signals.find((s) => s.signalBytes === l.signalHex);
    if (hit) cache.set(n, hit.blockMetadata.mediantime);
  }
  return (n) => {
    const t = cache.get(n);
    if (t === undefined) throw new Error(`no confirmed anchor of update ${n} on the chain`);
    return t;
  };
}

async function resolveLive(api: DidBtcr2Api, did: string, options: Record<string, unknown>): Promise<{ outcome: Outcome; raw: unknown }> {
  const r = await api.tryResolveDid(did, { ...options, minConf });
  if (r.ok) {
    return {
      outcome : { kind: 'ok', didDocument: r.document, versionId: r.metadata?.versionId ?? '1', deactivated: r.metadata?.deactivated ?? false },
      raw     : r.raw,
    };
  }
  return { outcome: { kind: 'error', error: r.error }, raw: r.raw };
}

async function run(): Promise<void> {
  const api = createApi({ btc: bitcoinConfigFor(network), cas: { gateway, timeoutMs: 30_000 } });
  const recipes = loadRecipes(network);
  const idx = indexScenarioDirs(network);
  const cohorts = loadCohorts(network);
  console.log(`=== scenario:verify:live (${network}, minConf ${minConf}, CAS ${gateway})${record ? ' RECORD' : ''} ===`);

  let pass = 0, fail = 0;
  for (const id of [...recipes.keys()].sort()) {
    const dir = idx.get(id);
    if (!dir) continue;
    const recipe = recipes.get(id)!;
    const cohort = findCohort(id, cohorts);
    try {
      const mainPath = join(dir, 'resolve', 'input.json');
      const input = readJSON<ResolveInput>(mainPath);
      const cases: Array<{ label: string; inputPath: string; outputPath: string; options: Record<string, unknown>; inputOptions?: Record<string, unknown> }> = [
        { label: id, inputPath: mainPath, outputPath: join(dir, 'resolve', 'output.json'), options: input.resolutionOptions },
      ];
      const forms = (recipe.resolves ?? []).some((c) => isVersionTimeForm(c.options.versionTime));
      const mediantimeOf = forms ? await mediantimeReader(api, dir, recipe, cohort) : undefined;
      for (const c of recipe.resolves ?? []) {
        const caseDir = resolveCaseDir(dir, c.id);
        const options: Record<string, unknown> = { ...input.resolutionOptions, ...c.options };
        if (typeof c.options.versionTime === 'string') {
          options.versionTime = resolveVersionTime(c.options.versionTime, mediantimeOf ?? (() => { throw new Error('no mediantime reader'); }));
        }
        cases.push({ label: `${id} resolve/${c.id}`, inputPath: join(caseDir, 'input.json'), outputPath: join(caseDir, 'output.json'), options });
      }
      for (const c of cases) {
        const expected = readExpected(c.outputPath);
        const { outcome, raw } = await resolveLive(api, input.did, c.options);
        const diff = compare(outcome, expected);
        const detail = diff ?? (outcome.kind === 'ok' ? `v${outcome.versionId}${outcome.deactivated ? ' deactivated' : ''}` : `error ${outcome.error}`);
        console.log(`  ${diff ? 'FAIL' : 'PASS'} ${c.label.padEnd(52)} ${detail}`);
        if (diff) { fail++; continue; }
        pass++;
        if (record) {
          writeJSON(c.outputPath, raw);
          const current = readJSON<ResolveInput>(c.inputPath);
          const { minConf: _omit, ...committed } = c.options;
          void _omit;
          current.resolutionOptions = committed;
          writeJSON(c.inputPath, current);
        }
      }
    } catch (e) {
      console.log(`  FAIL ${id.padEnd(52)} ${(e as Error).message}`);
      fail++;
    }
  }
  api.dispose();
  console.log(`\n=== live verify PASS=${pass} FAIL=${fail}${record ? ' (outputs recorded)' : ''} ===`);
  if (record && fail === 0) console.log(`  Next: pnpm scenario:readme --network ${network}`);
  process.exit(fail ? 1 : 0);
}

await run();
