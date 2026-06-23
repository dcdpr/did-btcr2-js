/**
 * Cohort artifact builder (Batch C, step 1).
 *
 * Paired scenarios (09-12) share ONE on-chain beacon signal. This step reads the
 * already-generated per-member vectors (their signed updates + DIDs), builds the
 * shared aggregate artifact for each cohort, and wires the result back into every
 * member's resolution sidecar:
 *
 *   - CAS cohorts (09, 10): one CAS Announcement Map { did -> updateHash } covering
 *     both members. The OP_RETURN signal is SHA-256(canonicalize(announcement)).
 *   - SMT cohorts (11, 12): one BTCR2MerkleTree with one leaf per member. The
 *     OP_RETURN signal is the tree root. Each member gets its own inclusion proof.
 *
 * Output per cohort: `lib/scenarios/cohorts/<id>.json` records the anchor address,
 * the signal to broadcast, and the per-member artifact references (so the later
 * anchor step knows exactly what to put on-chain). This lives in the method
 * package, NOT the data submodule (whose {network}/{type}/{hash}/ layout is fixed).
 *
 * Delivery: this step writes every artifact into the resolution sidecar, making
 * each vector self-contained and resolvable offline (verifiable now, before any
 * IPFS publish). CAS-delivery routing (moving items to a publish queue per the
 * delivery matrix) is layered on top in a subsequent step.
 *
 * Determinism note: BIP340 signing is non-deterministic (random aux), so signed
 * updates (and therefore the CAS-map hash / SMT root anchored here) are fixed
 * only for THIS build. Do not re-run generate-scenario between this step and the
 * on-chain anchor, or the signal recorded in cohort.json will be stale. The SMT
 * nonce IS derived deterministically (from the cohort key + DID) so this step is
 * itself idempotent given fixed signed updates.
 *
 * Usage:
 *   bun lib/build-artifacts.ts            # all cohorts
 *   bun lib/build-artifacts.ts cas-09     # one cohort
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getNetwork } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalize, encode } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { blockHash, BTCR2MerkleTree, type SerializedSMTProof } from '@did-btcr2/smt';
import { hex } from '@scure/base';
import { p2wpkh } from '@scure/btc-signer';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const COHORTS_FILE = join(HERE, 'cohorts.json');

type CohortDef = {
  id: string;
  beaconType: 'CASBeacon' | 'SMTBeacon';
  addressType: 'P2WPKH';
  serviceId: string;
  network: 'regtest' | 'mutinynet';
  keys: { source: 'fixed'; secretHex: string } | { source: 'generate' };
  members: string[];
};

type Member = {
  scenarioId: string;
  dir: string;
  did: string;
  signedUpdate: SignedBTCR2Update;
  /** hex SHA-256 of the canonical signed update (== updateMap key == SMT updateId). */
  updateId: string;
};

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function writeJSON(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 4) + '\n');
}

/** Index every generated vector directory by its scenario id. */
function indexScenarioDirs(net: string): Map<string, string> {
  const idx = new Map<string, string>();
  const netDir = join(DATA_DIR, net);
  for (const type of ['k1', 'x1']) {
    const typeDir = join(netDir, type);
    if (!existsSync(typeDir)) continue;
    for (const h of readdirSync(typeDir)) {
      const scn = join(typeDir, h, 'scenario.json');
      if (existsSync(scn)) idx.set(readJSON<{ id: string }>(scn).id, join(typeDir, h));
    }
  }
  return idx;
}

function loadMember(scenarioId: string, dir: string): Member {
  const did = readJSON<{ did: string }>(join(dir, 'create', 'output.json')).did;
  const { signedUpdate } = readJSON<{ signedUpdate: SignedBTCR2Update }>(join(dir, 'update', 'output.json'));
  const updateId = canonicalHash(signedUpdate, { encoding: 'hex' });
  return { scenarioId, dir, did, signedUpdate, updateId };
}

/** Deterministic 32-byte SMT nonce: SHA-256(cohortSecret || utf8(did)). */
function smtNonce(cohortSecretHex: string, did: string): Uint8Array {
  const secret = hex.decode(cohortSecretHex);
  const didBytes = new TextEncoder().encode(did);
  const buf = new Uint8Array(secret.length + didBytes.length);
  buf.set(secret, 0);
  buf.set(didBytes, secret.length);
  return blockHash(buf);
}

/**
 * Set a member's cohort sidecar entry in resolve/input.json. Each member belongs
 * to exactly one cohort, so the CAS announcement / SMT proof array holds exactly
 * one element: we replace (not append) so re-running this step is idempotent and
 * never leaves a stale artifact behind.
 */
