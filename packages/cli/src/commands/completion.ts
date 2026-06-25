import type { Command } from 'commander';
import { CLIError } from '../error.js';
import type { GlobalOptions } from '../types.js';

const COMMANDS = 'create resolve read update deactivate delete key config profile completion';

/** Registers the `completion` command, which prints a shell completion script to stdout. */
export function registerCompletionCommand(program: Command, _globals: () => GlobalOptions): void {
  program
    .command('completion [shell]')
    .description('Print a shell completion script (bash, zsh, or fish) to stdout.')
    .action((shell = 'bash') => {
      console.log(completionScript(shell));
    });
}

/** Returns a completion script for the given shell. */
function completionScript(shell: string): string {
  switch (shell) {
    case 'bash':
      return [
        '# btcr2 bash completion. Install with: eval "$(btcr2 completion bash)"',
        '_btcr2() { COMPREPLY=( $(compgen -W "' + COMMANDS + '" -- "${COMP_WORDS[COMP_CWORD]}") ); }',
        'complete -F _btcr2 btcr2',
      ].join('\n');
    case 'zsh':
      return [
        '# btcr2 zsh completion. Install with: eval "$(btcr2 completion zsh)"',
        '_btcr2() { compadd ' + COMMANDS + ' }',
        'compdef _btcr2 btcr2',
      ].join('\n');
    case 'fish':
      return [
        '# btcr2 fish completion. Save to ~/.config/fish/completions/btcr2.fish',
        'complete -c btcr2 -f -a "' + COMMANDS + '"',
      ].join('\n');
    default:
      throw new CLIError(`Unsupported shell "${shell}". Use bash, zsh, or fish.`, 'INVALID_ARGUMENT_ERROR', { shell });
  }
}
