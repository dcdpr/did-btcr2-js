import { IdentifierTypes, Logger, MethodError, PatchOperation } from '@did-btcr2/common';
import { SignedBTCR2Update } from '@did-btcr2/cryptosuite';
import { Btcr2DidDocument, DidBtcr2, ResolutionOptions } from '@did-btcr2/method';
import { DidResolutionResult } from '@web5/dids';

export type NetworkOption = 'bitcoin' | 'testnet3' | 'testnet4' | 'signet' | 'mutinynet' | 'regtest';

export interface CommandInterface {
  execute(request: CommandRequest): Promise<CommandResult>;
}

export interface CreateCommandOptions {
  type: 'k' | 'x';
  bytes: string;
  network: NetworkOption;
}

export interface ResolveCommandOptions {
  identifier: string;
  options?: ResolutionOptions;
}

export interface UpdateCommandOptions {
  sourceDocument: Btcr2DidDocument;
  sourceVersionId: number;
  patches: PatchOperation[];
  verificationMethodId: string;
  beaconId: string;
}
export interface DeactivateCommandOptions {
  // Placeholder for future deactivate payload once implemented.
}

export type CommandRequest =
  | { action: 'create'; options: CreateCommandOptions; }
  | { action: 'resolve' | 'read'; options: ResolveCommandOptions; }
  | { action: 'update'; options: UpdateCommandOptions; }
  | { action: 'deactivate' | 'delete'; options: DeactivateCommandOptions; };

export type CommandResult =
  | { action: 'create'; did: string; }
  | { action: 'resolve' | 'read'; resolution: DidResolutionResult; }
  | { action: 'update'; signed: SignedBTCR2Update; }
  | { action: 'deactivate' | 'delete'; message: string; };

export default class Btcr2Command implements CommandInterface {
  async execute(request: CommandRequest): Promise<CommandResult> {
    const action = request.action;
    switch (action) {
      case 'create': {
        const { type, bytes, network } = request.options;
        const idType = type === 'k' ? IdentifierTypes.KEY : IdentifierTypes.EXTERNAL;
        const genesisBytes = Buffer.from(bytes, 'hex');
        const did = DidBtcr2.create(genesisBytes, { idType, network });
        return { action: 'create', did };
      }
      case 'read':
      case 'resolve': {
        const { identifier, options } = request.options;
        const resolution = await DidBtcr2.resolve(identifier, options);
        return { action: request.action, resolution };
      }
      case 'update': {
        const signed = await DidBtcr2.update(request.options);
        return { action: 'update', signed };
      }
      case 'delete':
      case 'deactivate': {
        Logger.warn('// TODO: Update once DidBtcr2.deactivate implemented');
        return { action: 'deactivate', message: 'Deactivate not yet implemented' };
      }
      default:{
        throw new MethodError(`Invalid command: ${action}`, 'INVALID_COMMAND');
      }
    }
  }
}
