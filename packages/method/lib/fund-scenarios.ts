/**
 * Scenario funder (Batch C, step 4).
 *
 * Sends sats from the wallet funding key to every beacon address that will carry
 * an on-chain OP_RETURN, in ONE batch transaction (one output per address, so
 * each address ends up with its own spendable UTXO). The targets are the 9
 * unique addresses in lib/FUNDING.md: the 4 cohort beacons (one per cohort) and
 * the solo singleton beacons of the update-bearing non-cohort scenarios.
 *
 * Per-address amount scales with how many anchors that address must carry (a
 * solo multi-update scenario anchors once per update, chaining change), so a
 * single funding UTXO per address can fund the whole anchor chain.
 *
 * Requires an initialized wallet with a funded funding key:
 *   pnpm wallet init && pnpm wallet status   (faucet the funding P2WPKH first)
 *
 * Usage:
 *   bun lib/fund-scenarios.ts            # broadcast the batch funding tx
 *   bun lib/fund-scenarios.ts --dry      # list targets + amounts, no broadcast
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getNetwork } from '@did-btcr2/bitcoin';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hex } from '@scure/base';
import { p2wpkh } from '@scure/btc-signer';

import { loadWallet, requireFunding, type Network } from './wallet/store.js';
import { fundManyAddresses } from './wallet/tx-builder.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const COHORTS_FILE = join(HERE, 'cohorts.json');
const NETWORK: Network = 'mutinynet';

/** sats per anchor an address must carry, plus a flat dust+buffer base. */
const BASE_SATS = 2000n;
const PER_ANCHOR_SATS = 1000n;

type FundingFile = { needsFunding: boolean; cohort: string | null; primaryBeacon: string | null };
type CohortDef = { id: string; keys: { source: string; secretHex?: string }; members: string[] };

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/** address -> { anchors, label } for every address needing on-chain funding. */
function collectTargets(): Map<string, { anchors: number; label: string }> {
  const targets = new Map<string, { anchors: number; label: string }>();
  const net = getNetwork(NETWORK);

  // Solo (non-cohort) update scenarios fund their own singleton beacon.
  for (const type of ['k1', 'x1']) {
    const typeDir = join(DATA_DIR, NETWORK, type);
    if (!existsSync(typeDir)) continue;
    for (const h of readdirSync(typeDir)) {
      const dir = join(typeDir, h);
      const funding = join(dir, 'funding.json');
      const scenario = join(dir, 'scenario.json');
      if (!existsSync(funding) || !existsSync(scenario)) continue;
      const f = readJSON<FundingFile>(funding);
      if (!f.needsFunding || f.cohort || !f.primaryBeacon) continue;
      const anchors = (readJSON<{ updates?: unknown[] }>(scenario).updates ?? []).length || 1;
      const id = readJSON<{ id: string }>(scenario).id;
      targets.set(f.primaryBeacon, { anchors, label: id });
    }
  }

  // Cohort beacons: one shared address per cohort, one anchor each.
  for (const cohort of readJSON<{ cohorts: CohortDef[] }>(COHORTS_FILE).cohorts) {
    if (cohort.keys.source !== 'fixed' || !cohort.keys.secretHex) continue;
    const kp = SchnorrKeyPair.fromSecret(hex.decode(cohort.keys.secretHex));
    const address = p2wpkh(kp.publicKey.compressed, net).address!;
    targets.set(address, { anchors: 1, label: cohort.id });
  }

  return targets;
}

async function run(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const targetMap = collectTargets();
  const targets = [...targetMap.entries()].map(([address, { anchors, label }]) => ({
    address,
    label,
    anchors,
    amountSats : BASE_SATS + PER_ANCHOR_SATS * BigInt(anchors),
  }));

  const total = targets.reduce((s, t) => s + t.amountSats, 0n);
  console.log(`=== scenario:fund (${NETWORK}) — ${targets.length} addresses, ${total} sats total ===`);
  for (const t of targets) {
    console.log(`  ${t.amountSats.toString().padStart(5)} sats  ${t.address}  [${t.label}, ${t.anchors} anchor(s)]`);
  }

  if (dry) {
    console.log('\n  --dry: nothing broadcast. Faucet the funding key with at least the total above + fee.');
    return;
  }

  const funding = requireFunding(loadWallet());
  console.log(`\n  funding from ${funding.addresses[NETWORK].p2wpkh}`);
  const result = await fundManyAddresses({
    funding,
    targets : targets.map((t) => ({ address: t.address, amountSats: t.amountSats })),
    network : NETWORK,
  });
  console.log(`  Broadcast: ${result.txid}`);
  console.log(`  vsize ${result.vsize} vB, fee ${result.feeSats} sats`);
  console.log(`  explorer: https://mutinynet.com/tx/${result.txid}`);
  console.log('\n  Wait for confirmation, then run: pnpm scenario:anchor');
}

await run();
