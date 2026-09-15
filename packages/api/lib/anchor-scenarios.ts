/**
 * Scenario anchorer (pipeline step 6).
 *
 * Broadcasts the on-chain OP_RETURN beacon signals of every update-bearing
 * scenario, spending the UTXOs that `scenario:fund` placed:
 *
 *   - Cohort beacons: ONE OP_RETURN per cohort with the shared signal from
 *     `lib/scenarios/<network>/cohorts/<id>.json` (the CAS announcement hash or
 *     the SMT root), signed by the cohort aggregator key.
 *   - Solo beacons: one OP_RETURN per update at the beacon the update names
 *     (P2PKH, P2WPKH, or P2TR), with the hash of that update, signed by the key
 *     of the address (the genesis key or an extra key from `other.json`).
 *     A duplicate entry anchors the hash of an earlier update again. Anchors at
 *     one address chain the change UTXO.
 *
 * On regtest the script mines one block after each anchor, so each update sits
 * in its own block, then six more blocks, then waits for the Esplora indexer.
 *
 * Determinism note: the signals are fixed for the current build only. Run
 * generate, artifacts, route, publish, fund, and anchor as one pass; do not
 * generate again between artifacts and anchor.
 *
 * Usage:
 *   pnpm scenario:anchor --network regtest
 *   pnpm scenario:anchor --network mutinynet --dry     # list anchors, no broadcast
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalHash } from '@did-btcr2/common';

import { bitcoinFor, waitForIndexerTip } from './_e2e-helpers.js';
import {
  cohortsOutDir, indexScenarioDirs, loadCohorts, loadRecipes, parseNetworkArg, readJSON, readSignedUpdates, readState,
  realUpdates,
  type AddrType, type OtherFile,
} from './_scenario-helpers.js';
import { anchorSignal, explorerHint } from './wallet/tx-builder.js';

const { network, rest } = parseNetworkArg();
const dry = rest.includes('--dry');

type Anchor = { label: string; secretHex: string; signalHex: string; kind: AddrType };

/** Ordered anchor list: cohort signals first, then solo per-update signals. */
function collectAnchors(): Anchor[] {
  const anchors: Anchor[] = [];

  for (const cohort of loadCohorts(network)) {
    if (cohort.keys.source !== 'fixed') continue;
    const cohortPath = join(cohortsOutDir(network), `${cohort.id}.json`);
    if (!existsSync(cohortPath)) continue;
    const signalHex = readJSON<{ signalHex: string }>(cohortPath).signalHex;
    anchors.push({ label: cohort.id, secretHex: cohort.keys.secretHex, signalHex, kind: 'p2wpkh' });
  }

  const recipes = loadRecipes(network);
  for (const [id, dir] of indexScenarioDirs(network)) {
    const recipe = recipes.get(id);
    const f = readState(network, id);
    if (!recipe || !f || f.anchors.length === 0) continue;
    const other = readJSON<OtherFile>(join(dir, 'other.json'));
    const updates = readSignedUpdates(dir, realUpdates(recipe).length);
    for (const a of f.anchors) {
      const secretHex = a.key === 'genesis' ? other.genesisKeys.secret : other.extraKeys?.[a.key]?.secret;
      if (!secretHex) throw new Error(`${f.scenarioId}: no secret for key "${a.key}" in other.json`);
      const update = updates[a.signalOf - 1];
      if (!update) throw new Error(`${f.scenarioId}: update ${a.signalOf} not found`);
      const again = a.duplicateOf ? ` (update ${a.duplicateOf} again)` : '';
      anchors.push({
        label     : `${f.scenarioId} entry ${a.update}/${recipe.updates.length}${again} @${a.beaconId.slice(a.beaconId.indexOf('#'))}`,
        secretHex,
        signalHex : canonicalHash(update as Record<string, unknown>, { encoding: 'hex' }),
        kind      : a.kind,
      });
    }
  }
  return anchors;
}

async function run(): Promise<void> {
  const anchors = collectAnchors();
  console.log(`=== scenario:anchor (${network}): ${anchors.length} OP_RETURN signals ===`);

  if (dry) {
    for (const a of anchors) console.log(`  ${a.signalHex.slice(0, 20)}...  ${a.kind.padEnd(6)} [${a.label}]`);
    console.log('\n  --dry: nothing broadcast. Fund first (pnpm scenario:fund) and wait for the confirmation.');
    return;
  }

  const btc = network === 'regtest' ? bitcoinFor('regtest') : undefined;
  if (network === 'regtest' && !btc?.rpc) throw new Error('regtest anchoring needs the Bitcoin Core RPC of the Polar stack');
  const minerAddr = btc?.rpc ? await btc.rpc.getNewAddress('bech32') : undefined;

  let ok = 0, fail = 0;
  for (const a of anchors) {
    try {
      const r = await anchorSignal({ secretHex: a.secretHex, signalHex: a.signalHex, network, kind: a.kind });
      console.log(`  OK  ${a.label}  tx=${r.txid} (fee ${r.feeSats})  @${r.address}`);
      ok++;
      if (btc?.rpc && minerAddr) {
        await btc.rpc.generateToAddress(1, minerAddr);
        await waitForIndexerTip(await btc.rpc.getBlockCount(), btc);
      }
    } catch (e) {
      console.log(`  ERR ${a.label}  ${(e as Error).message}`);
      fail++;
    }
  }
  if (btc?.rpc && minerAddr) {
    await btc.rpc.generateToAddress(6, minerAddr);
    await waitForIndexerTip(await btc.rpc.getBlockCount(), btc);
    console.log('  mined 6 more blocks; indexer in sync');
  } else if (anchors.length > 0) {
    console.log(`  explorer: ${explorerHint(network, '<txid>')}`);
  }
  console.log(`\n=== anchored ${ok}/${anchors.length} (${fail} failed) ===`);
  if (fail === 0) console.log(`  Wait for six confirmations, then run: pnpm scenario:verify:live --network ${network} --record`);
  process.exit(fail ? 1 : 0);
}

await run();
