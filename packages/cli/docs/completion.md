# btcr2 completion

Prints a static shell completion script for the `btcr2` binary on stdout. The script completes the top-level command names only: no subcommands, no flags, no dynamic values. Use it once per shell setup: evaluate it in your shell rc file (bash, zsh), or save it in the fish completions directory. The command is offline and has no side effect: it reads no keystore, opens no network connection, and writes nothing to disk.

## Synopsis

```
btcr2 completion [options] [shell]

btcr2 completion            # bash (the default)
btcr2 completion bash
btcr2 completion zsh
btcr2 completion fish
```

## Options

There are no subcommands. The one argument selects the target shell.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `[shell]` (the argument) | `bash` \| `zsh` \| `fish` | `bash` | The shell dialect of the completion script. Another value fails with `Unsupported shell "<shell>". Use bash, zsh, or fish.` on stderr and exit code 1. |
| `-h, --help` | none | n/a | Print the help of the command and exit. |

### The script per shell

The word list is the same for the three shells:

```
create resolve read update deactivate delete identifier genesis key config profile completion
```

- `bash`: defines a `_btcr2` function with `compgen -W` and registers it with `complete -F _btcr2 btcr2`. The header comment says: install with `eval "$(btcr2 completion bash)"`.
- `zsh`: defines a `_btcr2` function with `compadd` and registers it with `compdef _btcr2 btcr2`. The header comment says: install with `eval "$(btcr2 completion zsh)"`.
- `fish`: one `complete -c btcr2 -f -a "..."` line. The header comment says: save it as `~/.config/fish/completions/btcr2.fish`.

### Known limitations of the word list

The list is a constant in `src/commands/completion.ts`. The CLI does not derive it from the registered command tree. Two consequences, both confirmed against the source:

- The list includes `read` and `delete`. They are the registered aliases of `resolve` and `deactivate`.
- The list omits `init`, `quickstart`, `keystore`, and the built-in `help` command, although the CLI registers them. So they do not complete. A subcommand (for example `key list`, `profile add`, `keystore unlock`) and a flag never complete either.

## Environment and configuration

The `completion` action itself reads no environment variable, no config key, no profile, and no keystore, passphrase, or session state. Its output is the same bytes, whatever the configuration.

One shared mechanism still runs before the action. The program-level `preAction` hook resolves the effective output format (the precedence: the `-o/--output` flag, then the `BTCR2_OUTPUT` environment variable, then config `defaults.output`, then the built-in `text`). For that, the hook can read the config file at `--config <path>`, else `<home>/config.json`. The home is the `--home` flag, then the `BTCR2_HOME` environment variable, then the platform default. The platform default is `~/.btcr2` on Linux and macOS. On Windows it is `%LOCALAPPDATA%\btcr2`, else `%APPDATA%\btcr2`, else `<user profile>\btcr2`. This read is best effort: a missing or malformed config file never blocks the command. `completion` then ignores the resolved format. It always prints the plain script on stdout. There is no JSON output mode for this command. `-o json` has no effect on it.

No network hint (a faucet or explorer URL) applies: the command has no network.

## Global flags

See the [docs README](./README.md#global-flags) for the shared global flags. `completion` accepts them all, but only one has an effect: `--verbose` changes the unsupported-shell error from a one-line message to the full structured error object (type `INVALID_ARGUMENT_ERROR`, with the shell name in the data payload). The command accepts `-o/--output`, but it ignores it (see above).

## Examples

```sh
# Print the bash script (bash is the default if [shell] is absent)
btcr2 completion
btcr2 completion bash

# Enable it for the current bash session, then for each session
eval "$(btcr2 completion bash)"
echo 'eval "$(btcr2 completion bash)"' >> ~/.bashrc

# Enable it for zsh
eval "$(btcr2 completion zsh)"
echo 'eval "$(btcr2 completion zsh)"' >> ~/.zshrc

# Install it for fish (fish loads the scripts in this directory)
mkdir -p ~/.config/fish/completions
btcr2 completion fish > ~/.config/fish/completions/btcr2.fish

# An unsupported shell: a message on stderr, exit code 1
btcr2 completion powershell
# Unsupported shell "powershell". Use bash, zsh, or fish.
```

## See also

- [README](./README.md): the global flags, the config precedence, and the full command list.
- [DEMO.md](./DEMO.md): the CLI walkthrough.
- `btcr2 quickstart`: the setup in one command (not in the completion word list).
