/**
 * Wallet schema + JSON file I/O.
 *
 * Data lives in the user's config directory (outside the repo) so it survives
 * checkout, clone, and clean operations:
 *   - Linux/macOS: $XDG_CONFIG_HOME/did-btcr2-js/wallet/wallet.json
 *                  (default: ~/.config/did-btcr2-js/wallet/wallet.json)
 *   - Windows:     %APPDATA%/did-btcr2-js/wallet/wallet.json
 *
 * No encryption: testnet-only dev tool. Backing up the wallet directory is
 * the operator's responsibility — losing it loses every tracked key.
 *
 * Legacy location: `packages/method/lib/wallet/.wallet/wallet.json`. On first
 * load this file is auto-migrated to the new location if it exists.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Network = 'regtest' | 'mutinynet' | 'signet' | 'testnet4';
export const NETWORKS: ReadonlyArray<Network> = ['regtest', 'mutinynet', 'signet', 'testnet4'];

export type AddressBundle = {
  p2pkh: string;
  p2wpkh: string;
  p2tr: string;
};

export type Key = {
  label: string;
  secretHex: string;
  pubkeyHex: string;
  /** Per-network address derivations. All three address types per network. */
  addresses: Record<Network, AddressBundle>;
  /** If this key backs a test scenario's beacon, link it here. */
  scenarioId: string | null;
  createdAt: string;
  notes?: string;
};

export type Wallet = {
  version: 1;
  /** The default network for status/fund/recover commands; overridable per-command. */
  network: Network;
  /** The single key that receives faucet sats and funds beacons. */
  funding: Key | null;
  /** All registered beacon keys, indexed by label. */
  beacons: Key[];
};

function userConfigDir(): string {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return process.env.APPDATA;
  }
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

export const WALLET_DIR  = join(userConfigDir(), 'did-btcr2-js', 'wallet');
export const WALLET_FILE = join(WALLET_DIR, 'wallet.json');

const HERE = dirname(fileURLToPath(import.meta.url));
const LEGACY_WALLET_FILE = resolvePath(HERE, '.wallet', 'wallet.json');

/**
 * If a wallet exists at the legacy in-repo location but not at the new user
 * config location, move it. Idempotent and safe to call on every load.
 */
function migrateLegacyWallet(): void {
  if (existsSync(WALLET_FILE) || !existsSync(LEGACY_WALLET_FILE)) return;
  mkdirSync(WALLET_DIR, { recursive: true });
  renameSync(LEGACY_WALLET_FILE, WALLET_FILE);
  console.error(`[wallet] migrated ${LEGACY_WALLET_FILE} -> ${WALLET_FILE}`);
}

export function walletExists(): boolean {
  migrateLegacyWallet();
  return existsSync(WALLET_FILE);
}

export function loadWallet(): Wallet {
  migrateLegacyWallet();
  if (!existsSync(WALLET_FILE)) {
    throw new Error(
      `No wallet found at ${WALLET_FILE}. Run \`pnpm wallet init\` first.`,
    );
  }
  return JSON.parse(readFileSync(WALLET_FILE, 'utf-8')) as Wallet;
}

export function saveWallet(wallet: Wallet): void {
  mkdirSync(WALLET_DIR, { recursive: true });
  writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2) + '\n', { mode: 0o600 });
}

export function findBeacon(wallet: Wallet, label: string): Key | undefined {
  return wallet.beacons.find((k) => k.label === label);
}

export function requireBeacon(wallet: Wallet, label: string): Key {
  const k = findBeacon(wallet, label);
  if (!k) {
    throw new Error(`No beacon key with label "${label}". Run \`pnpm wallet list\` to see registered keys.`);
  }
  return k;
}

export function requireFunding(wallet: Wallet): Key {
  if (!wallet.funding) {
    throw new Error('No funding key. Run `pnpm wallet init` first.');
  }
  return wallet.funding;
}
