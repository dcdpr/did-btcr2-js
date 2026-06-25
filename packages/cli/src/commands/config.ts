import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CONFIG_SCHEMA_VERSION,
  defaultConfigPath,
  getConfigPath,
  readConfigFile,
  setConfigPath,
  unsetConfigPath,
  writeConfigFile,
} from '../config.js';
import { CLIError } from '../error.js';
import { ensureDir, writeFileAtomic } from '../keystore/atomic.js';
import { formatResult } from '../output.js';
import type { CommandResult, GlobalOptions } from '../types.js';
import { SUPPORTED_NETWORKS } from '../types.js';

/** Registers the `config` command group for reading and writing CLI configuration. */
export function registerConfigCommand(program: Command, globals: () => GlobalOptions): void {
  const config = program.command('config').description('Read and write CLI configuration.');
  const path = (): string => globals().config ?? defaultConfigPath();
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  config
    .command('init')
    .description('Create a default config file with one profile per network.')
    .option('--force', 'Overwrite an existing config file.', false)
    .action((options: { force?: boolean }) => {
      const p = path();
      if (existsSync(p) && !options.force) {
        throw new CLIError(`Config already exists at ${p}. Use --force to overwrite.`, 'INVALID_ARGUMENT_ERROR', { path: p });
      }
      const scaffold = {
        schemaVersion : CONFIG_SCHEMA_VERSION,
        defaults      : { output: 'text' },
        profiles      : Object.fromEntries(SUPPORTED_NETWORKS.map(n => [ n, {} ])),
      };
      ensureDir(dirname(p), 0o700);
      writeFileAtomic(p, `${JSON.stringify(scaffold, null, 2)}\n`, 0o600);
      print({ action: 'config-init', data: { path: p } });
    });

  config
    .command('get [path]')
    .description('Print a value at a dotted path, or the whole config.')
    .action((dotted?: string) => {
      const file = (readConfigFile(path()) ?? {}) as Record<string, unknown>;
      print({ action: 'config-get', data: (dotted ? getConfigPath(file, dotted) : file) ?? null });
    });

  config
    .command('set <path> <value>')
    .description('Set a value at a dotted path. The value is parsed as JSON when valid, else stored as a string.')
    .action((dotted: string, value: string) => {
      writeConfigFile(path(), raw => setConfigPath(raw, dotted, parseValue(value)));
      print({ action: 'config-set', data: { path: dotted } });
    });

  config
    .command('unset <path>')
    .description('Delete a value at a dotted path.')
    .action((dotted: string) => {
      writeConfigFile(path(), raw => unsetConfigPath(raw, dotted));
      print({ action: 'config-unset', data: { path: dotted } });
    });

  config
    .command('list')
    .alias('ls')
    .description('Print the entire config file.')
    .action(() => {
      print({ action: 'config-list', data: readConfigFile(path()) ?? {} });
    });
}

/** Parses a value as JSON when valid, otherwise treats it as a plain string. */
function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
