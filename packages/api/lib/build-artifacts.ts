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
 *     signal is the tree root. Each member gets its own proof.
 *
 * Output per cohort: `lib/scenarios/<network>/cohorts/<id>.json` records the
 * anchor address, the signal, and the member artifacts for the anchor step.
 * The file lives next to the recipes, not in the data submodule, whose layout
 * is fixed.
 *
 * An SMT member recipe can set `smt`: `nonce: false` builds the entry without a
 * nonce, and a member with no update and no nonce has no entry (the proof of an
 * empty index). `smt.proof` makes the proof in the sidecar invalid, or keeps it
 * out of the sidecar.
 *
 * Determinism note: the signed updates change per build (random-aux signing),
 * so the signal recorded here is fixed for THIS build only. Do not run
 * generate-scenario again between this step and the anchor. The SMT nonce
 * derives from the cohort key and the DID, so this step is idempotent for fixed
 * signed updates. The step keeps the `txid` of an anchored cohort. It stops if
 * the signal of an anchored cohort changes: a second anchor at the address
 * makes the DIDs of the members unresolvable.
 *
 * Usage:
 *   pnpm scenario:artifacts --network regtest            # all cohorts
 *   pnpm scenario:artifacts --network regtest cas-09     # one cohort
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { getNetwork } from '@did-btcr2/bitcoin';
import { canonicalHash, canonicalHashBytes, encode } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import type { SignedBTCR2Update } from '@did-btcr2/method';
import { blockHash, BTCR2MerkleTree, type SerializedSMTProof } from '@did-btcr2/smt';
import { base64urlnopad, hex } from '@scure/base';
import { p2wpkh } from '@scure/btc-signer';

import {
  cohortsOutDir, indexScenarioDirs, loadCohorts, loadRecipes, parseNetworkArg, readJSON, realUpdates, writeJSON,
  type CohortDef, type Scenario, type SmtMemberOptions,
} from './_scenario-helpers.js';

const { network, rest } = parseNetworkArg();
const only = rest.find((a) => !a.startsWith('--'));

type Member = {
  scenarioId: string;
  dir: string;
  did: string;
  /** The signed update, if the member has one. */
  signedUpdate?: SignedBTCR2Update;
  /** hex SHA-256 of the canonical signed update (the updateMap key and the SMT updateId). */
  updateId?: string;
  smt: SmtMemberOptions;
};

