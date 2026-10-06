import { DidApi } from '@did-btcr2/api';
import type { Command } from 'commander';
import { deriveNetwork, type ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { GENESIS_DOCUMENT_HELP } from '../genesis-document-file.js';
import { IdentifierRecords, withRecordSidecar } from '../identifier-records.js';
import { warnProfileNetworkMismatch } from '../network-option.js';
import { formatResult } from '../output.js';
import { MIN_CONF_HELP, parseMinConf, readResolutionOptions, type ResolutionOptionFlags } from '../resolution-options.js';
import type { GlobalOptions, ResolveCommandOptions } from '../types.js';

/** The offline identifier operations of the api. They need no connection and no key. */
const didApi = new DidApi();

/** The help text of `-i, --identifier` on `resolve`, `update`, `deactivate`, `message sign`, and `message verify`. */
export const IDENTIFIER_REF_HELP = 'a did:btcr2 identifier, or the name of its identifier record';

/**
 * Registers the `resolve` command. The identifier can be the name of a record.
 * If the identifier has a record, the sidecar data of the record joins the
 * resolution options, and the sidecar data of the flags wins (ADR 133).
 */
export function registerResolveCommand(
  program : Command,
  factory : ApiFactory,
  globals : () => GlobalOptions,
): void {
  program
    .command('resolve')
    .alias('read')
    .description('Resolve the DID document of the identifier.')
    .requiredOption('-i, --identifier <identifier>', `The identifier to resolve: ${IDENTIFIER_REF_HELP}`)
    .option('-r, --resolution-options <json>', 'JSON string containing resolution options')
    .option('-p, --resolution-options-path <path>', 'Path to a JSON file containing resolution options')
    .option('--min-conf <n>', MIN_CONF_HELP, parseMinConf)
    .option('--genesis-document <path>', GENESIS_DOCUMENT_HELP)
    .action(async (options: { identifier: string } & ResolutionOptionFlags) => {
      const g = globals();
      const records = IdentifierRecords.forHome(g);
      const identifier = records.resolveRef(options.identifier);
      const parsed = await validateResolveOptions({ ...options, identifier });
      const network = deriveNetwork(parsed.identifier);
      warnProfileNetworkMismatch(g, network, g);
      const api = factory(network, g);
      const resolutionOptions = withRecordSidecar(parsed.options, records.get(identifier));
      const data = await api.resolveDid(parsed.identifier, resolutionOptions);
      const result = { action: 'resolve' as const, data };
      console.log(formatResult(result, g));
    });
}

async function validateResolveOptions(
  options: { identifier: string } & ResolutionOptionFlags,
): Promise<ResolveCommandOptions> {
  // Validate identifier format early
  const components = didApi.decode(options.identifier);
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
