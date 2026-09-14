/**
 * Offline scenario verifier.
 *
 * Drives the sans-I/O {@link Resolver} over every generated vector of a network
 * and compares the result with the expected `resolve/output.json` (the main
 * resolve and every `resolve/NN/` sub-vector). It fulfills the resolver data
 * needs the way a production caller does, but offline:
 *
 *   - NeedBeaconSignals    : a SYNTHETIC on-chain signal with the commitment the
 *                            anchor step broadcasts (the update hash of a solo
 *                            scenario, the cohort signal of a cohort member).
 *                            Update N sits in synthetic block N.
 *   - NeedGenesisDocument  } fulfilled from the publish manifest
 *   - NeedCASAnnouncement   } (lib/scenarios/<network>/publish-manifest.json),
 *   - NeedSignedUpdate      } keyed by the content hash the resolver asks for.
 *                            A missing object yields the DID Resolution error
 *                            that the api raises (NOT_FOUND for the genesis
 *                            document, MISSING_UPDATE_DATA for the rest).
 *
 * A `versionTime` form (`before:N`, `at:N`, `after:N`) resolves against the
 * synthetic block times. SMT proofs ride in the sidecar, so NeedSMTProof never
 * fires. A negative vector passes when the resolver raises the expected error
 * code.
 *
 * Run order: generate -> artifacts -> route -> verify.
 *
 * Usage:
 *   pnpm scenario:verify --network regtest
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolutionErrorCode } from '@did-btcr2/api';
import { canonicalHash, canonicalize } from '@did-btcr2/common';
import type { BeaconService, BeaconSignal, SignedBTCR2Update } from '@did-btcr2/method';
import { DidBtcr2 } from '@did-btcr2/method';

import {
  cohortsOutDir, findCohort, indexScenarioDirs, loadCohorts, loadRecipes, parseNetworkArg, publishManifestFile,
  readExpected, readJSON, readSignedUpdates, resolveCaseDir, resolveVersionTime,
  type CohortDef, type Expected, type FundingFile, type Scenario,
} from './_scenario-helpers.js';

const { network } = parseNetworkArg();

type ManifestItem = { hashHex: string; object: unknown };
type Outcome = { kind: 'ok'; didDocument: object; versionId: string; deactivated: boolean } | { kind: 'error'; error: string };

/** Manifest items keyed by the hex content hash the resolver Need carries. */
function loadManifest(): Map<string, unknown> {
  const byHex = new Map<string, unknown>();
  const path = publishManifestFile(network);
  if (!existsSync(path)) return byHex;
  for (const it of readJSON<{ items: ManifestItem[] }>(path).items) byHex.set(it.hashHex, it.object);
  return byHex;
}

/** Synthetic block metadata of update N: ten minutes per block, the header time one minute after the mediantime. */
const BASE_TIME = 1_700_000_000;
function syntheticBlock(n: number): BeaconSignal['blockMetadata'] {
  return { height: 100_000 + n, time: BASE_TIME + n * 600 + 60, mediantime: BASE_TIME + n * 600, confirmations: 6 };
}

function syntheticSignal(signalBytes: string, n: number): BeaconSignal {
  return { tx: {} as unknown as BeaconSignal['tx'], signalBytes, blockMetadata: syntheticBlock(n) };
}

/**
 * The signals per beacon fragment: a cohort member anchors the shared signal at
 * the cohort beacon (as update 1); a solo scenario anchors the hash of update N
 * at the beacon of update N.
 */
function buildSignalPlan(dir: string, recipe: Scenario, cohort: CohortDef | undefined): Map<string, BeaconSignal[]> {
  const plan = new Map<string, BeaconSignal[]>();
  if (cohort) {
    const signalHex = readJSON<{ signalHex: string }>(join(cohortsOutDir(network), `${cohort.id}.json`)).signalHex;
    plan.set(cohort.serviceId, [syntheticSignal(signalHex, 1)]);
    return plan;
  }
  const count = recipe.updates.length;
  if (count === 0) return plan;
  const funding = readJSON<FundingFile>(join(dir, 'funding.json'));
  const signed = readSignedUpdates(dir, count);
  for (const a of funding.anchors) {
    const fragment = a.beaconId.slice(a.beaconId.indexOf('#'));
    const hashHex = canonicalHash(signed[a.update - 1] as Record<string, unknown>, { encoding: 'hex' });
    (plan.get(fragment) ?? plan.set(fragment, []).get(fragment)!).push(syntheticSignal(hashHex, a.update));
  }
  return plan;
}

