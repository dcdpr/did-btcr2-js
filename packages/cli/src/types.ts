import type { PatchOperation } from '@did-btcr2/common';
import type { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import type { Btcr2DidDocument, ResolutionOptions } from '@did-btcr2/method';
import type { DidResolutionResult } from '@web5/dids';

export type NetworkOption = 'bitcoin' | 'testnet3' | 'testnet4' | 'signet' | 'mutinynet' | 'regtest';
export type OutputFormat = 'json' | 'text';

export const SUPPORTED_NETWORKS: NetworkOption[] = [
  'bitcoin', 'testnet3', 'testnet4', 'signet', 'mutinynet', 'regtest'
];

export interface CreateCommandOptions {
  type    : 'k' | 'x';
  bytes   : string;
  network : NetworkOption;
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
  | { action: 'create'; data: string }
  | { action: 'resolve'; data: DidResolutionResult }
  | { action: 'update'; data: SignedBTCR2Update }
  | { action: 'deactivate'; data: SignedBTCR2Update };

export interface GlobalOptions {
  output     : OutputFormat;
  verbose    : boolean;
  quiet      : boolean;
  config?    : string;
  profile?   : string;
  btcRest?   : string;
  btcRpcUrl? : string;
  btcRpcUser?: string;
  btcRpcPass?: string;
  casGateway?: string;
}
