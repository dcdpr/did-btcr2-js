import type { DidUpdateResult } from '@did-btcr2/api';
import type { PatchOperation } from '@did-btcr2/common';
import type { Btcr2DidDocument, ResolutionOptions } from '@did-btcr2/method';
import type { DidResolutionResult } from '@web5/dids';
import type { DoctorReport, EffectiveConfig } from './config.js';
import type { ConfigIssue } from './config-schema.js';

export type NetworkOption = 'bitcoin' | 'testnet3' | 'testnet4' | 'signet' | 'mutinynet' | 'regtest';
export type OutputFormat = 'json' | 'text';

/**
 * How a keystore protects its secrets, as reported by `keystore status` and
 * `btcr2 init`: `encrypted` (passphrase-sealed), `dev` (plaintext, testnet-only),
 * or `absent` (no keystore file yet).
 */
export type KeystoreProtectionLabel = 'encrypted' | 'dev' | 'absent';

export const SUPPORTED_NETWORKS: NetworkOption[] = [
  'bitcoin', 'testnet3', 'testnet4', 'signet', 'mutinynet', 'regtest'
];

/**
 * Normalizes a blank value (empty or whitespace-only) to `undefined`, so a
 * blank at any precedence layer defers to the next layer instead of masking it.
 * A non-blank value is returned unchanged. This mirrors the `|| undefined`
 * treatment the environment layer already applies in `readEnvOverrides`.
 */
export function blankToUndef(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim() === '' ? undefined : value;
}

export interface ResolveCommandOptions {
  identifier : string;
  options?   : ResolutionOptions;
}

export interface UpdateCommandOptions {
  sourceDocument       : Btcr2DidDocument;
  patches              : PatchOperation[];
  sourceVersionId      : number;
  verificationMethodId : string;
  beaconId             : string;
}

export type CommandResult =
  | { action: 'create'; data: string; keyId?: string; publicKey?: string }
  | { action: 'resolve'; data: DidResolutionResult }
  | { action: 'update'; data: DidUpdateResult }
  | { action: 'deactivate'; data: DidUpdateResult }
  | { action: 'key-generate'; data: { keyId: string; publicKey: string; active: boolean } }
  | { action: 'key-list'; data: Array<{ keyId: string; fingerprint: string; name?: string; active: boolean }> }
  | { action: 'key-show'; data: { keyId: string; publicKey: string; tags?: Record<string, string> } }
  | { action: 'key-import'; data: { keyId: string; publicKey: string; watchOnly: boolean; active: boolean } }
  | { action: 'key-export'; data: { keyId: string; publicKey?: string; secretWrittenTo?: string } }
  | { action: 'key-delete'; data: { keyId: string; deleted: true } }
  | { action: 'key-use'; data: { keyId: string; active: true } }
  | { action: 'init'; data: { home: string; config: string; keystore: string; created: string[]; protection: KeystoreProtectionLabel } }
  | { action: 'config-init'; data: { path: string } }
  | { action: 'config-get'; data: unknown }
  | { action: 'config-set'; data: { path: string } }
  | { action: 'config-unset'; data: { path: string } }
  | { action: 'config-list'; data: unknown }
  | { action: 'config-validate'; data: { ok: boolean; issues: ConfigIssue[] } }
  | { action: 'config-effective'; data: EffectiveConfig }
  | { action: 'config-path'; data: { home: string; config: string; keystore: string } }
  | { action: 'config-doctor'; data: DoctorReport }
  | { action: 'keystore-init'; data: { path: string; protection: 'encrypted' | 'dev' } }
  | { action: 'keystore-status'; data: { path: string; protection: KeystoreProtectionLabel; established: boolean; keyCount: number; active: string | undefined } }
  | { action: 'keystore-change-passphrase'; data: { path: string; rekeyed: number } }
  | { action: 'profile-add'; data: { profile: string } }
  | { action: 'profile-use'; data: { profile: string } }
  | { action: 'profile-show'; data: unknown }
  | { action: 'profile-remove'; data: { profile: string } };

export interface GlobalOptions {
  output         : OutputFormat;
  verbose        : boolean;
  quiet          : boolean;
  home?          : string;
  config?        : string;
  profile?       : string;
  btcRest?       : string;
  btcRpcUrl?     : string;
  btcRpcUser?    : string;
  btcRpcPass?    : string;
  casGateway?    : string;
  casRpcUrl?     : string;
  btcTimeout?    : string;
  casTimeout?    : string;
  btcRestHeader? : string[];
  btcRpcWallet?  : string;
  btcRpcHeader?  : string[];
  keystore?      : string;
  passphraseFile?: string;
  signingKey?    : string;
}
