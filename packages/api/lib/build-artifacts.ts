/**
 * Cohort artifact builder (pipeline step 2).
 *
 * Paired scenarios share ONE on-chain beacon signal. This step reads the
 * generated vectors of every cohort member (the DID and the signed update),
 * builds the shared aggregate artifact of each cohort, and writes the result
 * into the resolution sidecar of every member:
 *
 *   - CAS cohorts: one CAS Announcement Map { did -> updateHash } for all members.
 *     The OP_RETURN signal is SHA-256(canonicalize(announcement)).
 *   - SMT cohorts: one BTCR2MerkleTree with one leaf per member. The OP_RETURN
 *     signal is the tree root. Each member gets its own inclusion proof.
 *
 * Output per cohort: `lib/scenarios/<network>/cohorts/<id>.json` records the
 * anchor address, the signal, and the member artifacts for the anchor step.
 * The file lives next to the recipes, not in the data submodule, whose layout
 * is fixed.
 *
 * Determinism note: the signed updates change per build (random-aux signing),
 * so the signal recorded here is fixed for THIS build only. Do not run
 * generate-scenario again between this step and the anchor. The SMT nonce
 * derives from the cohort key and the DID, so this step is idempotent for fixed
 * signed updates.
 *
 * Usage:
 *   pnpm scenario:artifacts --network regtest            # all cohorts
 *   pnpm scenario:artifacts --network regtest cas-09     # one cohort
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { getNetwork } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalize, encode } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { SignedBTCR2Update } from '@did-btcr2/method';
import { blockHash, BTCR2MerkleTree, type SerializedSMTProof } from '@did-btcr2/smt';
import { hex } from '@scure/base';
import { p2wpkh } from '@scure/btc-signer';

import {
  cohortsOutDir, indexScenarioDirs, loadCohorts, loadRecipes, parseNetworkArg, readJSON, writeJSON,
  type CohortDef,
} from './_scenario-helpers.js';

const { network, rest } = parseNetworkArg();
const only = rest.find((a) => !a.startsWith('--'));

type Member = {
  scenarioId: string;
  dir: string;
  did: string;
  signedUpdate: SignedBTCR2Update;
  /** hex SHA-256 of the canonical signed update (the updateMap key and the SMT updateId). */
  updateId: string;
};

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
 * Set the cohort entry of a member sidecar in resolve/input.json. A member
 * belongs to one cohort, so the array holds one element: replace, not append,
 * so that a second run leaves no stale artifact.
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

function buildCasCohort(members: Member[]): { artifact: unknown; signalHex: string } {
  // CAS Announcement Map: { did -> base64urlnopad(updateHash) } for every member.
  const announcement: Record<string, string> = {};
  for (const m of members) announcement[m.did] = canonicalHash(m.signedUpdate);
  // The OP_RETURN signal is the hex SHA-256 of the canonical announcement (the casMap key).
  const signalHex = canonicalHash(announcement, { encoding: 'hex' });
  for (const m of members) setSidecar(m.dir, 'casUpdates', announcement);
  return { artifact: announcement, signalHex };
}

function buildSmtCohort(cohort: CohortDef, members: Member[]): { artifact: unknown; signalHex: string } {
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
    // Each member carries its own proof only (same root, distinct path).
    setSidecar(m.dir, 'smtProofs', proof);
  }
  return { artifact: { rootHex: signalHex, proofs }, signalHex };
}

function run(): void {
  const cohorts = loadCohorts(network).filter((c) => !only || c.id === only);
  if (cohorts.length === 0) {
    console.log(only ? `No cohort "${only}" on ${network}.` : `No cohorts on ${network}.`);
    return;
  }
  const recipes = loadRecipes(network);
  const idx = indexScenarioDirs(network);
  const outDir = cohortsOutDir(network);
  mkdirSync(outDir, { recursive: true });

  for (const cohort of cohorts) {
    // A cohort whose members are skipped recipes is skipped with them.
    if (cohort.members.some((id) => !recipes.has(id))) {
      console.log(`[cohort] ${cohort.id} skipped: a member recipe is skipped`);
      continue;
    }
    const members: Member[] = [];
    for (const id of cohort.members) {
      const dir = idx.get(id);
      if (!dir) throw new Error(`Cohort ${cohort.id}: member "${id}" not built. Run generate:scenario first.`);
      members.push(loadMember(id, dir));
    }

    const address = cohortAddress(cohort);
    const built = cohort.beaconType === 'CASBeacon' ? buildCasCohort(members) : buildSmtCohort(cohort, members);
    const outPath = join(outDir, `${cohort.id}.json`);
    writeJSON(outPath, {
      id            : cohort.id,
      beaconType    : cohort.beaconType,
      network       : cohort.network,
      serviceId     : cohort.serviceId,
      anchorAddress : address,
      signalHex     : built.signalHex,
      members       : members.map((m) => ({ scenarioId: m.scenarioId, did: m.did, updateId: m.updateId })),
      artifact      : built.artifact,
    });

    console.log(`[cohort] ${cohort.id} (${cohort.beaconType})`);
    console.log(`  anchor:  ${address}`);
    console.log(`  signal:  ${built.signalHex}`);
    for (const m of members) console.log(`    ${m.scenarioId}  updateId=${m.updateId.slice(0, 16)}...`);
    console.log(`  wrote ${outPath}`);
  }
  console.log(`\n  Next: pnpm scenario:route --network ${network}`);
}

run();
