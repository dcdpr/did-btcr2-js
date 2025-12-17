import { IdentifierTypes, Logger, MethodError, PatchOperation } from '@did-btcr2/common';
import { DidBtcr2, DidDocument, DidResolutionOptions, DidResolutionResult, SignalsMetadata } from '@did-btcr2/method';

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
  options?: DidResolutionOptions;
}

export interface UpdateCommandOptions {
  identifier: string;
  sourceDocument: DidDocument;
  sourceVersionId: number;
  patch: PatchOperation[];
  verificationMethodId: string;
  beaconIds: string[];
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
  | { action: 'update'; metadata: SignalsMetadata; }
  | { action: 'deactivate' | 'delete'; message: string; };

export default class Btcr2Command implements CommandInterface {
  async execute(request: CommandRequest): Promise<CommandResult> {
    const action = request.action;
    switch (action) {
      case 'create': {
        const { type, bytes, network } = request.options;
        const idType = type === 'k' ? IdentifierTypes.KEY : IdentifierTypes.EXTERNAL;
        const genesisBytes = Buffer.from(bytes, 'hex');
        const did = await DidBtcr2.create({ idType, genesisBytes, options: { network } });
        return { action: 'create', did };
      }
      case 'read':
      case 'resolve': {
        const { identifier, options } = request.options;
        const resolution = await DidBtcr2.resolve(identifier, options);
        return { action: request.action, resolution };
      }
      case 'update': {
        const metadata = await DidBtcr2.update(request.options as any);
        return { action: 'update', metadata };
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
