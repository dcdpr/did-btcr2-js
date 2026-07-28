# btcr2 completion

Prints a static shell completion script for the `btcr2` binary to stdout. The script completes
top-level command names only (no subcommands, no flags, no dynamic values). Use it once per shell
setup: evaluate it in your shell rc file (bash, zsh) or save it to the fish completions directory.
The command is fully offline and side-effect free: it reads no keystore, opens no network
connection, and writes nothing to disk.

## Synopsis

```
btcr2 completion [options] [shell]

btcr2 completion            # bash (default)
btcr2 completion bash
btcr2 completion zsh
btcr2 completion fish
```

## Options

There are no subcommands. The single positional argument selects the target shell.

| Flag | Value | Default | Description |
|------|-------|---------|-------------|
| `[shell]` (positional) | `bash` \| `zsh` \| `fish` | `bash` | Shell dialect of the emitted completion script. Any other value fails with `Unsupported shell "<shell>". Use bash, zsh, or fish.` on stderr and exit code 1. |
| `-h, --help` | none | n/a | Print usage for the command and exit. |

### Emitted script per shell

The completed word list is identical for all three shells:

```
create resolve read update deactivate delete key config profile completion
```

- `bash`: defines a `_btcr2` function using `compgen -W` and registers it with
  `complete -F _btcr2 btcr2`. Header comment: install with `eval "$(btcr2 completion bash)"`.
- `zsh`: defines a `_btcr2` function using `compadd` and registers it with `compdef _btcr2 btcr2`.
  Header comment: install with `eval "$(btcr2 completion zsh)"`.
- `fish`: a single `complete -c btcr2 -f -a "..."` line. Header comment: save to
  `~/.config/fish/completions/btcr2.fish`.

### Known limitations of the word list

The list is a hardcoded constant in `src/commands/completion.ts`, not derived from the registered
command tree. Two consequences, both confirmed against the source:

- `read` and `delete` are included; they are the registered aliases of `resolve` and `deactivate`.
- `init`, `quickstart`, `keystore`, and the built-in `help` command are registered commands but
  are absent from the word list, so they do not tab-complete. Subcommands (for example `key list`,
  `profile add`, `keystore unlock`) and flags never complete either.

## Environment & configuration

The `completion` action itself consults no environment variables, no config keys, no profiles, and
no keystore, passphrase, or session state. Its output is byte-identical regardless of configuration.

One shared mechanism still runs before the action: the program-level `preAction` hook resolves the
effective output format (precedence: `-o/--output` flag > `BTCR2_OUTPUT` env var > config
`defaults.output` > built-in `text`). To do so it may read the config file at `--config <path>`,
else `<home>/config.json`, with home resolved as `--home` flag > `BTCR2_HOME` env var > platform
default (`~/.btcr2` on Linux and macOS; `%LOCALAPPDATA%\btcr2` on Windows, falling back to
`%APPDATA%\btcr2`, then `<user profile>\btcr2`). This read is best-effort: a missing or malformed
config file never blocks the command. The resolved format is then ignored by `completion`, which
always prints the plain script via stdout. There is no JSON output mode for this command;
`-o json` has no effect on it.

No network hints (faucet or explorer URLs) apply: the command is network-agnostic.

## Global options

Shared global flags are documented in the [docs README](./README.md#global-options). `completion` accepts them all but
notably interacts with only one: `--verbose`, which switches the unsupported-shell error from a
one-line message to the full structured error object (type `INVALID_ARGUMENT_ERROR`, with the
offending shell in the data payload). `-o/--output` is accepted but ignored (see above).

## Examples

```sh
# Print the bash script (bash is the default when [shell] is omitted)
btcr2 completion
btcr2 completion bash

# Enable for the current bash session, then persist it
eval "$(btcr2 completion bash)"
echo 'eval "$(btcr2 completion bash)"' >> ~/.bashrc

# Enable for zsh
eval "$(btcr2 completion zsh)"
echo 'eval "$(btcr2 completion zsh)"' >> ~/.zshrc

# Install for fish (fish auto-loads from this directory)
mkdir -p ~/.config/fish/completions
btcr2 completion fish > ~/.config/fish/completions/btcr2.fish

# Unsupported shell: message on stderr, exit code 1
btcr2 completion powershell
# Unsupported shell "powershell". Use bash, zsh, or fish.
```

## See also

- [README](./README.md): global flags, configuration precedence, and the full command list.
- [DEMO.md](./DEMO.md): end-to-end CLI walkthrough where tab completion speeds up the workflow.
- `btcr2 quickstart`: guided first-run setup (note: not present in the completion word list).
