
import { MethodError, Logger } from '@did-btcr2/common';
import { DidBtcr2 } from '@did-btcr2/method';
import { ICommand } from './cli.js';

export default class CRUD implements ICommand {
  async execute({ options, action }: { options?: any; action?: string }): Promise<void> {
    try {
      switch (action) {
        case 'create':
          await DidBtcr2.create(options);
          break;
        case 'read':
        case 'resolve':
          await DidBtcr2.resolve(options);
          break;
        case 'update':
          await DidBtcr2.update(options);
          break;
        case 'delete':
        case 'deactivate':
          // await DidBtcr2.deactivate(options);
          Logger.warn('// TODO: Update once DidBtcr2.deactivate implemented');
          break;
        default:
          throw new MethodError(`Invalid command: ${action}`, 'INVALID_COMMAND');
      }
    } catch (error: any) {
      console.error(error.message);
    }
  }
}
