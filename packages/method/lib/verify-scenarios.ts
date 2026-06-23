/**
 * Offline scenario verifier.
 *
 * Drives the real {@link Resolver} state machine over every generated vector's
 * `resolve/input.json` and diffs the resolved document against the vector's
 * expected `resolve/output.json`. It fulfills the resolver's data needs the same
 * way a production caller would, but entirely offline:
 *
 *   - NeedBeaconSignals    : a SYNTHETIC on-chain signal carrying the commitment
 *                            the anchor step will broadcast (the update hash for a
 *                            singleton beacon, or the cohort signal for an
 *                            aggregate beacon). Multi-update singleton scenarios
 *                            get one signal per update at the same address.
 *   - NeedGenesisDocument  } fulfilled from the CAS publish manifest
 *   - NeedCASAnnouncement   } (lib/scenarios/publish-manifest.json), keyed by the
 *   - NeedSignedUpdate      } content hash the resolver asks for. This is exactly
 *                            what a real resolver does after fetching from IPFS.
 *
 * Proving the routed (CAS-delivered) vectors resolve here - before spending sats
 * to anchor or bytes to publish - is the offline core of the later
 * `scenario:verify` (which will additionally confirm against the live chain + the
 * real CAS). SMT proofs always ride in the sidecar, so NeedSMTProof never fires.
 *
 * Run order: build-artifacts -> route-delivery -> verify.
 *
 * Usage: bun lib/verify-scenarios.ts
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalHash, canonicalize } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { DidBtcr2 } from '../src/did-btcr2.js';
import type { BeaconService, BeaconSignal } from '../src/core/beacon/interfaces.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const SCENARIOS_DIR = join(HERE, 'scenarios');
const COHORTS_DIR = join(SCENARIOS_DIR, 'cohorts');
const COHORTS_FILE = join(HERE, 'cohorts.json');
const MANIFEST_FILE = join(SCENARIOS_DIR, 'publish-manifest.json');

type ScenarioUpdate = { delivery: 'sidecar' | 'cas' | 'smt'; beaconId: string };
type Scenario = { id: string; idType: 'KEY' | 'EXTERNAL'; updates?: ScenarioUpdate[] };
type CohortDef = { id: string; serviceId: string; members: string[] };
type ManifestItem = { hashHex: string; object: unknown };

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function loadRecipes(): Map<string, Scenario> {
  const recipes = new Map<string, Scenario>();
  for (const f of readdirSync(SCENARIOS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const recipe = readJSON<Scenario>(join(SCENARIOS_DIR, f));
    if (recipe?.id) recipes.set(recipe.id, recipe);
  }
  return recipes;
}

function indexScenarioDirs(net: string): Map<string, string> {
  const idx = new Map<string, string>();
  for (const type of ['k1', 'x1']) {
    const typeDir = join(DATA_DIR, net, type);
    if (!existsSync(typeDir)) continue;
    for (const h of readdirSync(typeDir)) {
      const scn = join(typeDir, h, 'scenario.json');
      if (existsSync(scn)) idx.set(readJSON<{ id: string }>(scn).id, join(typeDir, h));
    }
  }
  return idx;
}

/** Manifest items keyed by the hex content hash the resolver Need carries. */
function loadManifest(): Map<string, unknown> {
  const byHex = new Map<string, unknown>();
  if (!existsSync(MANIFEST_FILE)) return byHex;
  for (const it of readJSON<{ items: ManifestItem[] }>(MANIFEST_FILE).items) byHex.set(it.hashHex, it.object);
  return byHex;
}

function readSignedUpdates(dir: string, count: number): SignedBTCR2Update[] {
  if (count === 1) return [readJSON<{ signedUpdate: SignedBTCR2Update }>(join(dir, 'update', 'output.json')).signedUpdate];
  const out: SignedBTCR2Update[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(readJSON<{ signedUpdate: SignedBTCR2Update }>(join(dir, 'update', String(i).padStart(2, '0'), 'output.json')).signedUpdate);
  }
  return out;
}

const SIGNAL = (signalBytes: string, height: number): BeaconSignal => ({
  tx            : {} as unknown as BeaconSignal['tx'],
  signalBytes,
  blockMetadata : { height, time: 1_700_000_000 + height, confirmations: 6 },
});

/**
 * Map each beacon fragment to the ordered list of signal payloads (hex) anchored
 * at that address. Cohort members anchor one shared signal at #cohortBeacon;
 * solo scenarios anchor one update-hash signal per update at its beacon.
 */
