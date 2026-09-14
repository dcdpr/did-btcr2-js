import { newKey } from '../keys.js';
import { findBeacon, loadWallet, saveWallet } from '../store.js';

export async function cmdAdd(label: string, opts: { scenario?: string; secret?: string; notes?: string }) {
  const wallet = loadWallet();

  if (findBeacon(wallet, label)) {
    throw new Error(`Beacon key "${label}" already exists. Pick a different label or remove the existing one manually.`);
  }

  const key = newKey(label, {
    scenarioId : opts.scenario ?? null,
    secretHex  : opts.secret,
    notes      : opts.notes,
  });

  wallet.beacons.push(key);
  saveWallet(wallet);

  console.log(`\n  Beacon key "${label}" registered.`);
  if (key.scenarioId) console.log(`  Scenario:  ${key.scenarioId}`);
  console.log(`  Secret:    ${key.secretHex.slice(0, 8)}...${key.secretHex.slice(-8)}  (full in wallet.json)`);
  console.log(`  Pubkey:    ${key.pubkeyHex}\n`);
  console.log(`  Addresses on ${wallet.network} (default network):`);
  console.log(`    P2PKH:  ${key.addresses[wallet.network].p2pkh}`);
  console.log(`    P2WPKH: ${key.addresses[wallet.network].p2wpkh}`);
  console.log(`    P2TR:   ${key.addresses[wallet.network].p2tr}\n`);
  console.log(`  Next: pnpm wallet fund ${label} --amount <sats> --addr-type <p2pkh|p2wpkh|p2tr>`);
}
