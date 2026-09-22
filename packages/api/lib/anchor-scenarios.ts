/**
 * Scenario anchorer (pipeline step 6).
 *
 * Broadcasts the on-chain OP_RETURN beacon signals of every update-bearing
 * scenario, spending the UTXOs that `scenario:fund` placed:
 *
 *   - Cohort beacons: ONE OP_RETURN per cohort with the shared signal from
 *     `lib/scenarios/<network>/cohorts/<id>.json` (the CAS announcement hash or
 *     the SMT root), signed by the cohort aggregator key.
 *   - Solo beacons: one OP_RETURN per anchor at the beacon the entry names
 *     (P2PKH, P2WPKH, or P2TR), with the hash of the signed update, signed by
 *     the key of the address (the genesis key or an extra key from `other.json`).
 *     A duplicate entry anchors the hash of an earlier update again. Anchors at
 *     one address chain the change UTXO.
 *
 * One round per command. Round k broadcasts the k-th anchor of every scenario,
 * or the anchor that the recipe puts in round k. The cohort anchors are round 1. The txid of each broadcast anchor goes into
 * the state file of the scenario (`state/<id>.json`) or into the cohort
 * artifact. A second run skips an anchor that has a txid.
 *
 * Before it broadcasts round k, the script reads the indexer one time. It stops
 * if an anchor of round k-1 is not confirmed: the anchors of one scenario must
 * sit in different blocks, with a rising block `mediantime`, for the
 * `versionTime` forms. At round 1 it stops if an address already carries a
 * Beacon Signal. Run the command again after the next block, until it reports
 * that every anchor is broadcast. No script mines a block. On regtest the
 * auto-miner of the Polar network confirms each round.
 *
 * Determinism note: the signals are fixed for the current build only. Run
 * generate, artifacts, route, publish, fund, and anchor as one pass. Do not
 * generate again between artifacts and anchor.
 *
 * Usage:
 *   pnpm scenario:anchor --network regtest            # the next round
 *   pnpm scenario:anchor --network mutinynet --dry     # list the rounds and the readiness, no broadcast
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalHash } from '@did-btcr2/common';
import { BeaconSignalDiscovery, type BeaconService } from '@did-btcr2/method';

import { bitcoinFor } from './_e2e-helpers.js';
import {
  anchorRound, cohortsOutDir, indexScenarioDirs, loadCohorts, loadRecipes, parseNetworkArg, readJSON, readSignedUpdates,
  readState, realUpdates, writeJSON, writeState,
  type AddrType, type OtherFile,
} from './_scenario-helpers.js';
import { anchorSignal, explorerHint } from './wallet/tx-builder.js';

const { network, rest } = parseNetworkArg();
const dry = rest.includes('--dry');

type Anchor = {
  label: string;
  /** The round that broadcasts the anchor: the round of the recipe, else its position in the scenario, or 1 for a cohort. */
  round: number;
  address: string;
  secretHex: string;
  signalHex: string;
  kind: AddrType;
  /** Set once the anchor is broadcast. */
  txid?: string;
  /** Write the txid into the state the anchor came from. */
  record: (txid: string) => void;
};

type CohortArtifact = { anchorAddress: string; signalHex: string; txid?: string } & Record<string, unknown>;

/** Every anchor of the network in round order: the cohort signals, then the solo anchors of each scenario. */
function collectAnchors(): Anchor[] {
  const anchors: Anchor[] = [];

  for (const cohort of loadCohorts(network)) {
    if (cohort.keys.source !== 'fixed') continue;
    const cohortPath = join(cohortsOutDir(network), `${cohort.id}.json`);
    if (!existsSync(cohortPath)) continue;
    const artifact = readJSON<CohortArtifact>(cohortPath);
    anchors.push({
      label     : cohort.id,
      round     : 1,
      address   : artifact.anchorAddress,
      secretHex : cohort.keys.secretHex,
      signalHex : artifact.signalHex,
      kind      : 'p2wpkh',
      txid      : artifact.txid,
      record    : (txid) => writeJSON(cohortPath, { ...artifact, txid }),
    });
  }

  const recipes = loadRecipes(network);
  for (const [id, dir] of indexScenarioDirs(network)) {
    const recipe = recipes.get(id);
    const state = readState(network, id);
    if (!recipe || !state || state.anchors.length === 0) continue;
    const other = readJSON<OtherFile>(join(dir, 'other.json'));
    const updates = readSignedUpdates(dir, realUpdates(recipe).length);
    state.anchors.forEach((a, i) => {
      const secretHex = a.key === 'genesis' ? other.genesisKeys.secret : other.extraKeys?.[a.key]?.secret;
      if (!secretHex) throw new Error(`${state.scenarioId}: no secret for key "${a.key}" in other.json`);
      const update = updates[a.signalOf - 1];
      if (!update) throw new Error(`${state.scenarioId}: update ${a.signalOf} not found`);
      const again = a.duplicateOf ? ` (update ${a.duplicateOf} again)` : '';
      anchors.push({
        label     : `${state.scenarioId} entry ${a.update}/${recipe.updates.length}${again} @${a.beaconId.slice(a.beaconId.indexOf('#'))}`,
        round     : anchorRound(a, i),
        address   : a.address,
        secretHex,
        signalHex : canonicalHash(update as Record<string, unknown>, { encoding: 'hex' }),
        kind      : a.kind,
        txid      : a.txid,
        record    : (txid) => { a.txid = txid; writeState(state); },
      });
    });
  }
  return anchors.sort((x, y) => x.round - y.round);
}

