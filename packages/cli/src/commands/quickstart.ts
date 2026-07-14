import { faucetUrl } from '@did-btcr2/api';
import type { Command } from 'commander';
import {
  assertSupportedNetwork,
  readConfiguredDefaultNetwork,
  runDoctor,
  type DoctorReport,
} from '../config.js';
import { CLIError } from '../error.js';
import { keystoreVerifierId } from '../keystore/file-key-store.js';
import { ENV_KEYSTORE_TTL, readSessionStatus } from '../keystore/session.js';
import { formatResult } from '../output.js';
import { defaultSessionPath } from '../paths.js';
import type { CommandResult, GlobalOptions, NetworkOption } from '../types.js';
import { runInit, type RunInitResult } from './init.js';
import { resolveSessionTtl, unlockSession } from './keystore.js';

/** The opinionated default network for `quickstart`: zero local infra, a free faucet, 30s blocks. */
const QUICKSTART_DEFAULT_NETWORK: NetworkOption = 'mutinynet';

/** The session sub-object reported in the quickstart envelope. */
type SessionReport = { expiresAt: number; ttlSeconds: number };

/**
 * Registers the top-level `btcr2 quickstart` (ADR 083): a one-command onboarding
 * that COMPOSES the existing primitives - the {@link runInit} scaffold, the
 * network record, the optional {@link unlockSession} cache, and the advisory
 * {@link runDoctor} probe - into a single step for a workshop follow-along.
 * Reimplements nothing; the ADR 080/081 keystore and session guarantees hold by
 * construction.
 */
export function registerQuickstartCommand(program: Command, globals: () => GlobalOptions): void {
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  program
    .command('quickstart')
    .description('One-command onboarding: create the home + config + keystore, record the network, and (optionally) cache the session and probe endpoints.')
    .option(
      '-n, --network <network>',
      'Bitcoin network to set up <bitcoin|testnet3|testnet4|signet|mutinynet|regtest> (default: mutinynet)',
    )
    .option('--dev', 'Establish an UNENCRYPTED dev keystore: plaintext keys, no passphrase. Testnet only.', false)
    .option('--unlock', 'Cache the passphrase for the session so later commands do not re-prompt (ADR 081).', false)
    .option('--ttl <duration>', `Session lifetime with --unlock: bare seconds or an s/m/h suffix (default 1h, max 24h). Also $${ENV_KEYSTORE_TTL}.`)
    .option('--no-doctor', 'Skip the endpoint reachability probe.')
    .option('--allow-mainnet', 'Permit -n bitcoin (records mainnet as the default; dev keystores are still refused).', false)
    .option('--force', 'Re-create the config even if it already exists (never the keystore).', false)
    .action(async (options: {
      network?      : string;
      dev?          : boolean;
      unlock?       : boolean;
      ttl?          : string;
      doctor        : boolean; // commander sets false for --no-doctor, true otherwise
      allowMainnet? : boolean;
      force?        : boolean;
    }) => {
      const g = globals();
      const explicit = options.network ? assertSupportedNetwork(options.network) : undefined;
      // The network quickstart will operate on, computed BEFORE any write so the
      // mainnet guard sees the real target: explicit -n, else an existing
      // defaults.network, else the mutinynet default. runInit resolves to the
      // same value.
      const network = explicit ?? readConfiguredDefaultNetwork(g) ?? QUICKSTART_DEFAULT_NETWORK;

      // Mainnet is guarded before any files are written (ADR 083). A dev keystore
      // never operates on mainnet; an encrypted mainnet setup needs the explicit
      // opt-in that also gates the session-unlock mainnet suspension.
      if (network === 'bitcoin') {
        if (options.dev) {
          throw new CLIError(
            'Refusing to quickstart a mainnet (bitcoin) dev keystore: dev keystores store keys in plaintext '
            + 'and never operate on mainnet. Drop --dev, or choose a testnet with -n.',
            'MAINNET_QUICKSTART_REFUSED_ERROR',
            { network },
          );
        }
        if (!options.allowMainnet) {
          throw new CLIError(
            'Refusing to quickstart on mainnet (bitcoin) without --allow-mainnet. Pass --allow-mainnet to '
            + 'record mainnet as the default, or choose a testnet with -n (the default is mutinynet).',
            'MAINNET_QUICKSTART_REFUSED_ERROR',
            { network },
          );
        }
      }

      // 1-2. Scaffold and record the network. An explicit -n always writes; a
      // merely-defaulted mutinynet writes only when defaults.network is unset.
      const init = runInit(g, {
        dev                          : options.dev,
        force                        : options.force,
        network                      : explicit,
        fallbackNetwork              : explicit ? undefined : QUICKSTART_DEFAULT_NETWORK,
        captureEstablishedPassphrase : !!options.unlock && !options.dev,
      });

      // 3. Optionally cache the session (ADR 081 opt-in; never on a dev keystore).
      let unlocked = false;
      let session: SessionReport | undefined;
      if (options.unlock && !options.dev) {
        const outcome = cacheSession(g, init, options.ttl, !!options.allowMainnet);
        unlocked = outcome.unlocked;
        session = outcome.session;
      }

      // 4. Advisory endpoint probe (on by default; a failed probe warns, exit 0).
      let doctor: DoctorReport | undefined;
      if (options.doctor) {
        doctor = await runDoctor(init.network, g);
      }

      print({
        action : 'quickstart',
        data   : {
          home       : init.home,
          config     : init.config,
          keystore   : init.keystore,
          network    : init.network,
          created    : init.created,
          protection : init.protection,
          unlocked,
          ...(session ? { session } : {}),
          ...(doctor ? { doctor } : {}),
        },
      });

      if (!g.quiet && g.output !== 'json') {
        printNextSteps(init, unlocked, session, doctor);
      }
    });
}

