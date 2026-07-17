import { existsSync, readFileSync } from 'node:fs';

import { newKey } from '../keys.js';
import type { Key, Network, Wallet } from '../store.js';
import { findBeacon, loadWallet, requireFunding } from '../store.js';
import type { AddrType } from '../tx-builder.js';
import { EXPLORERS, isValidAddress, sendSats, sweepAll } from '../tx-builder.js';

export async function cmdSend(from: string, to: string, opts: {
  amount?: string;
  all?: boolean;
  network?: Network;
  fromType?: AddrType;
  toType?: AddrType;
  feeRate?: string;
}) {
  const wallet = loadWallet();

  const network = opts.network ?? wallet.network;
  const fromKind = opts.fromType ?? 'p2wpkh';
  const toKind = opts.toType ?? 'p2wpkh';
  const feeRate = opts.feeRate ? Number(opts.feeRate) : undefined;

  if (!!opts.all === (opts.amount !== undefined)) {
    throw new Error('Specify exactly one of --amount <sats> or --all.');
  }
  if (opts.amount !== undefined && !/^\d+$/.test(opts.amount)) {
    throw new Error(`--amount must be a whole number of sats, got "${opts.amount}".`);
  }

  const fromKey = resolveSource(wallet, from);
  const fromAddress = fromKey.addresses[network][fromKind];
  const destAddress = resolveDestination(wallet, to, network, toKind);

  console.log(`\n  Sending ${opts.all ? 'ALL (sweep)' : `${opts.amount} sats`} on ${network}`);
  console.log(`    from:    ${fromAddress}  (${from}, ${fromKind})`);
  console.log(`    to:      ${destAddress}`);
  console.log(`    feerate: ${feeRate ?? 1} sat/vB\n`);

  const result = opts.all
    ? await sweepAll({ fromKey, fromKind, destAddress, network, feeRateSatPerVb: feeRate })
    : await sendSats({
      fromKey, fromKind, destAddress, network,
      amountSats      : BigInt(opts.amount!),
      feeRateSatPerVb : feeRate,
    });

  console.log(`  Broadcast: ${result.txid}`);
  console.log(`  vsize:     ${result.vsize} vB`);
  console.log(`  fee:       ${result.feeSats} sats`);
  if ('sweptSats' in result) {
    console.log(`  swept:     ${result.sweptSats} sats`);
  }
  if (network !== 'regtest') {
    console.log(`  explorer:  ${EXPLORERS[network]}${result.txid}\n`);
  }
}

/**
 * The source must be a key the wallet can sign with: `funding`, a registered
 * beacon label, or a path to a file holding a 64-hex-char secret. A file
 * source stays ephemeral: it is used for this one transaction, never saved.
 */
function resolveSource(wallet: Wallet, from: string): Key {
  if (from === 'funding') return requireFunding(wallet);

  const beacon = findBeacon(wallet, from);
  if (beacon) return beacon;

  if (existsSync(from)) {
    const secretHex = readFileSync(from, 'utf-8').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(secretHex)) {
      throw new Error(`File ${from} does not contain a 64-hex-char secret key.`);
    }
    return newKey(`(secret file: ${from})`, { secretHex });
  }

  throw new Error(
    `"${from}" is not "funding", a registered beacon label (see \`pnpm wallet list\`), `
    + 'or a readable secret-hex file.',
  );
}

/** The destination may be `funding`, a registered label, or a raw address. */
function resolveDestination(wallet: Wallet, to: string, network: Network, toKind: AddrType): string {
  if (to === 'funding') return requireFunding(wallet).addresses[network][toKind];

  const beacon = findBeacon(wallet, to);
  if (beacon) return beacon.addresses[network][toKind];

  if (isValidAddress(to, network)) return to;

  throw new Error(
    `"${to}" is neither "funding", a registered beacon label (see \`pnpm wallet list\`), `
    + `nor a valid ${network} address.`,
  );
}
