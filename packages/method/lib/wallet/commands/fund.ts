import type { Network } from '../store.js';
import { findBeacon, loadWallet, requireFunding } from '../store.js';
import type { AddrType } from '../tx-builder.js';
import { EXPLORERS, fundBeacon, isValidAddress, sendSats } from '../tx-builder.js';

export async function cmdFund(labelOrAddress: string, opts: {
  amount?: string;
  network?: Network;
  addrType?: AddrType;
  feeRate?: string;
}) {
  const wallet = loadWallet();
  const funding = requireFunding(wallet);

  const network = opts.network ?? wallet.network;
  const addrType = opts.addrType ?? 'p2wpkh';
  const amountSats = BigInt(opts.amount ?? '10000');
  const feeRate = opts.feeRate ? Number(opts.feeRate) : undefined;

  // A registered label wins; anything else must decode as an address on the
  // target network (`--addr-type` only applies to labels, where the wallet
  // picks the derivation; a raw address already pins its own type).
  const beacon = findBeacon(wallet, labelOrAddress);
  if (!beacon && !isValidAddress(labelOrAddress, network)) {
    throw new Error(
      `"${labelOrAddress}" is neither a registered beacon label (see \`pnpm wallet list\`) `
      + `nor a valid ${network} address.`,
    );
  }
  const destAddress = beacon ? beacon.addresses[network][addrType] : labelOrAddress;

  console.log(`\n  Funding ${beacon ? `${labelOrAddress} (${addrType})` : destAddress} on ${network}`);
  console.log(`    from:    ${funding.addresses[network].p2wpkh}  (funding P2WPKH)`);
  console.log(`    to:      ${destAddress}`);
  console.log(`    amount:  ${amountSats} sats`);
  console.log(`    feerate: ${feeRate ?? 1} sat/vB\n`);

  const result = beacon
    ? await fundBeacon({
      funding, beacon, network,
      destKind        : addrType,
      amountSats,
      feeRateSatPerVb : feeRate,
    })
    : await sendSats({
      fromKey         : funding,
      fromKind        : 'p2wpkh',
      destAddress,
      amountSats,
      network,
      feeRateSatPerVb : feeRate,
    });

  console.log(`  Broadcast: ${result.txid}`);
  console.log(`  vsize:     ${result.vsize} vB`);
  console.log(`  fee:       ${result.feeSats} sats`);
  if (network !== 'regtest') {
    console.log(`  explorer:  ${EXPLORERS[network]}${result.txid}\n`);
  }
}
