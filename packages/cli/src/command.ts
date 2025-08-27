import { IdentifierTypes, Logger, MethodError } from '@did-btcr2/common';
import { DidBtcr2, DidResolutionOptions } from '@did-btcr2/method';

export interface CommandInterface {
  execute(params: { options?: any; action?: string }): Promise<void>;
}

interface ExecuteParams {
  options?: any;
  action?: string
}

export default class Btcr2Command implements CommandInterface {
  async execute({ options, action }: ExecuteParams): Promise<void> {
    try {
      switch (action) {
        case 'create':{
          const { type, bytes } = options as { type: string; bytes: string };
          const idType = type === 'k' ? IdentifierTypes.KEY : IdentifierTypes.EXTERNAL;
          const genesisBytes = Buffer.from(bytes, 'hex').toArray().toUint8Array();
          const did = await DidBtcr2.create({ idType, genesisBytes });
          console.log(did);
          break;
        }
        case 'read':
        case 'resolve': {
          const { identifier, options: resolutionOptions } = options as DidResolutionOptions;
          const resolutionResult = await DidBtcr2.resolve(identifier, resolutionOptions);
          console.log(JSON.stringify(resolutionResult, null, 2));
          break;
        }
        case 'update': {
          const update = await DidBtcr2.update(options);
          console.log(JSON.stringify(update, null, 2));
          break;
        }
        case 'delete':
        case 'deactivate':
          // await DidBtcr2.deactivate(options);
          Logger.warn('// TODO: Update once DidBtcr2.deactivate implemented');
          break;
        default:
          throw new MethodError(`Invalid command: ${action}`, 'INVALID_COMMAND');
      }
    } catch (error: any) {
      console.error(error);
    }
  }
}