function buildSignalPlan(
  id: string,
  dir: string,
  recipe: Scenario,
  cohort: CohortDef | undefined,
): Map<string, string[]> {
  const plan = new Map<string, string[]>();
  if (cohort) {
    const signalHex = readJSON<{ signalHex: string }>(join(COHORTS_DIR, `${cohort.id}.json`)).signalHex;
    plan.set(cohort.serviceId, [signalHex]);
    return plan;
  }
  const updates = recipe.updates ?? [];
  if (updates.length === 0) return plan;
  const signed = readSignedUpdates(dir, updates.length);
  for (let i = 0; i < updates.length; i++) {
    const fragment = '#' + updates[i]!.beaconId.split('#')[1];
    const hashHex = canonicalHash(signed[i] as Record<string, unknown>, { encoding: 'hex' });
    (plan.get(fragment) ?? plan.set(fragment, []).get(fragment)!).push(hashHex);
  }
  return plan;
}

function verifyScenario(
  dir: string,
  recipe: Scenario,
  plan: Map<string, string[]>,
  manifest: Map<string, unknown>,
): { ok: boolean; detail: string } {
  const did = readJSON<{ did: string }>(join(dir, 'create', 'output.json')).did;
  const input = readJSON<{ resolutionOptions: object }>(join(dir, 'resolve', 'input.json'));
  const expected = readJSON<{ didDocument: object }>(join(dir, 'resolve', 'output.json')).didDocument;

  const fromManifest = (hashHex: string, kind: string): object | null => {
    const obj = manifest.get(hashHex);
    if (!obj) return null;
    void kind;
    return obj as object;
  };

  const resolver = DidBtcr2.resolve(did, input.resolutionOptions);
  let state = resolver.resolve();
  let guard = 0;
  while (state.status === 'action-required') {
    if (++guard > 40) return { ok: false, detail: 'resolver did not converge (loop guard)' };
    for (const need of state.needs) {
      switch (need.kind) {
        case 'NeedBeaconSignals': {
          const map = new Map<BeaconService, BeaconSignal[]>();
          for (const svc of need.beaconServices) {
            const fragment = [...plan.keys()].find((f) => svc.id.endsWith(f));
            const signals = fragment ? plan.get(fragment)!.map((sb, i) => SIGNAL(sb, 100_000 + i)) : [];
            map.set(svc, signals);
          }
          resolver.provide(need, map);
          break;
        }
        case 'NeedGenesisDocument': {
          const obj = fromManifest(need.genesisHash, 'genesis');
          if (!obj) return { ok: false, detail: `genesis not in manifest (hash ${need.genesisHash.slice(0, 12)})` };
          resolver.provide(need, obj);
          break;
        }
        case 'NeedCASAnnouncement': {
          const obj = fromManifest(need.announcementHash, 'casAnnouncement');
          if (!obj) return { ok: false, detail: `CAS announcement not in manifest (hash ${need.announcementHash.slice(0, 12)})` };
          resolver.provide(need, obj as Record<string, string>);
          break;
        }
        case 'NeedSignedUpdate': {
          const obj = fromManifest(need.updateHash, 'signedUpdate');
          if (!obj) return { ok: false, detail: `signed update not in manifest (hash ${need.updateHash.slice(0, 12)})` };
          resolver.provide(need, obj as SignedBTCR2Update);
          break;
        }
        case 'NeedSMTProof':
          return { ok: false, detail: `unexpected NeedSMTProof - proofs must ride in the sidecar` };
      }
    }
    state = resolver.resolve();
  }

  const got = canonicalize(state.result.didDocument);
  const want = canonicalize(expected);
  if (got !== want) {
    return { ok: false, detail: `resolved document != expected (versionId=${state.result.metadata.versionId})` };
  }
  return { ok: true, detail: `versionId=${state.result.metadata.versionId} deactivated=${state.result.metadata.deactivated ?? false}` };
}

function run(): void {
  const net = 'mutinynet';
  const recipes = loadRecipes();
  const idx = indexScenarioDirs(net);
  const manifest = loadManifest();
  const cohorts = readJSON<{ cohorts: CohortDef[] }>(COHORTS_FILE).cohorts;
  const cohortFor = (id: string): CohortDef | undefined => cohorts.find((c) => c.members.includes(id));

  let pass = 0, fail = 0;
  console.log(`=== resolving ${idx.size} scenarios (manifest: ${manifest.size} CAS objects) ===`);

  for (const id of [...recipes.keys()].sort()) {
    const dir = idx.get(id);
    if (!dir) continue; // recipe with no generated vector yet
    const recipe = recipes.get(id)!;
    const cohort = cohortFor(id);
    const plan = buildSignalPlan(id, dir, recipe, cohort);
    const r = verifyScenario(dir, recipe, plan, manifest);
    const tag = cohort ? `cohort:${cohort.id}` : (recipe.updates?.length ? 'solo' : 'no-update');
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${id.padEnd(42)} [${tag}]  ${r.detail}`);
    r.ok ? pass++ : fail++;
  }

  console.log(`\n=== verify PASS=${pass} FAIL=${fail} ===`);
  process.exit(fail ? 1 : 0);
}

run();
