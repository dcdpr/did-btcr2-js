import { newKey } from '../keys.js';
import type { Network } from '../store.js';
import { NETWORKS, saveWallet, walletExists, WALLET_FILE } from '../store.js';

const FAUCETS: Record<Network, string> = {
  regtest   : '(use bitcoind RPC; no faucet)',
  mutinynet : 'https://faucet.mutinynet.com/',
  signet    : 'https://signetfaucet.com/',
  testnet4  : 'https://mempool.space/testnet4/faucet',
};

export async function cmdInit(opts: { network?: Network; force?: boolean }) {
  if (walletExists() && !opts.force) {
    throw new Error(`Wallet already exists at ${WALLET_FILE}. Use --force to overwrite (DESTRUCTIVE).`);
  }

  const network = opts.network ?? 'mutinynet';
  if (!NETWORKS.includes(network)) {
    throw new Error(`Unknown network "${network}". Choose: ${NETWORKS.join(', ')}`);
  }

  const funding = newKey('funding', { notes: 'Funding wallet. Receives faucet sats. Sends to beacons on demand.' });

  saveWallet({
    version : 1,
    network,
    funding,
    beacons : [],
  });

  console.log(`\n  Wallet initialized at ${WALLET_FILE}\n`);
  console.log(`  Funding key created.`);
  console.log(`  Default network: ${network}\n`);
  console.log(`  Fund any of these addresses to begin:\n`);
  for (const net of NETWORKS) {
    console.log(`    ${net.padEnd(10)} P2PKH:  ${funding.addresses[net].p2pkh}`);
    console.log(`    ${net.padEnd(10)} P2WPKH: ${funding.addresses[net].p2wpkh}  <- recommended (cheapest)`);
    console.log(`    ${net.padEnd(10)} P2TR:   ${funding.addresses[net].p2tr}`);
    console.log(`    ${' '.repeat(10)} faucet: ${FAUCETS[net]}\n`);
  }

  console.log(`  IMPORTANT: back up ${WALLET_FILE}. Losing it loses every tracked sat.`);
  console.log(`  Next: pnpm wallet status     (check balances after funding)`);
  console.log(`        pnpm wallet add <label> (register a new beacon key)\n`);
}