function resolveOffline(did: string, options: object, plan: Map<string, BeaconSignal[]>, manifest: Map<string, unknown>): Outcome {
  try {
    const resolver = DidBtcr2.resolve(did, options);
    let state = resolver.resolve();
    let guard = 0;
    while (state.status === 'action-required') {
      if (++guard > 40) return { kind: 'error', error: 'LOOP_GUARD' };
      for (const need of state.needs) {
        switch (need.kind) {
          case 'NeedBeaconSignals': {
            const map = new Map<BeaconService, BeaconSignal[]>();
            for (const svc of need.beaconServices) {
              const fragment = [...plan.keys()].find((f) => svc.id.endsWith(f));
              map.set(svc, fragment ? plan.get(fragment)! : []);
            }
            resolver.provide(need, map);
            break;
          }
          case 'NeedGenesisDocument': {
            const obj = manifest.get(need.genesisHash);
            if (!obj) return { kind: 'error', error: 'NOT_FOUND' };
            resolver.provide(need, obj as object);
            break;
          }
          case 'NeedCASAnnouncement': {
            const obj = manifest.get(need.announcementHash);
            if (!obj) return { kind: 'error', error: 'MISSING_UPDATE_DATA' };
            resolver.provide(need, obj as Record<string, string>);
            break;
          }
          case 'NeedSignedUpdate': {
            const obj = manifest.get(need.updateHash);
            if (!obj) return { kind: 'error', error: 'MISSING_UPDATE_DATA' };
            resolver.provide(need, obj as SignedBTCR2Update);
            break;
          }
          case 'NeedSMTProof':
            return { kind: 'error', error: 'UNEXPECTED_NEED_SMT_PROOF' };
        }
      }
      state = resolver.resolve();
    }
    return {
      kind        : 'ok',
      didDocument : state.result.didDocument,
      versionId   : state.result.metadata.versionId,
      deactivated : state.result.metadata.deactivated,
    };
  } catch (e) {
    return { kind: 'error', error: resolutionErrorCode(e) };
  }
}

/** Compare an outcome with an expectation. Returns `undefined` on a match, else the difference. */
export function compare(got: Outcome, want: Expected): string | undefined {
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

function describe(o: Outcome): string {
  return o.kind === 'ok' ? `v${o.versionId}${o.deactivated ? ' deactivated' : ''}` : `error ${o.error}`;
}

function run(): void {
  const recipes = loadRecipes(network);
  const idx = indexScenarioDirs(network);
  const manifest = loadManifest();
  const cohorts = loadCohorts(network);

  let pass = 0, fail = 0;
  console.log(`=== resolving ${idx.size} scenarios on ${network} (manifest: ${manifest.size} CAS objects) ===`);

  for (const id of [...recipes.keys()].sort()) {
    const dir = idx.get(id);
    if (!dir) continue;
    const recipe = recipes.get(id)!;
    const cohort = findCohort(id, cohorts);
    const tag = cohort ? `cohort:${cohort.id}` : (recipe.updates.length ? 'solo' : 'no-update');
    try {
      const plan = buildSignalPlan(dir, recipe, cohort);
      const input = readJSON<{ did: string; resolutionOptions: Record<string, unknown> }>(join(dir, 'resolve', 'input.json'));
      const cases: Array<{ label: string; options: Record<string, unknown>; expected: Expected }> = [
        { label: id, options: input.resolutionOptions, expected: readExpected(join(dir, 'resolve', 'output.json')) },
      ];
      for (const c of recipe.resolves ?? []) {
        const options: Record<string, unknown> = { ...input.resolutionOptions, ...c.options };
        if (typeof c.options.versionTime === 'string') {
          options.versionTime = resolveVersionTime(c.options.versionTime, (n) => syntheticBlock(n).mediantime);
        }
        cases.push({ label: `${id} resolve/${c.id}`, options, expected: readExpected(join(resolveCaseDir(dir, c.id), 'output.json')) });
      }
      for (const c of cases) {
        const got = resolveOffline(input.did, c.options, plan, manifest);
        const diff = compare(got, c.expected);
        console.log(`  ${diff ? 'FAIL' : 'PASS'} ${c.label.padEnd(52)} [${tag}]  ${diff ?? describe(got)}`);
        diff ? fail++ : pass++;
      }
    } catch (e) {
      console.log(`  FAIL ${id.padEnd(52)} [${tag}]  ${(e as Error).message}`);
      fail++;
    }
  }

  console.log(`\n=== verify PASS=${pass} FAIL=${fail} ===`);
  process.exit(fail ? 1 : 0);
}

run();
