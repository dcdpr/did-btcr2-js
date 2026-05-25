import type { Network } from '../store.js';
import { loadWallet, requireBeacon, requireFunding } from '../store.js';
import type { AddrType } from '../tx-builder.js';
import { sweepBeacon } from '../tx-builder.js';

export async function cmdRecover(label: string, opts: {
  network?: Network;
  addrType?: AddrType;
  feeRate?: string;
}) {
  const wallet = loadWallet();
  const funding = requireFunding(wallet);
  const beacon = requireBeacon(wallet, label);

  const network = opts.network ?? wallet.network;
  const fromKind = opts.addrType ?? 'p2wpkh';
  const feeRate = opts.feeRate ? Number(opts.feeRate) : undefined;

  console.log(`\n  Recovering ${label} (${fromKind}) on ${network}`);
  console.log(`    from: ${beacon.addresses[network][fromKind]}`);
  console.log(`    to:   ${funding.addresses[network].p2wpkh}  (funding P2WPKH)\n`);

  const result = await sweepBeacon({
    funding, beacon, network, fromKind,
    feeRateSatPerVb : feeRate,
  });

  console.log(`  Broadcast:  ${result.txid}`);
  console.log(`  vsize:      ${result.vsize} vB`);
  console.log(`  fee:        ${result.feeSats} sats`);
  console.log(`  swept back: ${result.sweptSats} sats\n`);
}
