import type { Command } from 'commander';
import { defaultConfigPath, readConfigFile, writeConfigFile } from '../config.js';
import { CLIError } from '../error.js';
import { formatResult, redactSecrets } from '../output.js';
import type { CommandResult, GlobalOptions } from '../types.js';

/** Registers the `profile` command group for managing configuration profiles. */
export function registerProfileCommand(program: Command, globals: () => GlobalOptions): void {
  const profile = program.command('profile').description('Manage configuration profiles.');
  const path = (): string => globals().config ?? defaultConfigPath(globals());
  const print = (result: CommandResult): void => console.log(formatResult(result, globals()));

  profile
    .command('add <name>')
    .description('Add an empty profile.')
    .action((name: string) => {
      writeConfigFile(path(), raw => {
        if (raw.profiles === undefined || raw.profiles === null) raw.profiles = {};
        const profiles = raw.profiles as Record<string, unknown>;
        if (profiles[name]) throw new CLIError(`Profile "${name}" already exists.`, 'INVALID_ARGUMENT_ERROR', { name });
        profiles[name] = {};
      });
      print({ action: 'profile-add', data: { profile: name } });
    });

  profile
    .command('use <name>')
    .description('Set the active profile (writes defaults.profile).')
    .action((name: string) => {
      writeConfigFile(path(), raw => {
        if (raw.defaults === undefined || raw.defaults === null) raw.defaults = {};
        (raw.defaults as Record<string, unknown>).profile = name;
      });
      print({ action: 'profile-use', data: { profile: name } });
    });

  profile
    .command('show [name]')
    .description('Show a profile (defaults to the active profile).')
    .option('--show-secrets', 'Reveal secret values (RPC password, etc.) instead of redacting them.', false)
    .action((name: string | undefined, opts: { showSecrets?: boolean }) => {
      const file = readConfigFile(path()) ?? {};
      const target = name ?? file.defaults?.profile;
      if (!target) {
        throw new CLIError('No profile specified and no active profile is set.', 'INVALID_ARGUMENT_ERROR');
      }
      const data = file.profiles?.[target];
      if (!data) {
        throw new CLIError(`Profile "${target}" not found.`, 'INVALID_ARGUMENT_ERROR', { profile: target });
      }
      const payload = { profile: target, ...data };
      print({ action: 'profile-show', data: opts.showSecrets ? payload : redactSecrets(payload) });
    });

  profile
    .command('remove <name>')
    .alias('rm')
    .description('Remove a profile.')
    .action((name: string) => {
      writeConfigFile(path(), raw => {
        const profiles = raw.profiles as Record<string, unknown> | undefined;
        if (!profiles?.[name]) throw new CLIError(`Profile "${name}" not found.`, 'INVALID_ARGUMENT_ERROR', { name });
        delete profiles[name];
      });
      print({ action: 'profile-remove', data: { profile: name } });
    });
}
