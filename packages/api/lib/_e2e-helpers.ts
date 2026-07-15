/**
 * Shared e2e helpers for the did:btcr2 lib/ scripts.
 *
 * Underscore-prefixed so the test-vector + roundtrip scripts in this directory
 * don't accidentally run this file as a top-level script.
 *
 * Supports five networks:
 *   - regtest:   fully automated via bitcoind RPC (sendToAddress + mine)
 *   - mutinynet, signet, testnet3, testnet4:
 *       operator funds the beacon address through a faucet or external wallet,
 *       confirms 1+ block, then presses Y; everything else (queries, broadcast,
 *       discovery) goes through Esplora/REST.
 */
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { BitcoinApi, NETWORK_PRESETS, explorerAddressUrl, faucetUrl } from '../src/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/** Networks the e2e scripts support. */
export type E2ENetwork = 'regtest' | 'mutinynet' | 'signet' | 'testnet3' | 'testnet4';

const VALID_NETWORKS: ReadonlyArray<E2ENetwork> = ['regtest', 'mutinynet', 'signet', 'testnet3', 'testnet4'];

/** Polar's regtest bitcoind default credentials. */
const REGTEST_RPC = { username: 'polaruser', password: 'polarpass' } as const;

/**
 * Read and validate `BITCOIN_NETWORK` env. Defaults to `regtest`. Throws on
 * any unsupported value so e2e scripts fail loudly rather than silently
 * connecting to an unintended network.
 */
export function parseNetworkEnv(): E2ENetwork {
  const raw = (process.env.BITCOIN_NETWORK ?? 'regtest') as E2ENetwork;
  if (!VALID_NETWORKS.includes(raw)) {
    throw new Error(
      `Unsupported BITCOIN_NETWORK="${raw}". Valid values: ${VALID_NETWORKS.join(', ')}.`,
    );
  }
  return raw;
}

/**
 * Build a `BitcoinConnection` for the given network. RPC credentials are wired
 * only for regtest (no public network has callable RPC).
 */
export function bitcoinFor(network: E2ENetwork): BitcoinConnection {
  const cfg = network === 'regtest' ? { network, rpc: REGTEST_RPC } : { network };
  return new BitcoinApi(cfg).connection;
}

/**
 * Poll Esplora until a UTXO appears at `address`. Defaults are tuned for
 * Polar's regtest indexer (1-5s lag); set `timeoutMs` larger on public
 * networks where indexer + block propagation take longer.
 *
 * Set `requireConfirmed: true` to wait for `status.confirmed === true` rather
 * than any UTXO (mempool entries are filtered out).
 */
export async function waitForUtxo(
  address: string,
  bitcoin: BitcoinConnection,
  opts: { timeoutMs?: number; pollMs?: number; requireConfirmed?: boolean } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pollMs = opts.pollMs ?? 500;
  const requireConfirmed = opts.requireConfirmed ?? false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const utxos = await bitcoin.rest.address.getUtxos(address).catch(() => []);
    const visible = requireConfirmed
      ? utxos.filter((u) => u.status?.confirmed === true)
      : utxos;
    if (visible.length > 0) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `waitForUtxo: ${address} not ${requireConfirmed ? 'confirmed' : 'indexed'} within ${timeoutMs}ms`,
  );
}

/**
 * Prompt the operator and wait for Y/Enter. Anything else re-prompts.
 * Bun and Node both expose `node:readline/promises`.
 */
async function promptYes(message: string): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const ans = (await rl.question(message)).trim().toLowerCase();
      if (ans === '' || ans === 'y' || ans === 'yes') return;
      console.log(`      Expected Y/Enter; got "${ans}". Re-prompting.`);
    }
  } finally {
    rl.close();
  }
}

/**
 * Explorer address URL for operator hints. Reads the shared per-network preset
 * (ADR 082); falls back to mainnet mempool for any network without an explorer
 * base (only reached if a caller passes regtest, which the funding paths do not).
 */
function explorerUrl(network: E2ENetwork, address: string): string {
  return explorerAddressUrl(network, address) ?? `https://mempool.space/address/${address}`;
}

/** Faucet URL hint per public network, from the shared preset (ADR 082). */
function faucetHint(network: E2ENetwork): string | undefined {
  return faucetUrl(network);
}

/**
 * Per-network indexer-lag timeout. mutinynet has 30s blocks so the indexer
 * settles within a minute or so; signet/testnet have ~10min blocks but once
 * the operator confirms a block exists, the indexer typically catches up in
 * a few minutes. Mainnet not supported here.
 */
export function utxoTimeoutMs(network: E2ENetwork): number {
  switch (network) {
    case 'regtest':   return 30_000;
    case 'mutinynet': return 90_000;
    default:          return 5 * 60_000;
  }
}

/**
 * Funds a beacon address.
 *
 * - regtest: RPC sendToAddress + mine 6 blocks + wait for indexer.
 * - all others: prompt the operator to fund manually + confirm 1+ block,
 *   then poll Esplora until the confirmed UTXO surfaces.
 *
 * Returns `minerAddr` (regtest only) for later use by `confirmBroadcast`.
 */