function setSidecar(dir: string, key: 'casUpdates' | 'smtProofs', value: unknown): void {
  const path = join(dir, 'resolve', 'input.json');
  const input = readJSON<{ did: string; resolutionOptions: { sidecar?: Record<string, unknown[]> } }>(path);
  input.resolutionOptions.sidecar ??= {};
  input.resolutionOptions.sidecar[key] = [value];
  writeJSON(path, input);
}

function cohortAddress(cohort: CohortDef): string {
  if (cohort.keys.source !== 'fixed') throw new Error(`Cohort ${cohort.id} has no fixed key.`);
  const kp = SchnorrKeyPair.fromSecret(hex.decode(cohort.keys.secretHex));
  return p2wpkh(kp.publicKey.compressed, getNetwork(cohort.network)).address!;
}

function buildCasCohort(cohort: CohortDef, members: Member[]): Record<string, unknown> {
  // CAS Announcement Map: { did -> base64urlnopad(updateHash) } for every member.
  const announcement: Record<string, string> = {};
  for (const m of members) announcement[m.did] = canonicalHash(m.signedUpdate);
  // The OP_RETURN signal is the hex SHA-256 of the canonical announcement (== casMap key).
  const signalHex = canonicalHash(announcement, { encoding: 'hex' });

  // Sidecar delivery: every member carries the shared announcement + its own update.
  for (const m of members) {
    setSidecar(m.dir, 'casUpdates', announcement);
  }

  return {
    artifact : announcement,
    signalHex,
    members  : members.map((m) => ({ scenarioId: m.scenarioId, did: m.did, updateId: m.updateId })),
  };
}

function buildSmtCohort(cohort: CohortDef, members: Member[]): Record<string, unknown> {
  if (cohort.keys.source !== 'fixed') throw new Error(`Cohort ${cohort.id} has no fixed key.`);
  const tree = new BTCR2MerkleTree();
  for (const m of members) {
    const nonce = smtNonce(cohort.keys.secretHex, m.did);
    const signedUpdateBytes = new TextEncoder().encode(canonicalize(m.signedUpdate));
    tree.addEntries([{ did: m.did, nonce, signedUpdate: signedUpdateBytes }]);
  }
  tree.finalize();
  const signalHex = encode(tree.rootHash, 'hex');

  const proofs: Record<string, SerializedSMTProof> = {};
  for (const m of members) {
    const proof = tree.proof(m.did);
    proofs[m.did] = proof;
    // Sidecar delivery: each member carries ONLY its own proof (same root id, distinct path).
    setSidecar(m.dir, 'smtProofs', proof);
  }

  return {
    artifact : { rootHex: signalHex, proofs },
    signalHex,
    members  : members.map((m) => ({ scenarioId: m.scenarioId, did: m.did, updateId: m.updateId })),
  };
}

function run(only?: string): void {
  const file = readJSON<{ cohorts: CohortDef[] }>(COHORTS_FILE);
  const cohorts = file.cohorts.filter((c) => !only || c.id === only);
  if (cohorts.length === 0) {
    console.error(only ? `No cohort "${only}" in cohorts.json` : 'No cohorts defined.');
    process.exit(1);
  }

  for (const cohort of cohorts) {
    const idx = indexScenarioDirs(cohort.network);
    const members: Member[] = [];
    for (const id of cohort.members) {
      const dir = idx.get(id);
      if (!dir) throw new Error(`Cohort ${cohort.id}: member "${id}" not built. Run generate-scenario first.`);
      members.push(loadMember(id, dir));
    }

    const address = cohortAddress(cohort);
    const built = cohort.beaconType === 'CASBeacon'
      ? buildCasCohort(cohort, members)
      : buildSmtCohort(cohort, members);

    const cohortOut = {
      id            : cohort.id,
      beaconType    : cohort.beaconType,
      network       : cohort.network,
      serviceId     : cohort.serviceId,
      anchorAddress : address,
      signalHex     : built.signalHex,
      members       : built.members,
      artifact      : built.artifact,
    };

    // Cohort artifacts live in the method package (NOT the data submodule, whose
    // strict {network}/{type}/{hash}/ layout is consumed by the test-suite repo).
    const outDir = join(HERE, 'scenarios', 'cohorts');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `${cohort.id}.json`);
    writeJSON(outPath, cohortOut);

    console.log(`[cohort] ${cohort.id} (${cohort.beaconType})`);
    console.log(`  anchor:  ${address}`);
    console.log(`  signal:  ${built.signalHex}`);
    for (const m of (built.members as Array<{ scenarioId: string; updateId: string }>)) {
      console.log(`    ${m.scenarioId}  updateId=${m.updateId.slice(0, 16)}...`);
    }
    console.log(`  wrote ${outPath}`);
  }
}

run(process.argv[2]);
