import { connectionFor, getBalance } from '../tx-builder.js';
import type { Key, Network } from '../store.js';
import { loadWallet } from '../store.js';

export async function cmdStatus(opts: { network?: Network }) {
  const wallet = loadWallet();
  const network = (opts.network ?? wallet.network);
  const btc = connectionFor(network);

  console.log(`\n  Balances on ${network}\n`);

  const printBalances = async (label: string, key: Key) => {
    const types = ['p2pkh', 'p2wpkh', 'p2tr'] as const;
    const bals = await Promise.all(types.map((t) => getBalance(key.addresses[network][t], btc)));
    const total = bals.reduce((a, b) => a + b, 0);
    console.log(`  [${label}]${key.scenarioId ? ` scenario=${key.scenarioId}` : ''}  total ${total} sats`);
    types.forEach((t, i) => {
      const bal = bals[i];
      const marker = bal > 0 ? '*' : ' ';
      console.log(`    ${marker} ${t.padEnd(8)} ${key.addresses[network][t]}  ${bal} sats`);
    });
    console.log();
  };

  if (wallet.funding) await printBalances('funding', wallet.funding);
  for (const k of wallet.beacons) await printBalances(k.label, k);
}
