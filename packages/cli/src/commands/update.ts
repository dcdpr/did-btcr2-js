import type { PatchOperation } from '@did-btcr2/common';
import type { Command } from 'commander';
import type { ApiFactory } from '../config.js';
import { printWatchHint } from '../hints.js';
import { formatResult } from '../output.js';
import type { GlobalOptions } from '../types.js';
import { parseJsonArg, prepareWrite, registerWriteOptions, type WriteFlags } from './write.js';

export function registerUpdateCommand(
  program : Command,
  factory : ApiFactory,
  globals : () => GlobalOptions,
): void {
  const command = program
    .command('update')
    .description('Update a did:btcr2 document.')
    .requiredOption('-i, --identifier <identifier>', 'did:btcr2 identifier to update')
    .requiredOption(
      '-p, --patches <json>',
      'JSON Patch operations as a JSON string array',
      parseJsonArg('--patches'),
    );
  registerWriteOptions(command)
    .action(async (options: WriteFlags & { patches: unknown }) => {
      const g = globals();
      const { network, api, params } = await prepareWrite(options, factory, g);
      // The api resolves the source document if the source pair is absent,
      // derives an omitted verification method and beacon, and publishes to
      // the CAS only under --publish-to-cas auto|always. The returned
      // artifacts (txid, signed update, announcement, proof) are printed for
      // sidecar distribution in every case.
      const data = await api.updateDid({ ...params, patches: options.patches as PatchOperation[] });
      console.log(formatResult({ action: 'update', data }, g));
      printWatchHint(g, network, data.txid);
    });
}