/**
 * Caches the session for `quickstart --unlock`. On a fresh keystore, reuses the
 * establish-time confirmed passphrase (no second prompt). On an existing keystore
 * with a live matching session, skips (idempotent re-run). Otherwise acquires and
 * verifies the passphrase. In a non-interactive context with no passphrase source
 * on an existing keystore, the step is a non-fatal skip (warn, `unlocked: false`),
 * so `quickstart` still exits 0 (ADR 083).
 */
function cacheSession(
  g            : GlobalOptions,
  init         : RunInitResult,
  ttlFlag      : string | undefined,
  allowMainnet : boolean,
): { unlocked: boolean; session?: SessionReport } {
  const ttlMs = resolveSessionTtl(ttlFlag);
  const freshlyEstablished = init.created.includes('keystore');

  // Existing encrypted keystore already unlocked: report it and skip re-writing.
  if (!freshlyEstablished) {
    const status = readSessionStatus(defaultSessionPath(g), init.keystore, keystoreVerifierId(init.keystore));
    if (status.active && status.expiresAt !== undefined) {
      return { unlocked: true, session: { expiresAt: status.expiresAt, ttlSeconds: status.secondsRemaining ?? 0 } };
    }
  }

  try {
    const written = unlockSession({
      g,
      keystorePath : init.keystore,
      network      : init.network,
      allowMainnet,
      ttlMs,
      // Reuse the establish-time passphrase on a fresh keystore: no second prompt.
      passphrase   : freshlyEstablished ? init.establishedPassphrase : undefined,
    });
    return { unlocked: true, session: { expiresAt: written.expiresAt, ttlSeconds: written.ttlSeconds } };
  } catch (error) {
    // On an EXISTING keystore with no passphrase source and no terminal, caching
    // is a non-fatal skip: the scaffold already succeeded (ADR 083). A fresh
    // keystore cannot reach here (its passphrase was just captured), and an
    // interactive wrong passphrase still propagates.
    const type = (error as { type?: string }).type;
    if (!freshlyEstablished && !process.stdin.isTTY && type === 'PASSPHRASE_REQUIRED_ERROR') {
      if (!g.quiet) {
        process.stderr.write(
          'note: no passphrase source and no terminal; skipped caching the session. '
          + 'Run "btcr2 keystore unlock" later to cache it.\n',
        );
      }
      return { unlocked: false };
    }
    throw error;
  }
}

/** Prints the text-mode next-step hints after quickstart (ADR 082/083). */
function printNextSteps(
  init     : RunInitResult,
  unlocked : boolean,
  session  : SessionReport | undefined,
  doctor   : DoctorReport | undefined,
): void {
  const lines: string[] = [`btcr2 home ready at ${init.home} on ${init.network}.`];
  if (unlocked && session) {
    lines.push(`Session cached until ${new Date(session.expiresAt).toISOString()}; signing will not re-prompt until it expires.`);
  }
  if (init.protection === 'dev') {
    lines.push('Dev keystore: keys are stored in plaintext; mainnet operations are refused.');
  }
  if (doctor && doctor.checks.some((c) => !c.ok)) {
    lines.push('Warning: one or more endpoints were unreachable (see the doctor report). Re-run "btcr2 config doctor" for detail.');
  }
  lines.push('Next: btcr2 key generate --name demo --set-active');
  const faucet = faucetUrl(init.network);
  if (faucet) lines.push(`Faucet (fund your beacon after "btcr2 create"): ${faucet}`);
  process.stderr.write(`${lines.join('\n')}\n`);
}