/**
 * The reasons that hold round `round` back. The function reads the indexer one
 * time. For round 2 and later, it lists each anchor of the previous round that
 * is not confirmed. For round 1, it lists each address that already carries a
 * Beacon Signal, because a signal of an earlier pass makes the DID
 * unresolvable. The list is empty when the round is ready.
 * @throws {Error} if the indexer is not reachable.
 */
async function blockers(anchors: Anchor[], round: number): Promise<string[]> {
  const btc = bitcoinFor(network);
  await btc.rest.block.count().catch((e: Error) => {
    throw new Error(`cannot read the indexer of ${network}: ${e.message}`);
  });
  const out: string[] = [];
  if (round === 1) {
    const addresses = [...new Set(anchors.filter((a) => a.round === 1 && !a.txid).map((a) => a.address))];
    const services = addresses.map((address, i): BeaconService => ({ id: `#anchor-${i}`, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${address}` }));
    const found = await BeaconSignalDiscovery.indexer(services, btc);
    for (const [service, signals] of found) {
      if (signals.length === 0) continue;
      const address = String(service.serviceEndpoint).slice('bitcoin:'.length);
      out.push(`${address} already carries ${signals.length} Beacon Signal(s): roll the keys (pnpm scenario:keys --network ${network} --force) or use a fresh chain`);
    }
    return out;
  }
  for (const a of anchors.filter((x) => x.round === round - 1)) {
    if (!a.txid) { out.push(`${a.label}: not broadcast`); continue; }
    const tx = await btc.rest.transaction.get(a.txid).catch(() => undefined);  // 404 for a transaction the indexer does not know
    if (tx?.status.confirmed !== true) out.push(`${a.label}: tx ${a.txid} is not confirmed`);
  }
  return out;
}

async function run(): Promise<void> {
  const anchors = collectAnchors();
  const rounds = anchors.reduce((m, a) => Math.max(m, a.round), 0);
  const pending = anchors.filter((a) => !a.txid);
  const round = pending.reduce((m, a) => Math.min(m, a.round), rounds);
  console.log(`=== scenario:anchor (${network}): ${anchors.length} OP_RETURN signals in ${rounds} round(s), ${anchors.length - pending.length} broadcast ===`);

  if (dry) {
    for (const a of anchors) console.log(`  round ${a.round}  ${(a.txid ?? 'pending').padEnd(64)}  ${a.kind.padEnd(6)} [${a.label}]`);
    if (pending.length === 0) {
      console.log('\n  --dry: every anchor is broadcast.');
      return;
    }
    const problems = await blockers(anchors, round);
    console.log(problems.length ? `\n  --dry: round ${round} of ${rounds} is not ready:` : `\n  --dry: round ${round} of ${rounds} is ready. Nothing broadcast.`);
    for (const p of problems) console.log(`    ${p}`);
    return;
  }

  if (pending.length === 0) {
    console.log(`  Every anchor is broadcast (${rounds} round(s)). After six confirmations, run: pnpm scenario:verify:live --network ${network} --record`);
    return;
  }

  const problems = await blockers(anchors, round);
  if (problems.length > 0) {
    console.log(`  round ${round} of ${rounds} is not ready:`);
    for (const p of problems) console.log(`    ${p}`);
    if (round > 1) console.log('  Run the command again after the next block.');
    process.exit(1);
  }

  const batch = pending.filter((a) => a.round === round);
  console.log(`  round ${round} of ${rounds}: ${batch.length} anchor(s)`);
  let ok = 0, fail = 0;
  for (const a of batch) {
    try {
      const r = await anchorSignal({ secretHex: a.secretHex, signalHex: a.signalHex, network, kind: a.kind });
      a.record(r.txid);
      console.log(`  OK  ${a.label}  tx=${r.txid} (fee ${r.feeSats})  @${r.address}`);
      ok++;
    } catch (e) {
      console.log(`  ERR ${a.label}  ${(e as Error).message}`);
      fail++;
    }
  }
  if (network !== 'regtest' && ok > 0) console.log(`  explorer: ${explorerHint(network, '<txid>')}`);
  console.log(`\n=== round ${round} of ${rounds}: broadcast ${ok}/${batch.length} (${fail} failed) ===`);
  if (fail > 0) {
    console.log('  Run the command again to broadcast the failed anchors of this round.');
  } else if (round < rounds) {
    console.log(`  After the next block, run again: pnpm scenario:anchor --network ${network}  (round ${round + 1} of ${rounds})`);
  } else {
    console.log(`  Every anchor is broadcast. After six confirmations, run: pnpm scenario:verify:live --network ${network} --record`);
  }
  process.exit(fail ? 1 : 0);
}

await run();
