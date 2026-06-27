/**
 * CAS-delivery router (Batch C, step 2).
 *
 * The did:btcr2 spec lets a DID controller deliver the data a resolver needs
 * (genesis document, signed updates, CAS Announcement Map) either in the
 * resolution sidecar or out-of-band via a Content-Addressed Store (IPFS). This
 * step reads each scenario's declared delivery and, for every item marked `cas`:
 *
 *   1. moves it OUT of the vector's `resolve/input.json` sidecar, and
 *   2. records it in a single publish manifest (`lib/scenarios/publish-manifest.json`)
 *      keyed by its content hash.
 *
 * The content hash is exactly what the resolver will ask for at resolution time:
 * a `Need*` carries the hex canonical hash, and the IPFS CID is derived from the
 * same hash in base64url (see ADR 023). So a routed item is fetched from CAS by
 * the same address the resolver already computes - no extra index needed.
 *
 * Delivery is declared in the scenario recipe (lib/scenarios/<id>.json):
 *   - top-level `delivery.genesis`      : 'cas' | 'sidecar' (default sidecar; x1 only)
 *   - top-level `delivery.announcement` : 'cas' | 'sidecar' (default sidecar; CAS cohorts only)
 *   - per-update `delivery`             : 'cas' | 'smt' | 'sidecar'
 * SMT proofs are never routed to CAS by this step; they always ride in the sidecar.
 *
 * Idempotent: published objects are sourced from stable, never-trimmed files
 * (`other.json` genesis, `update[/NN]/output.json` signed updates, the cohort
 * artifact in `scenarios/cohorts/<id>.json`), and the sidecar is reassembled from
 * scratch each run. Re-running never double-trims or loses an artifact. This step
 * does NOT sign anything, so it never perturbs the anchored cohort signals - run
 * it after `build-artifacts`, before `anchor`.
 *
 * Usage:
 *   bun lib/route-delivery.ts            # all scenarios
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalHash } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '../src/core/btcr2-update.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const SCENARIOS_DIR = join(HERE, 'scenarios');
const COHORTS_DIR = join(SCENARIOS_DIR, 'cohorts');
const COHORTS_FILE = join(HERE, 'cohorts.json');
const MANIFEST_FILE = join(SCENARIOS_DIR, 'publish-manifest.json');

type Delivery = 'sidecar' | 'cas' | 'smt';
type ScenarioUpdate = { delivery: Delivery };
type Scenario = {
  id: string;
  network: 'regtest' | 'mutinynet';
  idType: 'KEY' | 'EXTERNAL';
  delivery?: { genesis?: 'cas' | 'sidecar'; announcement?: 'cas' | 'sidecar' };
  updates?: ScenarioUpdate[];
};
type CohortDef = { id: string; beaconType: 'CASBeacon' | 'SMTBeacon'; members: string[] };

type ManifestItem = {
  hashB64: string;
  hashHex: string;
  kind: 'genesis' | 'signedUpdate' | 'casAnnouncement';
  usedBy: Array<{ scenarioId: string; did: string }>;
  object: unknown;
};

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function writeJSON(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 4) + '\n');
}

/** Load every scenario recipe from lib/scenarios, keyed by scenario id. */
function loadRecipes(): Map<string, Scenario> {
  const recipes = new Map<string, Scenario>();
  for (const f of readdirSync(SCENARIOS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const recipe = readJSON<Scenario>(join(SCENARIOS_DIR, f));
    if (recipe?.id) recipes.set(recipe.id, recipe);
  }
  return recipes;
}

/** Index every generated vector directory by its scenario id. */
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

function findCohort(scenarioId: string, cohorts: CohortDef[]): CohortDef | undefined {
  return cohorts.find((c) => c.members.includes(scenarioId));
}

/** Read the signed update(s) for a scenario, in recipe order. */
function readSignedUpdates(dir: string, count: number): SignedBTCR2Update[] {
  if (count === 1) {
    return [readJSON<{ signedUpdate: SignedBTCR2Update }>(join(dir, 'update', 'output.json')).signedUpdate];
  }
  const out: SignedBTCR2Update[] = [];
  for (let i = 1; i <= count; i++) {
    const sub = String(i).padStart(2, '0');
    out.push(readJSON<{ signedUpdate: SignedBTCR2Update }>(join(dir, 'update', sub, 'output.json')).signedUpdate);
  }
  return out;
}

function run(): void {
  const net = 'mutinynet';
  const recipes = loadRecipes();
  const idx = indexScenarioDirs(net);
  const cohorts = readJSON<{ cohorts: CohortDef[] }>(COHORTS_FILE).cohorts;

  // Deduped by content hash: a shared CAS Announcement Map is published once and
  // referenced by every cohort member.
  const manifest = new Map<string, ManifestItem>();
  const add = (object: unknown, kind: ManifestItem['kind'], scenarioId: string, did: string): void => {
    const hashB64 = canonicalHash(object as Record<string, unknown>);
    const hashHex = canonicalHash(object as Record<string, unknown>, { encoding: 'hex' });
    const existing = manifest.get(hashB64);
    if (existing) {
      if (!existing.usedBy.some((u) => u.scenarioId === scenarioId)) existing.usedBy.push({ scenarioId, did });
      return;
    }
    manifest.set(hashB64, { hashB64, hashHex, kind, usedBy: [{ scenarioId, did }], object });
  };

  let routedScenarios = 0;

  for (const [id, dir] of idx) {
    const recipe = recipes.get(id);
    if (!recipe) continue;

    const inputPath = join(dir, 'resolve', 'input.json');
    const input = readJSON<{ did: string; resolutionOptions: { sidecar?: Record<string, unknown> } }>(inputPath);
    const did = readJSON<{ did: string }>(join(dir, 'create', 'output.json')).did;

    const genesisDelivery = recipe.delivery?.genesis ?? 'sidecar';
    const announcementDelivery = recipe.delivery?.announcement ?? 'sidecar';
    const updates = recipe.updates ?? [];

    // Reassemble the sidecar from scratch (idempotent). SMT proofs are preserved
    // verbatim; this step never touches them.
    const oldSidecar = input.resolutionOptions.sidecar ?? {};
    const sidecar: Record<string, unknown> = {};
    let routedThis = false;

    // GENESIS (x1 only)
    if (recipe.idType === 'EXTERNAL') {
      const genesis = readJSON<{ genesisDocument?: unknown }>(join(dir, 'other.json')).genesisDocument;
      if (genesisDelivery === 'cas' && genesis) {
        add(genesis, 'genesis', id, did);
        routedThis = true;
      } else if (genesis) {
        sidecar.genesisDocument = genesis;
      }
    }

    // SIGNED UPDATES
    if (updates.length > 0) {
      const signed = readSignedUpdates(dir, updates.length);
      const keep: SignedBTCR2Update[] = [];
      for (let i = 0; i < updates.length; i++) {
        if (updates[i]!.delivery === 'cas') {
          add(signed[i], 'signedUpdate', id, did);
          routedThis = true;
        } else {
          keep.push(signed[i]!);
        }
      }
      if (keep.length > 0) sidecar.updates = keep;
    }

    // CAS ANNOUNCEMENT (CAS cohorts only)
    const cohort = findCohort(id, cohorts);
    if (cohort?.beaconType === 'CASBeacon') {
      const announcement = readJSON<{ artifact: Record<string, string> }>(join(COHORTS_DIR, `${cohort.id}.json`)).artifact;
      if (announcementDelivery === 'cas') {
        add(announcement, 'casAnnouncement', id, did);
        routedThis = true;
      } else {
        sidecar.casUpdates = [announcement];
      }
    }

    // SMT PROOFS - preserved exactly as build-artifacts wrote them.
    if (oldSidecar.smtProofs) sidecar.smtProofs = oldSidecar.smtProofs;

    // Write back the trimmed sidecar.
    if (Object.keys(sidecar).length > 0) {
      input.resolutionOptions.sidecar = sidecar;
    } else {
      delete input.resolutionOptions.sidecar;
    }
    writeJSON(inputPath, input);

    // Keep the committed scenario.json copy in sync with the source recipe so the
    // vector stays self-describing (delivery declarations included).
    writeJSON(join(dir, 'scenario.json'), recipe);

    if (routedThis) {
      routedScenarios++;
      console.log(`[route] ${id}  genesis=${genesisDelivery} announcement=${announcementDelivery} updates=[${updates.map((u) => u.delivery).join(',')}]`);
    }
  }

  const items = [...manifest.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.hashB64.localeCompare(b.hashB64));
  writeJSON(MANIFEST_FILE, {
    note    : 'Objects to publish to a CAS (IPFS). Keyed by content hash: hashB64 is the CID source (base64url no-pad SHA-256), hashHex is the resolver Need hash / sidecar map key. Deduped: shared announcements are published once.',
    network : net,
    items,
  });

  const byKind = items.reduce<Record<string, number>>((acc, it) => ((acc[it.kind] = (acc[it.kind] ?? 0) + 1), acc), {});
  console.log(`\n[route] ${routedScenarios} scenarios routed to CAS; manifest has ${items.length} unique objects ${JSON.stringify(byKind)}`);
  console.log(`  wrote ${MANIFEST_FILE}`);
}

run();
