/**
 * Scenario funder (pipeline step 5).
 *
 * Sends sats to every address that will carry an on-chain OP_RETURN: the beacon
 * addresses of the solo scenarios (one per anchor address, read from the
 * pipeline state of each scenario) and the shared address of every cohort.
 *
 * The amount per address scales with the number of anchors the address carries
 * (a multi-update scenario anchors once per update and chains the change), so
 * one funding UTXO per address covers the whole chain.
 *
 *   - regtest: `sendtoaddress` over the Bitcoin Core RPC of the local Polar
 *     stack, then one block, then a wait for the Esplora indexer. No wallet.
 *   - other networks: ONE batch transaction from the wallet funding key (one
 *     output per address). Faucet the funding key first: `pnpm wallet status`.
 *
 * Usage:
 *   pnpm scenario:fund --network regtest
 *   pnpm scenario:fund --network mutinynet --dry     # list targets, no broadcast
 */

import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { hex } from '@scure/base';

import { bitcoinFor, waitForIndexerTip } from './_e2e-helpers.js';
import {
  indexScenarioDirs, loadCohorts, parseNetworkArg, readState,
  type AddrType,
} from './_scenario-helpers.js';
import { loadWallet, requireFunding } from './wallet/store.js';
import { addressForKind, explorerHint, fundManyAddresses } from './wallet/tx-builder.js';

const { network, rest } = parseNetworkArg();
const dry = rest.includes('--dry');

/** Flat base per address, plus sats per anchor the address must carry. */
const BASE_SATS = 2000n;
const PER_ANCHOR_SATS = 1000n;

type Target = { address: string; kind: AddrType; anchors: number; labels: string[] };

/** Every address that needs funding, with the number of anchors it carries. */
function collectTargets(): Target[] {
  const targets = new Map<string, Target>();
  for (const [id] of indexScenarioDirs(network)) {
    const f = readState(network, id);
    if (!f) continue;
    for (const a of f.anchors) {
      const t = targets.get(a.address) ?? { address: a.address, kind: a.kind, anchors: 0, labels: [] };
      t.anchors++;
      if (!t.labels.includes(f.scenarioId)) t.labels.push(f.scenarioId);
      targets.set(a.address, t);
    }
  }
  for (const cohort of loadCohorts(network)) {
    if (cohort.keys.source !== 'fixed') continue;
    const kp = SchnorrKeyPair.fromSecret(hex.decode(cohort.keys.secretHex));
    const address = addressForKind(kp.publicKey.compressed, 'p2wpkh', network);
    targets.set(address, { address, kind: 'p2wpkh', anchors: 1, labels: [cohort.id] });
  }
  return [...targets.values()];
}

async function fundRegtest(targets: Array<Target & { amountSats: bigint }>): Promise<void> {
  const btc = bitcoinFor('regtest');
  if (!btc.rpc) throw new Error('regtest funding needs the Bitcoin Core RPC of the Polar stack');
  for (const t of targets) {
    const tx = await btc.rpc.sendToAddress(t.address, Number(t.amountSats) / 100_000_000);
    console.log(`  sent ${t.amountSats} sats to ${t.address}  tx=${typeof tx === 'string' ? tx : (tx as { txid?: string }).txid ?? ''}`);
  }
  const minerAddr = await btc.rpc.getNewAddress('bech32');
  await btc.rpc.generateToAddress(1, minerAddr);
  await waitForIndexerTip(await btc.rpc.getBlockCount(), btc);
  console.log('  mined 1 block; indexer in sync');
}

async function run(): Promise<void> {
  const targets = collectTargets().map((t) => ({ ...t, amountSats: BASE_SATS + PER_ANCHOR_SATS * BigInt(t.anchors) }));
  const total = targets.reduce((s, t) => s + t.amountSats, 0n);
  console.log(`=== scenario:fund (${network}): ${targets.length} addresses, ${total} sats total ===`);
  for (const t of targets) {
    console.log(`  ${t.amountSats.toString().padStart(5)} sats  ${t.address}  ${t.kind.padEnd(6)} [${t.labels.join(', ')}, ${t.anchors} anchor(s)]`);
  }
  if (targets.length === 0) return;

  if (dry) {
    console.log('\n  --dry: nothing broadcast.');
    if (network !== 'regtest') console.log('  Faucet the wallet funding key with at least the total above plus the fee.');
    return;
  }

  if (network === 'regtest') {
    await fundRegtest(targets);
  } else {
    const funding = requireFunding(loadWallet());
    console.log(`\n  funding from ${funding.addresses[network].p2wpkh}`);
    const result = await fundManyAddresses({
      funding,
      targets : targets.map((t) => ({ address: t.address, amountSats: t.amountSats })),
      network,
    });
    console.log(`  Broadcast: ${result.txid}`);
    console.log(`  vsize ${result.vsize} vB, fee ${result.feeSats} sats`);
    console.log(`  explorer: ${explorerHint(network, result.txid)}`);
    console.log('\n  Wait for the confirmation.');
  }
  console.log(`  Next: pnpm scenario:anchor --network ${network}`);
}

await run();
