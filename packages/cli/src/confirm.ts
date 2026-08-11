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

/** A built on-chain broadcast presented to the operator for confirmation. */
export type BroadcastPlan = {
  /** The command doing the broadcast. */
  action          : 'update' | 'deactivate';
  /** The DID being updated or deactivated. */
  did             : string;
  /** The network the beacon transaction will land on. */
  network         : NetworkOption;
  /** The beacon service id spending the UTXO. */
  beaconId        : string;
  /** The exact fee (sats) the built beacon transaction pays. */
  feeSats         : bigint;
  /** The vsize the fee was computed from; the signed transaction is this or smaller. */
  vsize           : number;
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
 * `--yes` was passed. Otherwise displays the plan, including the exact
 * absolute fee of the built transaction, and requires a "yes" answer.
 * Non-interactive invocations without `--yes` fail closed with
 * `CONFIRMATION_REQUIRED_ERROR`.
 *
 * @throws {CLIError} `CONFIRMATION_REQUIRED_ERROR` when no confirmation
 * channel is available, or `BROADCAST_ABORTED_ERROR` when the operator
 * declines.
 */
export function confirmBroadcast(plan: BroadcastPlan, options: ConfirmBroadcastOptions = {}): void {
  if (plan.network === 'regtest') return;
  if (options.yes) return;

  const feeSats = plan.feeSats;
  const lines = [
    `About to broadcast an on-chain ${plan.action}:`,
    `  DID:      ${plan.did}`,
    `  Network:  ${plan.network}`,
    `  Beacon:   ${plan.beaconId}`,
    `  Fee:      ${feeSats} sats (${(Number(feeSats) / 1e8).toFixed(8)} BTC) `
      + `at ${plan.feeRateSatsPerVByte} sat/vB for a ${plan.vsize} vB transaction `
      + '(exact fee of the built transaction)',
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
 * Adapts {@link confirmBroadcast} to the confirmation callback the SDK update
 * flow invokes once the beacon transaction is built: the returned function
 * merges the built transaction's exact fee and size into the plan and confirms
 * it. This is the callback `update`/`deactivate` hand to `api.btcr2.update`.
 */
export function broadcastConfirmer(
  base    : Omit<BroadcastPlan, 'feeSats' | 'vsize'>,
  options : ConfirmBroadcastOptions = {},
): (tx: { feeSats: bigint; vsize: number }) => void {
  return (tx) => confirmBroadcast({ ...base, feeSats: tx.feeSats, vsize: tx.vsize }, options);
}

/**
 * A 4-byte shared buffer used only as an {@link Atomics.wait} target. It lets
 * {@link ttyPrompt} block briefly on an empty non-blocking TTY instead of
 * busy-spinning. It is never written to, so the wait always times out.
 */
const IDLE_WAIT = new Int32Array(new SharedArrayBuffer(4));

/**
 * Milliseconds to block on each empty read. Imperceptible to a typist yet long
 * enough that an open prompt sits idle rather than pegging a CPU core.
 */
const IDLE_POLL_MS = 20;

/**
 * Hard cap on the total time {@link ttyPrompt} spends waiting for input that
 * never arrives. Referencing `process.stdin` puts fd 0 in non-blocking mode,
 * so an idle TTY reports EAGAIN instead of blocking; without a cap, a pty with
 * no input attached (e.g. `docker run -t` without `-i`) would spin forever.
 * On expiry the prompt returns the answer accumulated so far (usually empty),
 * which the confirmation gate treats as a decline.
 */
const MAX_IDLE_MS = 300_000;

/** I/O seams for {@link ttyPrompt}, injectable for tests. */
export type TtyPromptIo = {
  /** File descriptor to read; defaults to stdin's. */
  fd?: number;
  /** Byte reader; defaults to `fs.readSync`. */
  read?: typeof readSync;
  /** Label writer; defaults to stderr. */
  write?: (text: string) => void;
  /** Idle waiter; defaults to a brief {@link Atomics.wait}. */
  wait?: (ms: number) => void;
  /** Idle poll interval in ms; defaults to {@link IDLE_POLL_MS}. */
  pollMs?: number;
  /** Total idle-wait cap in ms; defaults to {@link MAX_IDLE_MS}. */
  maxIdleMs?: number;
};

/**
 * Reads one line from the terminal synchronously (canonical mode, echo on).
 * The label goes to stderr so `--output json` on stdout stays machine-clean.
 *
 * Because fd 0 is non-blocking once `process.stdin` is referenced, a read on an
 * idle TTY throws EAGAIN: that case waits briefly and retries (bounded by
 * `maxIdleMs`) instead of mistaking "no key pressed yet" for an empty answer.
 * EOF (read of 0) ends the line; any other read error propagates rather than
 * being converted into an empty answer.
 */
export function ttyPrompt(label: string, io: TtyPromptIo = {}): string {
  const write = io.write ?? ((text: string) => process.stderr.write(text));
  const fd = io.fd ?? process.stdin.fd;
  const doRead = io.read ?? readSync;
  const wait = io.wait ?? ((ms: number) => Atomics.wait(IDLE_WAIT, 0, 0, ms));
  const pollMs = io.pollMs ?? IDLE_POLL_MS;
  const maxIdleMs = io.maxIdleMs ?? MAX_IDLE_MS;
  write(label);
  const byte = Buffer.alloc(1);
  const bytes: number[] = [];
  let idleMs = 0;
  for (;;) {
    let read = 0;
    try {
      read = doRead(fd, byte, 0, 1, null);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'EAGAIN') {
        idleMs += pollMs;
        if (idleMs > maxIdleMs) break;
        wait(pollMs);
        continue;
      }
      if (code === 'EOF') break;
      throw error;
    }
    if (read === 0) break;
    const ch = byte[0];
    if (ch === 0x0a || ch === 0x0d) break;
    bytes.push(ch);
  }
  write('\n');
  return Buffer.from(bytes).toString('utf-8');
}