export async function fundBeacon(args: {
  beaconAddress: string;
  bitcoin: BitcoinConnection;
  network: E2ENetwork;
  amountSats?: number;
  /** If the same beacon address needs multiple separate UTXOs (e.g. the
   *  signer-parity test broadcasts twice), set this to >1. */
  count?: number;
}): Promise<{ minerAddr?: string }> {
  const { beaconAddress, bitcoin, network, amountSats = 100_000, count = 1 } = args;

  if (network === 'regtest') {
    if (!bitcoin.rpc) throw new Error('regtest path requires bitcoin.rpc to be wired');
    const minerAddr = await bitcoin.rpc.getNewAddress('bech32');
    const btc = amountSats / 100_000_000;
    for (let i = 0; i < count; i++) {
      await bitcoin.rpc.sendToAddress(beaconAddress, btc);
    }
    await bitcoin.rpc.generateToAddress(6, minerAddr);
    await waitForUtxo(beaconAddress, bitcoin, {
      requireConfirmed : true,
      timeoutMs        : utxoTimeoutMs(network),
    });
    return { minerAddr };
  }

  // Non-regtest: operator-funded.
  console.log(`\n  ──> Fund the beacon address with at least ${amountSats} sats`
    + (count > 1 ? ` (${count} separate UTXOs required for this test):` : ':'));
  console.log(`      Beacon: ${beaconAddress}`);
  const faucet = faucetHint(network);
  if (faucet) console.log(`      Faucet: ${faucet}`);
  console.log(`      Explorer: ${explorerUrl(network, beaconAddress)}`);
  console.log(`      Wait for the funding tx to confirm in at least 1 block, then press Y.`);

  await promptYes('      Funded and confirmed? [Y/n] ');

  await waitForUtxo(beaconAddress, bitcoin, {
    requireConfirmed : true,
    timeoutMs        : utxoTimeoutMs(network),
  });
  return {};
}

/**
 * Ensure a broadcast tx is confirmed before downstream verification steps
 * (e.g. BeaconSignalDiscovery.indexer expects confirmed signals).
 *
 * - regtest: mine 1 block to `minerAddr`.
 * - all others: prompt the operator to wait for the broadcast to confirm.
 */
export async function confirmBroadcast(args: {
  bitcoin: BitcoinConnection;
  network: E2ENetwork;
  /** regtest only - the wallet address to mine to. */
  minerAddr?: string;
  /** Optional: address whose UTXOs should reflect the broadcast (for operator URL hints). */
  watchAddress?: string;
}): Promise<void> {
  const { bitcoin, network, minerAddr, watchAddress } = args;
  if (network === 'regtest') {
    if (!bitcoin.rpc) throw new Error('regtest confirmBroadcast requires bitcoin.rpc');
    if (!minerAddr) throw new Error('regtest confirmBroadcast requires minerAddr');
    await bitcoin.rpc.generateToAddress(6, minerAddr);
    return;
  }
  console.log(`\n  ──> Wait for the broadcast to confirm on ${network}.`);
  if (watchAddress) {
    console.log(`      Explorer: ${explorerUrl(network, watchAddress)}`);
  }
  console.log(`      Block times: ${blockTimeHint(network)}`);
  await promptYes('      Broadcast confirmed (1+ block)? [Y/n] ');
}

/**
 * Persist a freshly generated secret key for non-regtest networks so funds
 * sent to a derived beacon address can be recovered later.
 *
 * No-op on regtest (Polar is ephemeral and the bitcoind wallet owns all keys).
 * On every other network, writes a JSON file to `lib/.e2e-keys/` and prints
 * the path so the operator can back it up. The directory is gitignored.
 *
 * Returns the absolute path of the written file, or `null` on regtest.
 */
export function persistKey(args: {
  network: E2ENetwork;
  did: string;
  secretKeyBytes: Uint8Array;
  pubkeyBytes: Uint8Array;
  beaconAddress?: string;
  /** Script name or short identifier; appears in filename + JSON body. */
  label?: string;
}): string | null {
  const { network, did, secretKeyBytes, pubkeyBytes, beaconAddress, label } = args;
  if (network === 'regtest') return null;

  const hereDir = dirname(fileURLToPath(import.meta.url));
  const keysDir = resolvePath(hereDir, '.e2e-keys');
  mkdirSync(keysDir, { recursive: true });

  const pubkeyHex = Buffer.from(pubkeyBytes).toString('hex');
  const shortPub = pubkeyHex.slice(0, 16);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const labelPart = label ? `${label}-` : '';
  const filename = `${network}-${labelPart}${shortPub}-${stamp}.json`;
  const filepath = resolvePath(keysDir, filename);

  const body = {
    did,
    network,
    label         : label ?? null,
    secretHex     : Buffer.from(secretKeyBytes).toString('hex'),
    pubkeyHex,
    beaconAddress : beaconAddress ?? null,
    createdAt     : new Date().toISOString(),
  };
  writeFileSync(filepath, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });

  console.log(`  ──> WARN: secret key saved to ${filepath}`);
  console.log(`      Back this up if funds are at stake. The file is gitignored.`);
  return filepath;
}

/** Block-time hint per network, from the shared preset (ADR 082). */
function blockTimeHint(n: E2ENetwork): string {
  return NETWORK_PRESETS[n].blockTimeHint ?? 'on-demand';
}
