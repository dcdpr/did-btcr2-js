import type { Network } from '../store.js';
import { loadWallet, requireBeacon, requireFunding } from '../store.js';
import type { AddrType } from '../tx-builder.js';
import { fundBeacon } from '../tx-builder.js';

const EXPLORERS: Record<Network, string> = {
  regtest   : '(no public explorer)',
  mutinynet : 'https://mutinynet.com/tx/',
  signet    : 'https://mempool.space/signet/tx/',
  testnet4  : 'https://mempool.space/testnet4/tx/',
};

export async function cmdFund(label: string, opts: {
  amount?: string;
  network?: Network;
  addrType?: AddrType;
  feeRate?: string;
}) {
  const wallet = loadWallet();
  const funding = requireFunding(wallet);
  const beacon = requireBeacon(wallet, label);

  const network = opts.network ?? wallet.network;
  const addrType = opts.addrType ?? 'p2wpkh';
  const amountSats = BigInt(opts.amount ?? '10000');
  const feeRate = opts.feeRate ? Number(opts.feeRate) : undefined;

  const destAddress = beacon.addresses[network][addrType];

  console.log(`\n  Funding ${label} (${addrType}) on ${network}`);
  console.log(`    from:    ${funding.addresses[network].p2wpkh}  (funding P2WPKH)`);
  console.log(`    to:      ${destAddress}`);
  console.log(`    amount:  ${amountSats} sats`);
  console.log(`    feerate: ${feeRate ?? 1} sat/vB\n`);

  const result = await fundBeacon({
    funding, beacon, network, destKind        : addrType, amountSats,
    feeRateSatPerVb : feeRate,
  });

  console.log(`  Broadcast: ${result.txid}`);
  console.log(`  vsize:     ${result.vsize} vB`);
  console.log(`  fee:       ${result.feeSats} sats`);
  if (network !== 'regtest') {
    console.log(`  explorer:  ${EXPLORERS[network]}${result.txid}\n`);
  }
}
