import { Identifier } from '@did-btcr2/api';
import type { Command } from 'commander';
import { deriveNetwork, type ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { GENESIS_DOCUMENT_HELP } from '../genesis-document-file.js';
import { formatResult } from '../output.js';
import { MIN_CONF_HELP, parseMinConf, readResolutionOptions, type ResolutionOptionFlags } from '../resolution-options.js';
import type { GlobalOptions, ResolveCommandOptions } from '../types.js';

export function registerResolveCommand(
  program : Command,
  factory : ApiFactory,
  globals : () => GlobalOptions,
): void {
  program
    .command('resolve')
    .alias('read')
    .description('Resolve the DID document of the identifier.')
    .requiredOption('-i, --identifier <identifier>', 'did:btcr2 identifier')
    .option('-r, --resolution-options <json>', 'JSON string containing resolution options')
    .option('-p, --resolution-options-path <path>', 'Path to a JSON file containing resolution options')
    .option('--min-conf <n>', MIN_CONF_HELP, parseMinConf)
    .option('--genesis-document <path>', GENESIS_DOCUMENT_HELP)
    .action(async (options: { identifier: string } & ResolutionOptionFlags) => {
      const parsed = await validateResolveOptions(options);
      const network = deriveNetwork(parsed.identifier);
      const api = factory(network, globals());
      const data = await api.resolveDid(parsed.identifier, parsed.options);
      const result = { action: 'resolve' as const, data };
      console.log(formatResult(result, globals()));
    });
}

async function validateResolveOptions(
  options: { identifier: string } & ResolutionOptionFlags,
): Promise<ResolveCommandOptions> {
  // Validate identifier format early
  const components = Identifier.decode(options.identifier);
  assertGenesisDocumentApplies(options, components.hrp);
  const resolutionOptions = await readResolutionOptions(options);
  return { identifier: options.identifier, options: resolutionOptions };
}

/**
 * Refuses `--genesis-document` for a KEY identifier before the file is read.
 * A KEY identifier has no genesis document; the resolver would ignore the
 * file in silence. `resolve`, `update`, and `deactivate` share the check.
 */
export function assertGenesisDocumentApplies(flags: ResolutionOptionFlags, hrp: string): void {
  if (flags.genesisDocument !== undefined && hrp === 'k') {
    throw new CLIError(
      '--genesis-document applies only to external identifiers (x).',
      'INVALID_ARGUMENT_ERROR',
      { genesisDocument: flags.genesisDocument },
    );
  }
}
