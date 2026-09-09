import type { DidBtcr2Api } from '@did-btcr2/api';
import type { KeyManager } from '@did-btcr2/key-manager';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { ApiFactory } from '../config.js';
import { CLIError } from '../error.js';
import { parseGenesisSpec, toApiSpec, type GenesisSpecFile } from '../genesis-spec.js';
import { collectGenesisSpec, type WizardKey } from '../genesis-wizard.js';
import { printBeaconFundingHint } from '../hints.js';
import { resolveKeyRef } from '../keystore/resolve-key-ref.js';
import { NETWORK_OPTION_HELP, overridesFromGlobals, resolveNetworkOption, warnProfileNetworkMismatch } from '../network-option.js';
import { formatResult } from '../output.js';
import type { CommandResult, GlobalOptions } from '../types.js';

/** The default path of the genesis document that `genesis build` writes. */
export const DEFAULT_GENESIS_PATH = 'genesis.json';

/**
 * Registers the `genesis` command group. `genesis build` builds the genesis
 * document of an external (`x`) identifier, writes it to a file, and prints
 * the identifier. On a terminal the command asks for the keys, the beacons,
 * and the services. With `--spec <path>` it reads them from a JSON file and
 * asks nothing. The command is offline: it derives the beacon addresses from
 * the keys and opens no Bitcoin connection.
 *
 * The keystore-free `factory` builds the document; the keystore-aware
 * `keystoreFactory` resolves key references and lists the keys for the
 * wizard. Reading a public key never decrypts, so the command never prompts
 * for the passphrase.
 */
export function registerGenesisCommand(
  program         : Command,
  factory         : ApiFactory,
  keystoreFactory : ApiFactory,
  globals         : () => GlobalOptions,
): void {
  const genesis = program
    .command('genesis')
    .description('Build the genesis document of an external identifier (offline).');
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  genesis
    .command('build')
    .description('Build a genesis document, write it to a file, and print the external identifier.')
    .option('-n, --network <network>', NETWORK_OPTION_HELP)
    .option('--spec <path>', 'Path to a JSON spec file with the keys, beacons, and services. Runs without prompts.')
    .option('--out <path>', 'Path of the genesis document to write.', DEFAULT_GENESIS_PATH)
    .option('--force', 'Overwrite an existing --out file.', false)
    .action(async (options: { network?: string; spec?: string; out: string; force: boolean }) => {
      const g = globals();
      const overrides = overridesFromGlobals(g);
      const network = resolveNetworkOption(options.network, overrides);
      warnProfileNetworkMismatch(g, network, overrides);

      // Refuse to overwrite before any question is asked.
      const outPath = resolvePath(options.out);
      if (!options.force && existsSync(outPath)) {
        throw new CLIError(
          `The file ${outPath} exists. Pass --force to overwrite it, or --out <path> for another file.`,
          'INVALID_ARGUMENT_ERROR',
          { out: outPath },
        );
      }

      // The keystore opens only when a key reference or the wizard needs it.
      let keystoreApi: DidBtcr2Api | undefined;
      const kms = (): KeyManager => (keystoreApi ??= keystoreFactory(undefined, overrides)).kms.kms;
      const resolvePublicKey = (ref: string): Uint8Array => kms().getPublicKey(resolveKeyRef(kms(), ref));

      const spec = options.spec !== undefined
        ? await readSpecFile(options.spec)
        : await runWizard(kms);

      const api = factory();
      const document = api.btcr2.buildGenesisDocument(toApiSpec(spec, network, resolvePublicKey));
      // Hash exactly the bytes that the file carries: the parsed form of the
      // pretty-printed JSON, not the document instance.
      const json = `${JSON.stringify(document, null, 2)}\n`;
      const { did, genesisBytes, didDocument } = api.btcr2.createExternalFromDocument(JSON.parse(json), { network });
      await writeFile(outPath, json, { encoding: 'utf-8', flag: options.force ? 'w' : 'wx' });
      const beacons = api.btcr2.getBeacons(didDocument);

      print({
        action : 'genesis-build',
        data   : { did, network, genesisBytes: bytesToHex(genesisBytes), path: outPath, beacons },
      });
      if (!g.quiet && g.output !== 'json') {
        process.stderr.write(
          `Wrote the genesis document to ${outPath}. Keep it: the identifier resolves only with it. `
          + 'Pass --genesis-document <path> to resolve, update, and deactivate, or publish it to a CAS.\n',
        );
        if (beacons.length > 0) printBeaconFundingHint(g, network, beacons[0].address);
      }
    });
}

/** Reads and checks the spec file. */
async function readSpecFile(path: string): Promise<GenesisSpecFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    throw new CLIError(
      'Invalid genesis spec path. Must be a valid path to a JSON file.',
      'INVALID_ARGUMENT_ERROR',
      { spec: path },
    );
  }
  return parseGenesisSpec(parsed, path);
}

/** Runs the wizard on the terminal. Refuses without one. */
async function runWizard(kms: () => KeyManager): Promise<GenesisSpecFile> {
  if (!process.stdin.isTTY) {
    throw new CLIError(
      'No terminal is attached. Pass --spec <path> to build the genesis document without prompts.',
      'INVALID_ARGUMENT_ERROR',
    );
  }
  const store = kms();
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await collectGenesisSpec((question) => rl.question(question), {
      say        : (line) => process.stderr.write(`${line}\n`),
      keys       : listKeys(store),
      resolveKey : (ref) => resolveKeyRef(store, ref),
    });
  } finally {
    rl.close();
  }
}

/** The keys of the keystore in the shape that `key list` prints. */
function listKeys(kms: KeyManager): WizardKey[] {
  const active = kms.activeKeyId;
  return kms.listKeys().map(id => {
    const entry = kms.getEntry(id);
    return {
      keyId       : id,
      fingerprint : id.split(':').pop() ?? id,
      ...(entry.tags?.name && { name: entry.tags.name }),
      active      : id === active,
    };
  });
}