/** A cohort member has one update or none: the cohort anchors one signal. */
function loadMember(recipe: Scenario, dir: string): Member {
  const did = readJSON<{ did: string }>(join(dir, 'create', 'output.json')).did;
  const count = realUpdates(recipe).length;
  if (count > 1) throw new Error(`Cohort member ${recipe.id} has ${count} updates; a cohort signal announces one.`);
  const member: Member = { scenarioId: recipe.id, dir, did, smt: recipe.smt ?? {} };
  if (count === 1) {
    member.signedUpdate = readJSON<{ signedUpdate: SignedBTCR2Update }>(join(dir, 'update', 'output.json')).signedUpdate;
    member.updateId = canonicalHash(member.signedUpdate, { encoding: 'hex' });
  }
  return member;
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
 * so that a second run leaves no stale artifact. `undefined` removes the entry.
 */
function setSidecar(dir: string, key: 'casUpdates' | 'smtProofs', value: unknown): void {
  const path = join(dir, 'resolve', 'input.json');
  const input = readJSON<{ did: string; resolutionOptions: { sidecar?: Record<string, unknown[]> } }>(path);
  input.resolutionOptions.sidecar ??= {};
  if (value === undefined) delete input.resolutionOptions.sidecar[key];
  else input.resolutionOptions.sidecar[key] = [value];
  writeJSON(path, input);
}

/** Flip the lowest bit of the first byte of a base64url value: a different 32-byte value. */
function flipFirstBit(value: string): string {
  const bytes = base64urlnopad.decode(value);
  bytes[0] = bytes[0]! ^ 1;
  return base64urlnopad.encode(bytes);
}

/** The proof in the sidecar of a member: the proof of the tree, an invalid proof, or none. */
function sidecarProof(member: Member, proof: SerializedSMTProof): SerializedSMTProof | undefined {
  switch (member.smt.proof) {
    case undefined:
      return proof;
    case 'hash':
      if (proof.hashes.length === 0) throw new Error(`${member.scenarioId}: the proof has no hash to change`);
      return { ...proof, hashes: [flipFirstBit(proof.hashes[0]!), ...proof.hashes.slice(1)] };
    case 'id':
      return { ...proof, id: flipFirstBit(proof.id) };
    case 'withhold':
      return undefined;
  }
}

function cohortAddress(cohort: CohortDef): string {
  if (cohort.keys.source !== 'fixed') throw new Error(`Cohort ${cohort.id} has no fixed key.`);
  const kp = SchnorrKeyPair.fromSecret(hex.decode(cohort.keys.secretHex));
  return p2wpkh(kp.publicKey.compressed, getNetwork(cohort.network)).address!;
}

function buildCasCohort(members: Member[]): { artifact: unknown; signalHex: string } {
  // CAS Announcement Map: { did -> base64urlnopad(updateHash) } for every member.
  const announcement: Record<string, string> = {};
  for (const m of members) {
    if (!m.signedUpdate) throw new Error(`CAS cohort member ${m.scenarioId} has no update`);
    announcement[m.did] = canonicalHash(m.signedUpdate);
  }
  // The OP_RETURN signal is the hex SHA-256 of the canonical announcement (the casMap key).
  const signalHex = canonicalHash(announcement, { encoding: 'hex' });
  for (const m of members) setSidecar(m.dir, 'casUpdates', announcement);
  return { artifact: announcement, signalHex };
}

function buildSmtCohort(cohort: CohortDef, members: Member[]): { artifact: unknown; signalHex: string } {
  if (cohort.keys.source !== 'fixed') throw new Error(`Cohort ${cohort.id} has no fixed key.`);
  const tree = new BTCR2MerkleTree();
  for (const m of members) {
    const nonce = m.smt.nonce === false ? undefined : smtNonce(cohort.keys.secretHex, m.did);
    const updateId = m.signedUpdate ? canonicalHashBytes(m.signedUpdate) : undefined;
    // No nonce and no update: no entry. The member gets the proof of an empty index.
    if (!nonce && !updateId) continue;
    tree.addEntries([{ did: m.did, ...(nonce ? { nonce } : {}), ...(updateId ? { updateId } : {}) }]);
  }
  tree.finalize();
  const signalHex = encode(tree.rootHash, 'hex');

  const proofs: Record<string, SerializedSMTProof> = {};
  for (const m of members) {
    const proof = tree.proof(m.did);
    proofs[m.did] = proof;
    // Each member carries its own proof only (same root, distinct path).
    setSidecar(m.dir, 'smtProofs', sidecarProof(m, proof));
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
      members.push(loadMember(recipes.get(id)!, dir));
    }

    const address = cohortAddress(cohort);
    const outPath = join(outDir, `${cohort.id}.json`);
    // An anchored cohort keeps its txid. Its signal must not change.
    const previous = existsSync(outPath) ? readJSON<{ signalHex?: string; txid?: string }>(outPath) : undefined;
    const built = cohort.beaconType === 'CASBeacon' ? buildCasCohort(members) : buildSmtCohort(cohort, members);
    if (previous?.txid && previous.signalHex !== built.signalHex) {
      throw new Error(`Cohort ${cohort.id} is anchored (tx ${previous.txid}) with another signal. Restore the generated sets of its members, or roll the keys.`);
    }
    writeJSON(outPath, {
      id            : cohort.id,
      beaconType    : cohort.beaconType,
      network       : cohort.network,
      serviceId     : cohort.serviceId,
      anchorAddress : address,
      signalHex     : built.signalHex,
      members       : members.map((m) => ({ scenarioId: m.scenarioId, did: m.did, ...(m.updateId ? { updateId: m.updateId } : {}) })),
      artifact      : built.artifact,
      ...(previous?.txid ? { txid: previous.txid } : {}),
    });

    console.log(`[cohort] ${cohort.id} (${cohort.beaconType})${previous?.txid ? ` anchored tx=${previous.txid}` : ''}`);
    console.log(`  anchor:  ${address}`);
    console.log(`  signal:  ${built.signalHex}`);
    for (const m of members) {
      const flags = [m.smt.nonce === false && 'no nonce', m.smt.proof && `proof ${m.smt.proof}`].filter(Boolean).join(', ');
      console.log(`    ${m.scenarioId}  ${m.updateId ? `updateId=${m.updateId.slice(0, 16)}...` : 'no update'}${flags ? ` (${flags})` : ''}`);
    }
    console.log(`  wrote ${outPath}`);
  }
  console.log(`\n  Next: pnpm scenario:route --network ${network}`);
}

run();
