import type { Command } from 'commander';
import type { ApiFactory } from '../config.js';
import { printWatchHint } from '../hints.js';
import { changeFromUpdate, recordAfterWork } from '../identifier-records.js';
import { formatResult } from '../output.js';
import type { GlobalOptions } from '../types.js';
import { IDENTIFIER_REF_HELP } from './resolve.js';
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
    .requiredOption('-i, --identifier <identifier>', `The identifier to deactivate: ${IDENTIFIER_REF_HELP}`);
  registerWriteOptions(command)
    .action(async (options: WriteFlags) => {
      const g = globals();
      const { identifier, network, api, params, keyId, records } = await prepareWrite(options, factory, g);
      // The api supplies the deactivation patch (ADR 094) and refuses a
      // document that is deactivated already (ADR 100).
      const data = await api.deactivateDid(params.source, params.signer, params.options);
      console.log(formatResult({ action: 'deactivate', data }, g));
      // The record keeps the signing key, the transaction, and the sidecar data
      // for the next resolution (ADR 133).
      recordAfterWork(records, identifier, () => ({
        ...changeFromUpdate(data, keyId, params.options.resolutionOptions?.sidecar),
        deactivated : true,
      }));
      printWatchHint(g, network, data.txid);
    });
}
