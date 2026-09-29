import type { Network } from '../store.js';
import { loadWallet } from '../store.js';
import type { AddrType } from '../tx-builder.js';
import { consolidate, explorerHint } from '../tx-builder.js';
import { resolveDestination, resolveSource } from './send.js';

/** A consolidation spends the UTXOs at all three address types of each source. */
const ALL_KINDS: AddrType[] = [ 'p2pkh', 'p2wpkh', 'p2tr' ];

/**
 * Sweep every UTXO of one or more wallet keys into one output, in one
 * transaction. A source is `funding`, a registered label, or a secret-hex file,
 * as for `send`. The destination is `funding` (the default), a label, or a raw
 * address. `--dry-run` builds and signs the transaction and does not send it.
 */
export async function cmdConsolidate(sources: string[], opts: {
  to?: string;
  toType?: AddrType;
  network?: Network;
  feeRate?: string;
  dryRun?: boolean;
}) {
  const wallet = loadWallet();
  const network = opts.network ?? wallet.network;
  const toKind = opts.toType ?? 'p2wpkh';
  const feeRate = opts.feeRate ? Number(opts.feeRate) : undefined;
  const destAddress = resolveDestination(wallet, opts.to ?? 'funding', network, toKind);

  // One source for each key, also if a key is given twice.
  const keys = sources.map((source) => resolveSource(wallet, source));
  const unique = keys.filter((key, i) => keys.findIndex((other) => other.pubkeyHex === key.pubkeyHex) === i);

  console.log(`\n  Consolidating ${unique.map((key) => key.label).join(', ')} on ${network}${opts.dryRun ? ' (dry run)' : ''}`);
  console.log(`    to:      ${destAddress}`);
  console.log(`    feerate: ${feeRate ?? 1} sat/vB\n`);

  const result = await consolidate({
    sources         : unique.map((key) => ({ key, kinds: ALL_KINDS })),
    destAddress,
    network,
    feeRateSatPerVb : feeRate,
    broadcast       : !opts.dryRun,
  });

  for (const input of result.inputs) {
    const status = input.confirmed ? '' : '  (unconfirmed)';
    console.log(`    in   ${input.label.padEnd(16)} ${input.kind.padEnd(7)} ${String(input.value).padStart(8)} sats  ${input.txid}:${input.vout}${status}`);
  }
  console.log(`    out  ${destAddress}  ${result.sweptSats} sats\n`);
  console.log(`  ${opts.dryRun ? 'Txid (not sent)' : 'Broadcast'}:  ${result.txid}`);
  console.log(`  vsize:      ${result.vsize} vB`);
  console.log(`  fee:        ${result.feeSats} sats`);
  console.log(`  swept:      ${result.sweptSats} sats`);
  if (!opts.dryRun && network !== 'regtest') {
    console.log(`  explorer:   ${explorerHint(network, result.txid)}`);
  }
  console.log();
}
