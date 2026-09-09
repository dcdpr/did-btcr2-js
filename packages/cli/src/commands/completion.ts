import type { Command } from 'commander';
import { CLIError } from '../error.js';
import type { GlobalOptions } from '../types.js';

/**
 * The name of the built-in help command of commander. Commander creates that
 * command at parse time, so `program.commands` does not list it.
 */
const HELP_COMMAND = 'help';

/** Registers the `completion` command, which prints a shell completion script to stdout. */
export function registerCompletionCommand(program: Command, _globals: () => GlobalOptions): void {
  program
    .command('completion [shell]')
    .description('Print a shell completion script (bash, zsh, or fish) to stdout.')
    .action((shell = 'bash') => {
      console.log(completionScript(shell, completionWords(program)));
    });
}

/**
 * Returns the completion word list: the name and the aliases of each registered
 * top-level command, in registration order, then the built-in help command.
 */
function completionWords(program: Command): string[] {
  const words = program.commands.flatMap((command) => [command.name(), ...command.aliases()]);
  return [...words, HELP_COMMAND];
}

/** Returns a completion script for the given shell and word list. */
function completionScript(shell: string, words: string[]): string {
  const list = words.join(' ');
  switch (shell) {
    case 'bash':
      return [
        '# btcr2 bash completion. Install with: eval "$(btcr2 completion bash)"',
        '_btcr2() { COMPREPLY=( $(compgen -W "' + list + '" -- "${COMP_WORDS[COMP_CWORD]}") ); }',
        'complete -F _btcr2 btcr2',
      ].join('\n');
    case 'zsh':
      return [
        '# btcr2 zsh completion. Install with: eval "$(btcr2 completion zsh)"',
        '_btcr2() { compadd ' + list + ' }',
        'compdef _btcr2 btcr2',
      ].join('\n');
    case 'fish':
      return [
        '# btcr2 fish completion. Save to ~/.config/fish/completions/btcr2.fish',
        'complete -c btcr2 -f -a "' + list + '"',
      ].join('\n');
    default:
      throw new CLIError(`Unsupported shell "${shell}". Use bash, zsh, or fish.`, 'INVALID_ARGUMENT_ERROR', { shell });
  }
}
