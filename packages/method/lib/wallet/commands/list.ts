import { loadWallet } from '../store.js';

export async function cmdList(opts: { network?: string }) {
  const wallet = loadWallet();
  const net = (opts.network ?? wallet.network) as keyof typeof wallet.funding.addresses;

  console.log(`\n  Wallet (${wallet.beacons.length + (wallet.funding ? 1 : 0)} keys, default network: ${wallet.network}, showing: ${net})\n`);

  if (wallet.funding) {
    console.log(`  [funding]`);
    console.log(`    P2PKH:  ${wallet.funding.addresses[net].p2pkh}`);
    console.log(`    P2WPKH: ${wallet.funding.addresses[net].p2wpkh}`);
    console.log(`    P2TR:   ${wallet.funding.addresses[net].p2tr}\n`);
  }

  if (wallet.beacons.length === 0) {
    console.log(`  No beacon keys registered. Run \`pnpm wallet add <label>\` to add one.\n`);
    return;
  }

  for (const k of wallet.beacons) {
    console.log(`  [${k.label}]${k.scenarioId ? ` scenario=${k.scenarioId}` : ''}`);
    console.log(`    P2PKH:  ${k.addresses[net].p2pkh}`);
    console.log(`    P2WPKH: ${k.addresses[net].p2wpkh}`);
    console.log(`    P2TR:   ${k.addresses[net].p2tr}\n`);
  }
}
