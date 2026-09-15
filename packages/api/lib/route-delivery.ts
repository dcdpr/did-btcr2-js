/**
 * CAS-delivery router (pipeline step 3).
 *
 * A DID controller delivers the data a resolver needs (the genesis document,
 * the signed updates, the CAS Announcement Map) in the resolution sidecar or
 * out of band through a Content-Addressed Store (IPFS). This step reads the
 * declared delivery of each scenario and, for every item marked `cas`:
 *
 *   1. moves it OUT of the sidecar of `resolve/input.json` (and of every
 *      resolve sub-vector), and
 *   2. records it in one publish manifest
 *      (`lib/scenarios/<network>/publish-manifest.json`) keyed by content hash.
 *
 * The content hash is what the resolver asks for at resolution time: a `Need*`
 * carries the hex canonical hash, and the IPFS CID derives from the same hash
 * (ADR 023). A withheld update goes to neither the sidecar nor the manifest.
 *
 * Delivery is declared in the recipe:
 *   - top-level `delivery.genesis`      : 'cas' | 'sidecar' (default sidecar; x1 only)
 *   - top-level `delivery.announcement` : 'cas' | 'sidecar' (default sidecar; CAS cohorts only)
 *   - per-update `delivery`             : 'cas' | 'smt' | 'sidecar'
 * SMT proofs always ride in the sidecar.
 *
 * Idempotent: the published objects come from stable files (`other.json`, the
 * update outputs, the cohort artifact), and the sidecar is built again from
 * scratch each run. This step signs nothing, so the anchored signals stay as
 * they are. Run it after `scenario:artifacts`, before `scenario:anchor`.
 *
 * Usage:
 *   pnpm scenario:route --network regtest
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalHash } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/method';

import {
  cohortsOutDir, findCohort, indexScenarioDirs, loadCohorts, loadRecipes, parseNetworkArg, publishManifestFile,
  readJSON, readSignedUpdates, realUpdates, writeJSON,
} from './_scenario-helpers.js';

const { network } = parseNetworkArg();

type ManifestItem = {
  hashB64: string;
  hashHex: string;
  kind: 'genesis' | 'signedUpdate' | 'casAnnouncement';
  usedBy: Array<{ scenarioId: string; did: string }>;
  object: unknown;
};

type ResolveInput = { did: string; resolutionOptions: Record<string, unknown> & { sidecar?: Record<string, unknown> } };

function run(): void {
  const recipes = loadRecipes(network);
  const idx = indexScenarioDirs(network);
  const cohorts = loadCohorts(network);

  // Deduped by content hash: a shared CAS Announcement Map is published once.
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
    const input = readJSON<ResolveInput>(inputPath);
    const did = readJSON<{ did: string }>(join(dir, 'create', 'output.json')).did;
    const genesisDelivery = recipe.delivery?.genesis ?? 'sidecar';
    const announcementDelivery = recipe.delivery?.announcement ?? 'sidecar';
    const updates = realUpdates(recipe);

    // Build the sidecar again from scratch. SMT proofs stay as build-artifacts wrote them.
    const oldSidecar = input.resolutionOptions.sidecar ?? {};
    const sidecar: Record<string, unknown> = {};
    let routedThis = false;

    if (recipe.idType === 'EXTERNAL') {
      const genesis = readJSON<{ genesisDocument?: unknown }>(join(dir, 'other.json')).genesisDocument;
      if (genesisDelivery === 'cas' && genesis) {
        add(genesis, 'genesis', id, did);
        routedThis = true;
      } else if (genesis) {
        sidecar.genesisDocument = genesis;
      }
    }

    if (updates.length > 0) {
      const signed = readSignedUpdates(dir, updates.length);
      const keep: SignedBTCR2Update[] = [];
      for (let i = 0; i < updates.length; i++) {
        const u = updates[i]!;
        if (u.withhold) continue;
        if (u.delivery === 'cas') {
          add(signed[i], 'signedUpdate', id, did);
          routedThis = true;
        } else {
          keep.push(signed[i]!);
        }
      }
      if (keep.length > 0) sidecar.updates = keep;
    }

    const cohort = findCohort(id, cohorts);
    if (cohort?.beaconType === 'CASBeacon') {
      const announcement = readJSON<{ artifact: Record<string, string> }>(join(cohortsOutDir(network), `${cohort.id}.json`)).artifact;
      if (announcementDelivery === 'cas') {
        add(announcement, 'casAnnouncement', id, did);
        routedThis = true;
      } else {
        sidecar.casUpdates = [announcement];
      }
    }

    if (oldSidecar.smtProofs) sidecar.smtProofs = oldSidecar.smtProofs;

    const setSidecar = (options: ResolveInput['resolutionOptions']): void => {
      if (Object.keys(sidecar).length > 0) options.sidecar = sidecar;
      else delete options.sidecar;
    };
    setSidecar(input.resolutionOptions);
    writeJSON(inputPath, input);

    // The sub-vectors carry the same sidecar with their own options.
    const resolveDir = join(dir, 'resolve');
    for (const sub of readdirSync(resolveDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const subPath = join(resolveDir, sub.name, 'input.json');
      if (!existsSync(subPath)) continue;
      const subInput = readJSON<ResolveInput>(subPath);
      setSidecar(subInput.resolutionOptions);
      writeJSON(subPath, subInput);
    }

    if (routedThis) {
      routedScenarios++;
      console.log(`[route] ${id}  genesis=${genesisDelivery} announcement=${announcementDelivery} updates=[${updates.map((u) => u.withhold ? 'withheld' : u.delivery).join(',')}]`);
    }
  }

  const items = [...manifest.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.hashB64.localeCompare(b.hashB64));
  const manifestPath = publishManifestFile(network);
  writeJSON(manifestPath, {
    note : 'Objects to publish to a CAS (IPFS). Keyed by content hash: hashB64 is the CID source (base64url no-pad SHA-256), hashHex is the resolver Need hash / sidecar map key. Deduped: shared announcements are published once.',
    network,
    items,
  });

  const byKind = items.reduce<Record<string, number>>((acc, it) => ((acc[it.kind] = (acc[it.kind] ?? 0) + 1), acc), {});
  console.log(`\n[route] ${routedScenarios} scenarios routed to CAS; manifest has ${items.length} unique objects ${JSON.stringify(byKind)}`);
  console.log(`  wrote ${manifestPath}`);
  console.log(`  Next: pnpm scenario:verify --network ${network}`);
}

run();
