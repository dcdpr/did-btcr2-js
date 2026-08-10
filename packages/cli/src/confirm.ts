import { readSync } from 'node:fs';
import { CLIError } from './error.js';
import type { NetworkOption } from './types.js';

/**
 * Hard ceiling for the `--fee-rate` flag, the `BTCR2_FEE_RATE` env var, and the
 * profile `btc.feeRate` value. Far above historical congestion
 * peaks; anything higher is a fat-finger, not a fee choice.
 */
export const MAX_FEE_RATE_SATS_PER_VBYTE = 1000;

/** The SDK default fee rate applied when the operator sets none. */
export const DEFAULT_FEE_RATE_SATS_PER_VBYTE = 5;

/**
 * Approximate vsize of a single-party beacon signal transaction (P2PKH input
 * is the worst case; P2WPKH/P2TR are smaller). Used only for the pre-broadcast
 * fee estimate shown at the confirmation prompt; the exact fee is fixed later
 * inside the beacon's two-pass transaction build.
 */
export const ESTIMATED_BEACON_TX_VBYTES = 250;

/** A planned on-chain broadcast presented to the operator for confirmation. */
export type BroadcastPlan = {
  /** The command doing the broadcast. */
  action          : 'update' | 'deactivate';
  /** The DID being updated or deactivated. */
  did             : string;
  /** The network the beacon transaction will land on. */
  network         : NetworkOption;
  /** The beacon service id spending the UTXO. */
  beaconId        : string;
  /** The effective fee rate in sats/vByte. */
  feeRateSatsPerVByte : number;
};

/** Options for {@link confirmBroadcast}. */
export type ConfirmBroadcastOptions = {
  /** Operator pre-confirmation via `--yes` (required for non-interactive use). */
  yes?: boolean;
  /**
   * Interactive prompter; defaults to a terminal prompt when stdin is a TTY.
   * When no prompter is available and `--yes` was not given, confirmation
   * fails closed.
   */
  prompt?: (label: string) => string;
};

/**
 * Requires explicit operator confirmation before an on-chain beacon broadcast.
 * Skipped on regtest (a local, disposable network) and when
 * `--yes` was passed. Otherwise displays the plan, including the estimated
 * absolute fee, and requires a "yes" answer. Non-interactive invocations
 * without `--yes` fail closed with `CONFIRMATION_REQUIRED_ERROR`.
 *
 * @throws {CLIError} `CONFIRMATION_REQUIRED_ERROR` when no confirmation
 * channel is available, or `BROADCAST_ABORTED_ERROR` when the operator
 * declines.
 */
export function confirmBroadcast(plan: BroadcastPlan, options: ConfirmBroadcastOptions = {}): void {
  if (plan.network === 'regtest') return;
  if (options.yes) return;

  const estimatedSats = Math.ceil(plan.feeRateSatsPerVByte * ESTIMATED_BEACON_TX_VBYTES);
  const lines = [
    `About to broadcast an on-chain ${plan.action}:`,
    `  DID:      ${plan.did}`,
    `  Network:  ${plan.network}`,
    `  Beacon:   ${plan.beaconId}`,
    `  Fee:      ~${estimatedSats} sats (${(estimatedSats / 1e8).toFixed(8)} BTC) `
      + `at ${plan.feeRateSatsPerVByte} sat/vB (estimated for a ~${ESTIMATED_BEACON_TX_VBYTES} vB transaction)`,
  ];
  if (plan.action === 'deactivate') {
    lines.push('  WARNING:  deactivation is permanent and cannot be undone.');
  }

  const prompt = options.prompt ?? (process.stdin.isTTY ? ttyPrompt : undefined);
  if (!prompt) {
    throw new CLIError(
      `Refusing to broadcast an on-chain ${plan.action} without confirmation. `
        + 'Re-run with --yes to confirm, or run in a terminal to be prompted.',
      'CONFIRMATION_REQUIRED_ERROR',
      { did: plan.did, network: plan.network },
    );
  }

  const answer = prompt(`${lines.join('\n')}\nType "yes" to broadcast: `).trim().toLowerCase();
  if (answer !== 'yes' && answer !== 'y') {
    throw new CLIError(
      'Broadcast aborted: not confirmed.',
      'BROADCAST_ABORTED_ERROR',
      { did: plan.did },
    );
  }
}

/**
 * Reads one line from the terminal synchronously (canonical mode, echo on).
 * The label goes to stderr so `--output json` on stdout stays machine-clean.
 */
function ttyPrompt(label: string): string {
  process.stderr.write(label);
  const byte = Buffer.alloc(1);
  const bytes: number[] = [];
  for (;;) {
    let read = 0;
    try {
      read = readSync(process.stdin.fd, byte, 0, 1, null);
    } catch {
      break;
    }
    if (read === 0) break;
    const ch = byte[0];
    if (ch === 0x0a || ch === 0x0d) break;
    bytes.push(ch);
  }
  process.stderr.write('\n');
  return Buffer.from(bytes).toString('utf-8');
}
