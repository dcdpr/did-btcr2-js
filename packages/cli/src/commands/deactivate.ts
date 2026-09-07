import type { Command } from 'commander';
import type { ApiFactory } from '../config.js';
import { printWatchHint } from '../hints.js';
import { formatResult } from '../output.js';
import type { GlobalOptions } from '../types.js';
import { prepareWrite, registerWriteOptions, type WriteFlags } from './write.js';

export function registerDeactivateCommand(
  program : Command,
  factory : ApiFactory,
  globals : () => GlobalOptions,
): void {
  const command = program
    .command('deactivate')
    .alias('delete')
    .description('Deactivate the did:btcr2 identifier permanently. This is irreversible.')
    .requiredOption('-i, --identifier <identifier>', 'did:btcr2 identifier to deactivate');
  registerWriteOptions(command)
    .action(async (options: WriteFlags) => {
      const g = globals();
      const { network, api, params } = await prepareWrite(options, factory, g);
      // The api supplies the deactivation patch (ADR 094) and refuses a
      // document that is deactivated already (ADR 100).
      const data = await api.deactivateDid(params);
      console.log(formatResult({ action: 'deactivate', data }, g));
      printWatchHint(g, network, data.txid);
    });
}
