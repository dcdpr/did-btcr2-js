import { PatchOperation } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { Btcr2DidDocument, DidCreateOptions, ResolutionOptions } from '@did-btcr2/method';
import { DidResolutionResult } from '@web5/dids';

export type NetworkOption = 'bitcoin' | 'testnet3' | 'testnet4' | 'signet' | 'mutinynet' | 'regtest';
export type OutputFormat = 'json' | 'text';

export const SUPPORTED_NETWORKS: NetworkOption[] = [
  'bitcoin', 'testnet3', 'testnet4', 'signet', 'mutinynet', 'regtest'
];

/** Dependency-injection interface for the DID method operations the CLI calls. */
export interface MethodOperations {
  create(
    genesisBytes: Uint8Array,
    options: DidCreateOptions
  ): string;
  resolve(
    identifier: string,
    options?: ResolutionOptions
  ): Promise<DidResolutionResult>;
  update(params: {
    sourceDocument       : Btcr2DidDocument;
    patches              : PatchOperation[];
    sourceVersionId      : number;
    verificationMethodId : string;
    beaconId             : string;
  }): Promise<SignedBTCR2Update>;
}

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
  output  : OutputFormat;
  verbose : boolean;
  quiet   : boolean;
}
